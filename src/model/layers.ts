import { t } from '../i18n';
import type { MapData } from './types';
import { BIOME_NAMES, HexFlag, TERRAIN_NAMES } from './types';
import { buildNeighbors } from './hex';
import { hashString } from '../util/rng';

/**
 * Custom data layers: game information a user defines (resources, fertility,
 * danger …), stored per hex or per province, filled by seeded rules and/or by
 * hand, shown as a map mode and exported with the map.
 */

export type LayerType = 'category' | 'number' | 'flag' | 'tags';
export type LayerScope = 'hex' | 'province';
export type Aggregate = 'sum' | 'average' | 'max' | 'min' | 'mode' | 'any';

export interface Category {
  id: number;
  name: string;
  color: [number, number, number];
}

export type ConditionField = 'terrain' | 'biome' | 'elevation' | 'temperature' | 'rainfall' | 'coastal' | 'river' | 'lake' | 'settlementDistance';

export interface Condition {
  field: ConditionField;
  /** terrain / biome codes the hex must be one of */
  codes?: number[];
  /** inclusive range for numeric fields */
  min?: number;
  max?: number;
  /** coastal / river / lake must be this */
  is?: boolean;
}

export type FormulaField = 'rainfall' | 'temperature' | 'elevation' | 'settlementDistance';

export interface Rule {
  id: string;
  /** all must hold */
  when: Condition[];
  /** 0..1, seeded per hex so results are reproducible */
  chance: number;
  /** category id, number, 1 for a flag, or the tag (category id) to add */
  value: number;
  /** numbers only: value = field × scale + offset instead of a fixed value */
  formula?: { field: FormulaField; scale: number; offset: number };
}

export interface LayerDef {
  /** stable id, used in exports and file names */
  id: string;
  name: string;
  type: LayerType;
  scope: LayerScope;
  /** category and tag layers */
  categories: Category[];
  /** number layers */
  min: number;
  max: number;
  /** number of decimals shown and exported */
  decimals: number;
  colorLow: [number, number, number];
  colorHigh: [number, number, number];
  /** value before any rule or hand edit (−1 = none, for categories) */
  defaultValue: number;
  rules: Rule[];
  /** re-run the rules after every edit to the land (hand-set values stay) */
  autoRun: boolean;
  /** province layers: fill from a hex layer instead of rules */
  rollUp?: { source: string; how: Aggregate };
  /** draw category initials on the map at close zoom */
  showIcons: boolean;
}

export interface DataLayer {
  def: LayerDef;
  /** one value per hex or per province (tags: bit mask of category ids) */
  values: Float32Array;
  /** 1 = set by hand; rules leave it alone */
  locked: Uint8Array;
}

export const TYPE_NAMES: Record<LayerType, string> = {
  category: 'Category',
  number: 'Number',
  flag: 'Yes / no',
  tags: 'List of tags',
};

export const CONDITION_NAMES: Record<ConditionField, string> = {
  terrain: 'Terrain is',
  biome: 'Biome is',
  elevation: 'Elevation between',
  temperature: 'Temperature between',
  rainfall: 'Rainfall between',
  coastal: 'On the coast',
  river: 'On a river',
  lake: 'Next to a lake',
  settlementDistance: 'Hexes from a town between',
};

export const FORMULA_NAMES: Record<FormulaField, string> = {
  rainfall: 'Rainfall (0–1)',
  temperature: 'Temperature (°C)',
  elevation: 'Elevation (0–1)',
  settlementDistance: 'Hexes from a town',
};

const SWATCHES: [number, number, number][] = [
  [178, 64, 52], [62, 108, 168], [212, 168, 60], [70, 140, 80], [132, 84, 160], [222, 120, 50],
  [60, 150, 150], [150, 110, 70], [200, 90, 140], [110, 130, 50], [90, 90, 90], [230, 210, 140],
];
export const swatch = (k: number) => SWATCHES[k % SWATCHES.length];

export function newLayerDef(existing: LayerDef[], type: LayerType, scope: LayerScope, name = ''): LayerDef {
  const base = name || t(type === 'number' ? 'Fertility' : type === 'flag' ? 'Special' : type === 'tags' ? 'Features' : 'Resource');
  let id = slug(base);
  for (let k = 2; existing.some((d) => d.id === id); k++) id = `${slug(base)}-${k}`;
  const def: LayerDef = {
    id,
    name: base,
    type,
    scope,
    categories: [],
    min: 0,
    max: 10,
    decimals: 0,
    colorLow: [236, 226, 196],
    colorHigh: [52, 120, 64],
    defaultValue: type === 'category' ? -1 : 0,
    rules: [],
    autoRun: true,
    showIcons: type === 'category' || type === 'tags',
  };
  if (type === 'category' && !name) {
    def.categories = [
      { id: 0, name: t('Iron'), color: [120, 120, 130] },
      { id: 1, name: t('Gold'), color: [220, 180, 50] },
      { id: 2, name: t('Horses'), color: [150, 100, 60] },
    ];
    def.rules = [
      { id: 'r1', when: [{ field: 'terrain', codes: [7, 8] }], chance: 0.15, value: 0 },
      { id: 'r2', when: [{ field: 'terrain', codes: [8] }], chance: 0.04, value: 1 },
      { id: 'r3', when: [{ field: 'terrain', codes: [3, 11] }], chance: 0.08, value: 2 },
    ];
  }
  if (type === 'tags' && !name) {
    def.categories = [
      { id: 0, name: t('Ruins'), color: [130, 110, 90] },
      { id: 1, name: t('Holy site'), color: [230, 210, 140] },
      { id: 2, name: t('Monsters'), color: [170, 50, 50] },
    ];
  }
  if (type === 'number' && !name) {
    def.rules = [{ id: 'r1', when: [{ field: 'terrain', codes: [3, 4, 11] }], chance: 1, value: 0, formula: { field: 'rainfall', scale: 10, offset: 0 } }];
  }
  return def;
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .slice(0, 32) || 'layer'
  );
}

export function layerLength(map: MapData, def: LayerDef): number {
  return def.scope === 'hex' ? map.grid.cols * map.grid.rows : map.provinces.length;
}

export function createLayer(map: MapData, def: LayerDef): DataLayer {
  const n = layerLength(map, def);
  const layer: DataLayer = { def, values: new Float32Array(n).fill(def.defaultValue), locked: new Uint8Array(n) };
  return layer;
}

export function layersOf(map: MapData): DataLayer[] {
  return map.layers ?? [];
}

/** Hexes from the nearest settlement (province capital), by breadth-first search. */
export function settlementDistance(map: MapData): Int32Array {
  const n = map.grid.cols * map.grid.rows;
  const nbr = buildNeighbors(map.grid);
  const dist = new Int32Array(n).fill(9999);
  const q: number[] = [];
  for (const p of map.provinces) {
    if (p.retired || p.capitalHex < 0) continue;
    dist[p.capitalHex] = 0;
    q.push(p.capitalHex);
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    for (let d = 0; d < 6; d++) {
      const j = nbr[i * 6 + d];
      if (j >= 0 && dist[j] > dist[i] + 1) {
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
  }
  return dist;
}

interface HexContext {
  map: MapData;
  dist: Int32Array;
  lakeSide: Uint8Array;
}

function context(map: MapData): HexContext {
  const n = map.grid.cols * map.grid.rows;
  const nbr = buildNeighbors(map.grid);
  const lakeSide = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!(map.hex.flags[i] & HexFlag.Lake)) continue;
    lakeSide[i] = 1;
    for (let d = 0; d < 6; d++) {
      const j = nbr[i * 6 + d];
      if (j >= 0) lakeSide[j] = 1;
    }
  }
  return { map, dist: settlementDistance(map), lakeSide };
}

function fieldValue(c: HexContext, h: number, f: FormulaField | ConditionField): number {
  const m = c.map;
  switch (f) {
    case 'rainfall':
      return m.hex.moisture[h];
    case 'temperature':
      return m.hex.temperature[h];
    case 'elevation':
      return m.hex.elevation[h];
    case 'settlementDistance':
      return c.dist[h];
    case 'terrain':
      return m.hex.terrain[h];
    case 'biome':
      return m.hex.biome[h];
    default:
      return 0;
  }
}

function holds(c: HexContext, h: number, cond: Condition): boolean {
  const m = c.map;
  switch (cond.field) {
    case 'terrain':
      return !cond.codes?.length || cond.codes.includes(m.hex.terrain[h]);
    case 'biome':
      return !cond.codes?.length || cond.codes.includes(m.hex.biome[h]);
    case 'coastal':
      return ((m.hex.flags[h] & HexFlag.Coastal) !== 0) === (cond.is ?? true);
    case 'river':
      return ((m.hex.flags[h] & HexFlag.River) !== 0) === (cond.is ?? true);
    case 'lake':
      return (c.lakeSide[h] === 1 && (m.hex.flags[h] & HexFlag.Land) !== 0) === (cond.is ?? true);
    default: {
      const v = fieldValue(c, h, cond.field);
      return v >= (cond.min ?? -Infinity) && v <= (cond.max ?? Infinity);
    }
  }
}

/** Seeded uniform number in [0, 1) for one rule at one place. */
function roll(seed: string, layer: string, rule: string, index: number): number {
  let h = hashString(`${seed}|${layer}|${rule}`) ^ Math.imul(index + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clampNumber(def: LayerDef, v: number): number {
  const k = 10 ** def.decimals;
  return Math.min(def.max, Math.max(def.min, Math.round(v * k) / k));
}

/**
 * Fills a layer from its rules. Values set by hand (locked) are kept. Rules
 * apply in order; a later rule overrides an earlier one, except tags, which
 * add up. Province layers test their rules on the province's settlement hex.
 */
export function runRules(map: MapData, layer: DataLayer, ctx?: HexContext): void {
  const def = layer.def;
  if (def.scope === 'province' && def.rollUp) return; // filled by rollUps()
  const c = ctx ?? context(map);
  const seed = map.meta.params.seed;
  const n = layer.values.length;
  for (let i = 0; i < n; i++) {
    if (layer.locked[i]) continue;
    let h = i;
    if (def.scope === 'province') {
      const p = map.provinces[i];
      if (!p || p.retired || p.capitalHex < 0) {
        layer.values[i] = def.defaultValue;
        continue;
      }
      h = p.capitalHex;
    } else if (!(map.hex.flags[h] & HexFlag.Land)) {
      layer.values[i] = def.defaultValue;
      continue;
    }
    let v = def.defaultValue;
    for (const r of def.rules) {
      if (!r.when.every((cond) => holds(c, h, cond))) continue;
      if (r.chance < 1 && roll(seed, def.id, r.id, i) >= r.chance) continue;
      if (def.type === 'tags') v = (v | (1 << r.value)) >>> 0;
      else if (def.type === 'number') v = clampNumber(def, r.formula ? fieldValue(c, h, r.formula.field) * r.formula.scale + r.formula.offset : r.value);
      else if (def.type === 'flag') v = r.value ? 1 : 0;
      else v = r.value;
    }
    layer.values[i] = v;
  }
}

/** Province layers filled from a hex layer (sum, average, maximum …). */
export function rollUps(map: MapData): void {
  const layers = layersOf(map);
  for (const l of layers) {
    const ru = l.def.rollUp;
    if (l.def.scope !== 'province' || !ru) continue;
    const src = layers.find((s) => s.def.id === ru.source && s.def.scope === 'hex');
    if (!src) continue;
    for (const p of map.provinces) {
      if (l.locked[p.id]) continue;
      if (p.retired || !p.hexes.length) {
        l.values[p.id] = l.def.defaultValue;
        continue;
      }
      const vs = p.hexes.map((h) => src.values[h]);
      let v = 0;
      switch (ru.how) {
        case 'sum':
          v = vs.reduce((a, b) => a + b, 0);
          break;
        case 'average':
          v = vs.reduce((a, b) => a + b, 0) / vs.length;
          break;
        case 'max':
          v = Math.max(...vs);
          break;
        case 'min':
          v = Math.min(...vs);
          break;
        case 'any':
          v = vs.some((x) => x > 0 && x !== src.def.defaultValue) ? 1 : 0;
          break;
        case 'mode': {
          const counts = new Map<number, number>();
          for (const x of vs) if (x !== src.def.defaultValue) counts.set(x, (counts.get(x) ?? 0) + 1);
          let best = l.def.defaultValue;
          let bc = 0;
          counts.forEach((c, x) => {
            if (c > bc) {
              bc = c;
              best = x;
            }
          });
          v = best;
          break;
        }
      }
      l.values[p.id] = l.def.type === 'number' ? Math.round(v * 10 ** l.def.decimals) / 10 ** l.def.decimals : v;
    }
  }
}

/**
 * After the map changed (a rebuild): province layers follow the province
 * count, rules marked "after every edit" run again, roll-ups refresh.
 */
export function refreshLayers(map: MapData): void {
  const layers = layersOf(map);
  if (!layers.length) return;
  for (const l of layers) {
    const n = layerLength(map, l.def);
    if (l.values.length !== n) {
      const v = new Float32Array(n).fill(l.def.defaultValue);
      const k = new Uint8Array(n);
      v.set(l.values.subarray(0, Math.min(n, l.values.length)));
      k.set(l.locked.subarray(0, Math.min(n, l.locked.length)));
      l.values = v;
      l.locked = k;
    }
  }
  const ctx = context(map);
  for (const l of layers) if (l.def.autoRun && l.def.rules.length) runRules(map, l, ctx);
  rollUps(map);
}

// ------------------------------------------------------------ presentation

export function formatValue(def: LayerDef, v: number): string {
  switch (def.type) {
    case 'category':
      return v < 0 ? '—' : (def.categories.find((c) => c.id === v)?.name ?? '—');
    case 'flag':
      return v ? 'Yes' : 'No';
    case 'tags': {
      const names = def.categories.filter((c) => (v >>> 0) & (1 << c.id)).map((c) => c.name);
      return names.length ? names.join(', ') : '—';
    }
    default:
      return v.toFixed(def.decimals);
  }
}

/**
 * The range a number layer's colours span: its own min and max, or for a
 * province roll-up (whose totals can run far past the hex range) the values
 * actually present.
 */
export function numberRange(layer: DataLayer): [number, number] {
  const def = layer.def;
  if (!def.rollUp) return [def.min, def.max];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of layer.values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) return [def.min, def.max];
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** Colour per hex (RGBA8) for the layer's map mode; alpha 0 = nothing here. */
export function layerColors(map: MapData, layer: DataLayer): Uint8Array {
  const n = map.grid.cols * map.grid.rows;
  const out = new Uint8Array(n * 4);
  const def = layer.def;
  const catColor = new Map(def.categories.map((c) => [c.id, c.color]));
  const [lo, hi] = def.type === 'number' ? numberRange(layer) : [0, 1];
  for (let h = 0; h < n; h++) {
    const idx = def.scope === 'hex' ? h : map.hex.province[h];
    if (idx < 0 || !(map.hex.flags[h] & HexFlag.Land)) continue;
    const v = layer.values[idx];
    let c: [number, number, number] | undefined;
    let a = 225;
    switch (def.type) {
      case 'category':
        c = v >= 0 ? catColor.get(v) : undefined;
        break;
      case 'flag':
        c = v ? (def.categories[0]?.color ?? [196, 70, 50]) : undefined;
        break;
      case 'tags': {
        // blend the colours of every tag present
        let r = 0;
        let g = 0;
        let b = 0;
        let k = 0;
        for (const cat of def.categories)
          if ((v >>> 0) & (1 << cat.id)) {
            r += cat.color[0];
            g += cat.color[1];
            b += cat.color[2];
            k++;
          }
        if (k) c = [r / k, g / k, b / k];
        break;
      }
      default: {
        const t = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0;
        c = [0, 1, 2].map((q) => def.colorLow[q] + (def.colorHigh[q] - def.colorLow[q]) * t) as [number, number, number];
        a = 235;
      }
    }
    if (!c) continue;
    out[h * 4] = c[0];
    out[h * 4 + 1] = c[1];
    out[h * 4 + 2] = c[2];
    out[h * 4 + 3] = a;
  }
  return out;
}

export function conditionSummary(cond: Condition): string {
  switch (cond.field) {
    case 'terrain':
      return `terrain is ${(cond.codes ?? []).map((c) => TERRAIN_NAMES[c as 0]).join(' or ') || 'anything'}`;
    case 'biome':
      return `biome is ${(cond.codes ?? []).map((c) => BIOME_NAMES[c as 0]).join(' or ') || 'anything'}`;
    case 'coastal':
      return cond.is === false ? 'not on the coast' : 'on the coast';
    case 'river':
      return cond.is === false ? 'not on a river' : 'on a river';
    case 'lake':
      return cond.is === false ? 'not by a lake' : 'by a lake';
    default:
      return `${CONDITION_NAMES[cond.field].toLowerCase().replace(' between', '')} ${cond.min ?? '…'}–${cond.max ?? '…'}`;
  }
}

// ---------------------------------------------------------------- files

export const TEMPLATE_FORMAT = 'cartographer-layer-template';

export function templateOf(defs: LayerDef[]): string {
  return JSON.stringify({ format: TEMPLATE_FORMAT, version: 1, layers: defs }, null, 2);
}

export function readTemplate(text: string): LayerDef[] {
  const obj = JSON.parse(text);
  if (obj?.format !== TEMPLATE_FORMAT || !Array.isArray(obj.layers)) throw new Error(t('This file is not a Cartographer layer template.'));
  return obj.layers as LayerDef[];
}

/** One CSV table per layer: hex layers by hex, province layers by province. */
export function layerCsv(map: MapData, layer: DataLayer): string {
  const def = layer.def;
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows: string[] = [];
  if (def.scope === 'hex') {
    rows.push('hex_id,col,row,q,r,value,label,set_by_hand');
    const { cols, rows: R } = map.grid;
    for (let row = 0; row < R; row++)
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        if (!(map.hex.flags[i] & HexFlag.Land)) continue;
        const q = col - (row - (row & 1)) / 2;
        rows.push([i, col, row, q, row, layer.values[i], esc(formatValue(def, layer.values[i])), layer.locked[i]].join(','));
      }
  } else {
    rows.push('province_id,province,value,label,set_by_hand');
    for (const p of map.provinces) {
      if (p.retired) continue;
      rows.push([p.id, esc(p.name), layer.values[p.id], esc(formatValue(def, layer.values[p.id])), layer.locked[p.id]].join(','));
    }
  }
  return rows.join('\n') + '\n';
}
