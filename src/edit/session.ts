import type { LabelEdit, MapData } from '../model/types';
import { layersOf, rollUps, runRules, type DataLayer } from '../model/layers';
import { HexFlag, Terrain, Touched } from '../model/types';
import { hexAt, hexCenterX, hexCenterY, sampleField } from '../model/hex';
import { ensureEdits } from '../gen/rederive';
import { growInto, mergeProvinces, splitProvince } from './political';

export type ToolId =
  | 'raise'
  | 'lower'
  | 'smooth'
  | 'flatten'
  | 'paint'
  | 'river'
  | 'erase-river'
  | 'lake'
  | 'drain'
  | 'assign'
  | 'split'
  | 'merge'
  | 'region'
  | 'realm'
  | 'label'
  | 'layer';

export interface ToolSettings {
  tool: ToolId | null;
  /** Brush radius, world units (1 hex ≈ 1.73). */
  radius: number;
  /** 0..1 */
  strength: number;
  terrain: Terrain;
  /** layer brush: which layer, what value (NaN = give back to the rules), tags add or remove */
  layer?: string | null;
  layerValue?: number;
  tagMode?: 'add' | 'remove';
}

export const TOOL_LABELS: Record<ToolId, string> = {
  raise: 'Raise land',
  lower: 'Lower land',
  smooth: 'Smooth',
  flatten: 'Flatten',
  paint: 'Paint terrain',
  river: 'Draw river',
  'erase-river': 'Erase river',
  lake: 'Fill lake',
  drain: 'Drain',
  assign: 'Reassign hexes',
  split: 'Split province',
  merge: 'Merge provinces',
  region: 'Change region',
  realm: 'Change realm',
  label: 'Move labels',
  layer: 'Paint values',
};

/** Tools that draw a line (collected as points, applied when the stroke ends). */
export const LINE_TOOLS: ToolId[] = ['river', 'split', 'merge'];
/** Tools that only change the political map. */
export const POLITICAL_TOOLS: ToolId[] = ['assign', 'split', 'merge', 'region', 'realm'];

/** Tools that change the heightfield (and so redraw live while dragging). */
export const HEIGHT_TOOLS: ToolId[] = ['raise', 'lower', 'smooth', 'flatten', 'lake', 'drain'];

export const PAINTABLE: Terrain[] = [
  Terrain.Plains,
  Terrain.Farmland,
  Terrain.Forest,
  Terrain.Jungle,
  Terrain.Taiga,
  Terrain.Steppe,
  Terrain.Desert,
  Terrain.Tundra,
  Terrain.Glacier,
  Terrain.Marsh,
];

interface Diff {
  idx: Int32Array;
  before: number[];
  after: number[];
}

/** The parts of the political map that edits and undo must carry over. */
export interface PoliticalCore {
  provinces: { name: string; region: number; capitalHex: number }[];
  regions: { name: string; realm: number; capitalProvince: number }[];
  realms: { name: string; title: string; color: [number, number, number]; culture: number; capitalProvince: number }[];
  labels: Record<string, LabelEdit>;
}

export interface StepRecord {
  label: string;
  /** 'instant': only labels or data layers changed, nothing to rebuild */
  kind?: 'instant';
  layers?: LayerStep;
  height?: { x: number; y: number; w: number; h: number; before: Float32Array; after: Float32Array };
  terrain?: Diff;
  riverBlock?: Diff;
  touched?: Diff;
  riverPathsBefore: number[][];
  riverPathsAfter: number[][];
  province?: Diff;
  coreBefore: PoliticalCore;
  coreAfter?: PoliticalCore;
  /** province array before, kept until the rebuilt map arrives */
  provinceBefore?: Int32Array;
}

interface Stroke {
  map: MapData;
  settings: ToolSettings;
  heightBefore: Float32Array | null;
  terrainBefore: Int8Array;
  riverBlockBefore: Uint8Array;
  touchedBefore: Uint8Array;
  riverPathsBefore: number[][];
  provinceBefore: Int32Array;
  coreBefore: PoliticalCore;
  dirty: { x0: number; y0: number; x1: number; y1: number } | null;
  last: [number, number];
  flattenTarget: number;
  /** river tool: the path drawn so far (world points) */
  points: [number, number][];
  /** paint / erase: hexes touched in this stroke, for the live preview */
  hexes: Set<number>;
  /** province, region or realm being extended (border tools) */
  target: number;
  labelKey?: string;
  layersBefore?: LayerSnapshot;
}

const MAX_UNDO = 100;

export interface ChangeToken {
  provinceBefore: Int32Array;
  coreBefore: PoliticalCore;
  paths: number[][];
  layers: LayerSnapshot;
}

interface LayerArrays {
  values: Float32Array;
  locked: Uint8Array;
}
export interface LayerSnapshot {
  defs: string;
  arrays: Map<string, LayerArrays>;
}
interface LayerChange {
  id: string;
  /** whole arrays when the layer appeared, disappeared or changed size */
  before?: LayerArrays | null;
  after?: LayerArrays | null;
  values?: Diff;
  locked?: Diff;
}
export interface LayerStep {
  defsBefore: string;
  defsAfter: string;
  changes: LayerChange[];
}

export function snapshotLayers(map: MapData): LayerSnapshot {
  const arrays = new Map<string, LayerArrays>();
  for (const l of layersOf(map)) arrays.set(l.def.id, { values: l.values.slice(), locked: l.locked.slice() });
  return { defs: JSON.stringify(layersOf(map).map((l) => l.def)), arrays };
}

function layerStep(snap: LayerSnapshot, map: MapData): LayerStep | undefined {
  const defsAfter = JSON.stringify(layersOf(map).map((l) => l.def));
  const ids = new Set([...snap.arrays.keys(), ...layersOf(map).map((l) => l.def.id)]);
  const changes: LayerChange[] = [];
  for (const id of ids) {
    const b = snap.arrays.get(id) ?? null;
    const cur = layersOf(map).find((l) => l.def.id === id);
    const a = cur ? { values: cur.values, locked: cur.locked } : null;
    if (!a || !b || a.values.length !== b.values.length) {
      changes.push({ id, before: b, after: a ? { values: a.values.slice(), locked: a.locked.slice() } : null });
      continue;
    }
    const values = diff(b.values, a.values);
    const locked = diff(b.locked, a.locked);
    if (values || locked) changes.push({ id, values, locked });
  }
  if (!changes.length && defsAfter === snap.defs) return undefined;
  return { defsBefore: snap.defs, defsAfter, changes };
}

function applyLayerStep(map: MapData, step: LayerStep, side: 'before' | 'after'): void {
  const defs: DataLayer['def'][] = JSON.parse(side === 'before' ? step.defsBefore : step.defsAfter);
  const current = new Map(layersOf(map).map((l) => [l.def.id, l]));
  const byId = new Map(step.changes.map((c) => [c.id, c]));
  map.layers = defs.map((def) => {
    const c = byId.get(def.id);
    const cur = current.get(def.id);
    if (c && (c.before !== undefined || c.after !== undefined)) {
      const arr = side === 'before' ? c.before : c.after;
      if (arr) return { def, values: arr.values.slice(), locked: arr.locked.slice() };
    }
    const layer: DataLayer = cur ? { def, values: cur.values, locked: cur.locked } : { def, values: new Float32Array(0), locked: new Uint8Array(0) };
    if (c) {
      applyDiff(layer.values, c.values, side);
      applyDiff(layer.locked, c.locked, side);
    }
    return layer;
  });
}

/**
 * Editing on the main thread: brushes change the heightfield and edit layers
 * in place (so the map redraws while you drag), and each finished stroke
 * becomes one undo step. Everything derived is rebuilt off-thread afterwards.
 */
export class EditSession {
  undoStack: StepRecord[] = [];
  redoStack: StepRecord[] = [];
  stroke: Stroke | null = null;
  /** why the last stroke did nothing, for the user */
  message: string | null = null;

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  reset(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
  }

  begin(map: MapData, settings: ToolSettings, x: number, y: number, ctx: { labelKey?: string } = {}): void {
    if (!settings.tool) return;
    this.message = null;
    const e = ensureEdits(map);
    // border tools extend whatever the stroke starts in
    const h0 = hexAt(map.grid, x, y);
    const p0 = h0 >= 0 ? map.hex.province[h0] : -1;
    let target = -1;
    if (settings.tool === 'assign') target = p0;
    else if (settings.tool === 'region') target = p0 >= 0 ? map.provinces[p0].region : -1;
    else if (settings.tool === 'realm') target = p0 >= 0 ? map.regions[map.provinces[p0].region].realm : -1;
    if (['assign', 'region', 'realm'].includes(settings.tool) && target < 0) {
      this.message = 'Start the stroke on land, inside the province, region or realm you want to extend.';
      return;
    }
    if (settings.tool === 'label' && !ctx.labelKey) return;
    if (settings.tool === 'layer' && !layersOf(map).some((l) => l.def.id === settings.layer)) {
      this.message = 'Pick a data layer to paint first.';
      return;
    }
    const isHeight = HEIGHT_TOOLS.includes(settings.tool) || settings.tool === 'river';
    this.stroke = {
      map,
      settings: { ...settings },
      heightBefore: isHeight ? map.height.data.slice() : null,
      terrainBefore: e.terrain.slice(),
      riverBlockBefore: e.riverBlock.slice(),
      touchedBefore: e.touched.slice(),
      riverPathsBefore: e.riverPaths.map((p) => p.slice()),
      provinceBefore: map.hex.province.slice(),
      coreBefore: captureCore(map),
      dirty: null,
      last: [x, y],
      flattenTarget: sampleField(map.height, x, y),
      points: [[x, y]],
      hexes: new Set(),
      target,
      labelKey: ctx.labelKey,
      layersBefore: settings.tool === 'layer' ? snapshotLayers(map) : undefined,
    };
    this.dab(x, y);
  }

  /** Returns true when the heightfield changed (the caller re-uploads it). */
  move(x: number, y: number): boolean {
    const s = this.stroke;
    if (!s) return false;
    if (LINE_TOOLS.includes(s.settings.tool!)) {
      const [lx, ly] = s.points[s.points.length - 1];
      if (Math.hypot(x - lx, y - ly) > 0.3) s.points.push([x, y]);
      return false;
    }
    if (s.settings.tool === 'label') {
      const [lx, ly] = s.last;
      const labels = (s.map.labels ??= {});
      const e = (labels[s.labelKey!] ??= {});
      e.dx = (e.dx ?? 0) + x - lx;
      e.dy = (e.dy ?? 0) + y - ly;
      s.last = [x, y];
      return false;
    }
    const [lx, ly] = s.last;
    const d = Math.hypot(x - lx, y - ly);
    const spacing = Math.max(0.25, s.settings.radius * 0.25);
    if (d < spacing) return false;
    const steps = Math.ceil(d / spacing);
    let changed = false;
    for (let k = 1; k <= steps; k++) changed = this.dab(lx + ((x - lx) * k) / steps, ly + ((y - ly) * k) / steps) || changed;
    s.last = [x, y];
    return changed;
  }

  /** Pointer held still: keep building (height tools only). */
  hold(): boolean {
    const s = this.stroke;
    if (!s || !HEIGHT_TOOLS.includes(s.settings.tool!)) return false;
    return this.dab(s.last[0], s.last[1]);
  }

  /** Finishes the stroke. Returns the step to rebuild and commit, or null if nothing changed. */
  end(): StepRecord | null {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return null;
    const map = s.map;
    const e = ensureEdits(map);
    const tool = s.settings.tool!;
    if (tool === 'river') this.applyRiver(s);
    if (tool === 'split') {
      const r = splitProvince(map, pathFromPoints(map, s.points));
      if (!r.ok) this.message = r.message;
    }
    if (tool === 'merge') {
      const a = hexAt(map.grid, s.points[0][0], s.points[0][1]);
      const [bx, by] = s.points[s.points.length - 1];
      const b = hexAt(map.grid, bx, by);
      const r = mergeProvinces(map, a >= 0 ? map.hex.province[a] : -1, b >= 0 ? map.hex.province[b] : -1);
      if (!r.ok) this.message = r.message;
    }
    if (tool === 'layer') {
      // values given back to the rules get their rule value again
      const l = layersOf(map).find((x) => x.def.id === s.settings.layer);
      if (l && Number.isNaN(s.settings.layerValue)) runRules(map, l);
      rollUps(map);
    }
    const rec: StepRecord = {
      label: TOOL_LABELS[tool],
      kind: tool === 'label' || tool === 'layer' ? 'instant' : undefined,
      layers: s.layersBefore ? layerStep(s.layersBefore, map) : undefined,
      riverPathsBefore: s.riverPathsBefore,
      riverPathsAfter: e.riverPaths.map((p) => p.slice()),
      coreBefore: s.coreBefore,
      provinceBefore: s.provinceBefore,
    };
    if (s.heightBefore && s.dirty) {
      const { x0, y0, x1, y1 } = s.dirty;
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const before = new Float32Array(w * h);
      const after = new Float32Array(w * h);
      const W = map.height.w;
      for (let j = 0; j < h; j++) {
        before.set(s.heightBefore.subarray((y0 + j) * W + x0, (y0 + j) * W + x0 + w), j * w);
        after.set(map.height.data.subarray((y0 + j) * W + x0, (y0 + j) * W + x0 + w), j * w);
      }
      rec.height = { x: x0, y: y0, w, h, before, after };
    }
    rec.terrain = diff(s.terrainBefore, e.terrain);
    rec.riverBlock = diff(s.riverBlockBefore, e.riverBlock);
    rec.touched = diff(s.touchedBefore, e.touched);
    return isEmpty(rec, map) ? null : rec;
  }

  /**
   * One undoable change made outside a brush stroke (renaming, recolouring,
   * a new region, a label setting). `mutate` changes the map in place.
   */
  change(map: MapData, label: string, mutate: () => void, kind?: 'instant'): StepRecord | null {
    if (this.stroke) return null;
    const t = this.startChange(map);
    mutate();
    return this.finishChange(map, t, label, kind);
  }

  /** Two-part change, for controls that adjust live (sliders) and record once at the end. */
  startChange(map: MapData): ChangeToken {
    const e = ensureEdits(map);
    return { provinceBefore: map.hex.province.slice(), coreBefore: captureCore(map), paths: e.riverPaths.map((p) => p.slice()), layers: snapshotLayers(map) };
  }

  finishChange(map: MapData, t: ChangeToken, label: string, kind?: 'instant'): StepRecord | null {
    if (kind === 'instant') rollUps(map);
    const rec: StepRecord = {
      label,
      kind,
      riverPathsBefore: t.paths,
      riverPathsAfter: t.paths,
      coreBefore: t.coreBefore,
      provinceBefore: t.provinceBefore,
      layers: layerStep(t.layers, map),
    };
    return isEmpty(rec, map) ? null : rec;
  }

  /** The rebuilt map arrived (or, for label steps, the map itself): complete the step and put it on the undo stack. */
  commit(rec: StepRecord, rebuilt: MapData): void {
    if (rec.provinceBefore) rec.province = diff(rec.provinceBefore, rebuilt.hex.province) ?? undefined;
    delete rec.provinceBefore;
    rec.coreAfter = captureCore(rebuilt);
    this.undoStack.push(rec);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Puts the map back as it was before the last step (in place); the caller rebuilds it. */
  undo(map: MapData): StepRecord | null {
    const rec = this.undoStack.pop();
    if (!rec) return null;
    applyStep(map, rec, 'before');
    this.redoStack.push(rec);
    return rec;
  }

  redo(map: MapData): StepRecord | null {
    const rec = this.redoStack.pop();
    if (!rec) return null;
    applyStep(map, rec, 'after');
    this.undoStack.push(rec);
    return rec;
  }

  // ------------------------------------------------------------------ dabs

  private dab(x: number, y: number): boolean {
    const s = this.stroke!;
    const { tool, radius, strength } = s.settings;
    const map = s.map;
    const e = ensureEdits(map);
    if (tool === 'river' || tool === 'split' || tool === 'merge' || tool === 'label') return false;
    if (tool === 'layer') {
      const l = layersOf(map).find((x) => x.def.id === s.settings.layer);
      if (!l) return false;
      const v = s.settings.layerValue ?? 0;
      forHexesInRadius(map, x, y, radius, (h) => {
        if (!(map.hex.flags[h] & HexFlag.Land)) return;
        const idx = l.def.scope === 'hex' ? h : map.hex.province[h];
        if (idx < 0) return;
        if (Number.isNaN(v)) l.locked[idx] = 0;
        else {
          if (l.def.type === 'tags') {
            const bit = 1 << v;
            l.values[idx] = s.settings.tagMode === 'remove' ? (l.values[idx] & ~bit) >>> 0 : ((l.values[idx] | bit) >>> 0);
          } else l.values[idx] = v;
          l.locked[idx] = 1;
        }
        if (l.def.scope === 'hex') s.hexes.add(h);
        else for (const q of map.provinces[idx].hexes) s.hexes.add(q);
      });
      return false;
    }
    if (tool === 'assign' || tool === 'region' || tool === 'realm') {
      const hexes: number[] = [];
      forHexesInRadius(map, x, y, radius, (h) => hexes.push(h));
      if (tool === 'assign') {
        for (const h of growInto(map, s.target, hexes)) s.hexes.add(h);
        return false;
      }
      for (const h of hexes) {
        const p = map.hex.province[h];
        if (p < 0) continue;
        const pr = map.provinces[p];
        if (tool === 'region' && pr.region !== s.target) {
          pr.region = s.target;
          for (const q of pr.hexes) s.hexes.add(q);
        }
        if (tool === 'realm') {
          const rg = map.regions[pr.region];
          if (rg.realm !== s.target) {
            rg.realm = s.target;
            for (const pk of rg.provinces) for (const q of map.provinces[pk].hexes) s.hexes.add(q);
          }
        }
      }
      return false;
    }
    if (tool === 'paint' || tool === 'erase-river') {
      forHexesInRadius(map, x, y, radius, (h) => {
        if (tool === 'paint') {
          if (!(map.hex.flags[h] & HexFlag.Land)) return;
          e.terrain[h] = s.settings.terrain;
          e.touched[h] |= Touched.Terrain;
        } else {
          e.riverBlock[h] = 1;
          e.touched[h] |= Touched.River;
          // a hand-drawn river through here ends at this point
          e.riverPaths = e.riverPaths.map((p) => {
            const k = p.indexOf(h);
            return k < 0 ? p : p.slice(0, k);
          }).filter((p) => p.length >= 2);
        }
        s.hexes.add(h);
      });
      return false;
    }
    // height tools
    const f = map.height;
    const res = f.res;
    const i0 = Math.max(1, Math.floor((x - radius) * res));
    const i1 = Math.min(f.w - 2, Math.ceil((x + radius) * res));
    const j0 = Math.max(1, Math.floor((y - radius) * res));
    const j1 = Math.min(f.h - 2, Math.ceil((y + radius) * res));
    if (i1 < i0 || j1 < j0) return false;
    const d = f.data;
    const W = f.w;
    // smoothing reads a snapshot so the result does not depend on scan order
    let snap: Float32Array | null = null;
    if (tool === 'smooth') {
      snap = new Float32Array((i1 - i0 + 5) * (j1 - j0 + 5));
      for (let j = j0 - 2; j <= j1 + 2; j++)
        for (let i = i0 - 2; i <= i1 + 2; i++) {
          const ci = Math.min(W - 1, Math.max(0, i));
          const cj = Math.min(f.h - 1, Math.max(0, j));
          snap[(j - j0 + 2) * (i1 - i0 + 5) + (i - i0 + 2)] = d[cj * W + ci];
        }
    }
    const sw = i1 - i0 + 5;
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      const wy = (j + 0.5) / res;
      for (let i = i0; i <= i1; i++) {
        const wx = (i + 0.5) / res;
        const dist = Math.hypot(wx - x, wy - y);
        if (dist >= radius) continue;
        const fall = 0.5 * (1 + Math.cos((Math.PI * dist) / radius));
        const k = j * W + i;
        const h = d[k];
        let v = h;
        switch (tool) {
          // eases off near the highest peak and the deepest sea, so holding
          // the brush builds a rounded summit instead of a flat-topped mesa
          case 'raise':
            v = h + strength * 0.012 * fall * Math.max(0.02, 1 - Math.max(0, h) / 0.95);
            break;
          case 'lower':
            v = h - strength * 0.012 * fall * Math.max(0.02, 1 + Math.min(0, h) / 0.95);
            break;
          case 'smooth': {
            let sum = 0;
            for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) sum += snap![(j - j0 + 2 + b) * sw + (i - i0 + 2 + a)];
            v = h + (sum / 25 - h) * Math.min(1, strength * 0.6 * fall);
            break;
          }
          case 'flatten':
            v = h + (s.flattenTarget - h) * Math.min(1, strength * 0.3 * fall);
            break;
          case 'lake':
            if (h > -0.05) v = h + (-0.05 - h) * Math.min(1, strength * 0.5 * fall);
            break;
          case 'drain':
            if (h < 0.015) v = h + (0.015 - h) * Math.min(1, strength * 0.5 * fall);
            break;
        }
        v = Math.max(-1, Math.min(1, v));
        if (v !== h) {
          d[k] = v;
          changed = true;
        }
      }
    }
    if (changed) {
      const r = s.dirty;
      s.dirty = r ? { x0: Math.min(r.x0, i0), y0: Math.min(r.y0, j0), x1: Math.max(r.x1, i1), y1: Math.max(r.y1, j1) } : { x0: i0, y0: j0, x1: i1, y1: j1 };
      forHexesInRadius(map, x, y, radius * 0.9, (hx) => (e.touched[hx] |= Touched.Height));
    }
    return changed;
  }

  /** River tool: turn the drawn line into a hex path and cut a channel along it. */
  private applyRiver(s: Stroke): void {
    const map = s.map;
    const e = ensureEdits(map);
    const path = pathFromPoints(map, s.points);
    // the path ends where it reaches water
    const cut = path.findIndex((h) => !(map.hex.flags[h] & HexFlag.Land));
    const landPath = cut < 0 ? path : path.slice(0, cut + 1);
    if (landPath.length < 2) return;
    // water must always run downhill: heights fall along the path
    const f = map.height;
    const t: number[] = [];
    for (let k = 0; k < landPath.length; k++) {
      const [cx, cy] = center(map, landPath[k]);
      const h = sampleField(f, cx, cy);
      // keep falling, by a hair once the channel nears sea level
      t.push(k === 0 ? Math.max(0.006, h - 0.01) : Math.min(h - 0.01, t[k - 1] - 0.003) < 0.003 ? Math.max(0.0015, t[k - 1] - 0.00005) : Math.min(h - 0.01, t[k - 1] - 0.003));
    }
    let dirty = s.dirty;
    for (let k = 0; k < landPath.length - 1; k++) {
      const [ax, ay] = center(map, landPath[k]);
      const [bx, by] = center(map, landPath[k + 1]);
      const tb = landPath[k + 1] === landPath[landPath.length - 1] && !(map.hex.flags[landPath[k + 1]] & HexFlag.Land) ? -0.02 : t[Math.min(k + 1, t.length - 1)];
      const len = Math.hypot(bx - ax, by - ay);
      for (let u = 0; u <= len; u += 0.25) {
        const q = u / len;
        const px = ax + (bx - ax) * q;
        const py = ay + (by - ay) * q;
        const level = t[k] + (tb - t[k]) * q;
        const R = 0.8;
        for (let j = Math.max(0, Math.floor((py - R) * f.res)); j <= Math.min(f.h - 1, Math.ceil((py + R) * f.res)); j++)
          for (let i = Math.max(0, Math.floor((px - R) * f.res)); i <= Math.min(f.w - 1, Math.ceil((px + R) * f.res)); i++) {
            const dd = Math.hypot((i + 0.5) / f.res - px, (j + 0.5) / f.res - py);
            if (dd > R) continue;
            const kk = j * f.w + i;
            if (f.data[kk] <= 0) continue;
            const s2 = Math.min(1, Math.max(0, (dd - 0.2) / (R - 0.2)));
            const target = Math.max(0.002, level) + 0.03 * s2 * s2 * (3 - 2 * s2);
            if (target < f.data[kk]) {
              f.data[kk] = target;
              dirty = dirty ? { x0: Math.min(dirty.x0, i), y0: Math.min(dirty.y0, j), x1: Math.max(dirty.x1, i), y1: Math.max(dirty.y1, j) } : { x0: i, y0: j, x1: i, y1: j };
            }
          }
      }
    }
    s.dirty = dirty;
    for (const h of landPath) {
      e.riverBlock[h] = 0;
      e.touched[h] |= Touched.River | Touched.Height;
    }
    e.riverPaths.push(landPath);
  }
}

// ------------------------------------------------------------------ helpers

export function captureCore(map: MapData): PoliticalCore {
  return {
    provinces: map.provinces.map((p) => ({ name: p.name, region: p.region, capitalHex: p.capitalHex })),
    regions: map.regions.map((r) => ({ name: r.name, realm: r.realm, capitalProvince: r.capitalProvince })),
    realms: map.realms.map((r) => ({ name: r.name, title: r.title, color: [...r.color] as [number, number, number], culture: r.culture, capitalProvince: r.capitalProvince })),
    labels: JSON.parse(JSON.stringify(map.labels ?? {})),
  };
}

function isEmpty(rec: StepRecord, map: MapData): boolean {
  if (rec.height || rec.terrain || rec.riverBlock || rec.layers) return false;
  if (JSON.stringify(rec.riverPathsBefore) !== JSON.stringify(rec.riverPathsAfter)) return false;
  if (rec.provinceBefore && diff(rec.provinceBefore, map.hex.province)) return false;
  return JSON.stringify(rec.coreBefore) === JSON.stringify(captureCore(map));
}

function applyCore(map: MapData, core: PoliticalCore): void {
  map.provinces = core.provinces.map((c, id) => ({
    ...(map.provinces[id] ?? { hexes: [], neighbors: [], seaNeighbors: [], coastal: false, center: [0, 0] as [number, number], terrain: Terrain.Plains }),
    ...c,
    id,
  }));
  map.regions = core.regions.map((c, id) => ({ ...(map.regions[id] ?? { provinces: [] }), ...c, id }));
  map.realms = core.realms.map((c, id) => ({ ...(map.realms[id] ?? { regions: [] }), ...c, id }));
  map.labels = JSON.parse(JSON.stringify(core.labels ?? {}));
}

function applyStep(map: MapData, rec: StepRecord, side: 'before' | 'after'): void {
  const e = ensureEdits(map);
  if (rec.height) {
    const src = rec.height[side];
    const { x, y, w, h } = rec.height;
    for (let j = 0; j < h; j++) map.height.data.set(src.subarray(j * w, j * w + w), (y + j) * map.height.w + x);
  }
  applyDiff(e.terrain, rec.terrain, side);
  applyDiff(e.riverBlock, rec.riverBlock, side);
  applyDiff(e.touched, rec.touched, side);
  applyDiff(map.hex.province, rec.province, side);
  e.riverPaths = (side === 'before' ? rec.riverPathsBefore : rec.riverPathsAfter).map((p) => p.slice());
  const core = side === 'before' ? rec.coreBefore : rec.coreAfter;
  if (core) applyCore(map, core);
  if (rec.layers) applyLayerStep(map, rec.layers, side);
}

function diff(a: ArrayLike<number>, b: ArrayLike<number>): Diff | undefined {
  const idx: number[] = [];
  const before: number[] = [];
  const after: number[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++)
    if (a[i] !== b[i]) {
      idx.push(i);
      before.push(a[i]);
      after.push(b[i]);
    }
  return idx.length ? { idx: Int32Array.from(idx), before, after } : undefined;
}

function applyDiff(arr: { [i: number]: number }, d: Diff | undefined, side: 'before' | 'after'): void {
  if (!d) return;
  const v = side === 'before' ? d.before : d.after;
  for (let k = 0; k < d.idx.length; k++) arr[d.idx[k]] = v[k];
}

function center(map: MapData, h: number): [number, number] {
  const row = Math.floor(h / map.grid.cols);
  return [hexCenterX(h % map.grid.cols, row), hexCenterY(row)];
}

export function forHexesInRadius(map: MapData, x: number, y: number, r: number, fn: (h: number) => void): void {
  const { cols, rows } = map.grid;
  const rr = Math.max(r, 0.5);
  const r0 = Math.max(0, Math.floor((y - rr - 1) / 1.5));
  const r1 = Math.min(rows - 1, Math.ceil((y + rr) / 1.5));
  const c0 = Math.max(0, Math.floor((x - rr) / 1.7320508) - 1);
  const c1 = Math.min(cols - 1, Math.ceil((x + rr) / 1.7320508));
  let any = false;
  for (let row = r0; row <= r1; row++)
    for (let col = c0; col <= c1; col++) {
      if (Math.hypot(hexCenterX(col, row) - x, hexCenterY(row) - y) <= rr) {
        fn(row * cols + col);
        any = true;
      }
    }
  // a brush smaller than a hex still paints the hex under it
  if (!any) {
    const h = hexAt(map.grid, x, y);
    if (h >= 0) fn(h);
  }
}

/** Contiguous hex path (each step to a neighbour) through the drawn points, loops removed. */
export function pathFromPoints(map: MapData, pts: [number, number][]): number[] {
  const out: number[] = [];
  const push = (h: number) => {
    if (h < 0 || out[out.length - 1] === h) return;
    const k = out.indexOf(h);
    if (k >= 0) out.length = k + 1; // walked back over itself: drop the loop
    else out.push(h);
  };
  for (let k = 0; k < pts.length; k++) {
    if (k === 0) {
      push(hexAt(map.grid, pts[0][0], pts[0][1]));
      continue;
    }
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / 0.2));
    for (let s = 1; s <= steps; s++) push(hexAt(map.grid, ax + ((bx - ax) * s) / steps + 1e-4, ay + ((by - ay) * s) / steps + 1e-4));
  }
  // fill any diagonal jump with a shared neighbour
  const res: number[] = [];
  for (let k = 0; k < out.length; k++) {
    if (k > 0 && !adjacent(map, out[k - 1], out[k])) {
      const bridge = sharedNeighbor(map, out[k - 1], out[k]);
      if (bridge >= 0) res.push(bridge);
    }
    res.push(out[k]);
  }
  return res;
}

function adjacent(map: MapData, a: number, b: number): boolean {
  const [ax, ay] = center(map, a);
  const [bx, by] = center(map, b);
  return Math.hypot(ax - bx, ay - by) < 1.8;
}

function sharedNeighbor(map: MapData, a: number, b: number): number {
  const [ax, ay] = center(map, a);
  const [bx, by] = center(map, b);
  const h = hexAt(map.grid, (ax + bx) / 2 + 0.05, (ay + by) / 2 + 0.05);
  return h >= 0 && adjacent(map, a, h) && adjacent(map, h, b) ? h : -1;
}
