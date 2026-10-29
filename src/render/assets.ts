import type { LabelCurve, MapData } from '../model/types';
import { HexFlag, Terrain } from '../model/types';
import { buildNeighbors, hexAt, hexCenterX, hexCenterY, sampleField } from '../model/hex';
import { Rng } from '../util/rng';
import { Simplex2 } from '../util/noise';
import { distanceTransform } from './edt';
import { LAPSE } from '../gen/biomes';

/** Coast-distance texture: one texel per heightfield texel. */
export const COAST_SCALE = 8;
/** Gaussian kernel (σ², world units²) of the province vote. Shared with the shader. */
export const BORDER_SIGMA2 = 0.62;

/**
 * Smoothing of drawn borders before they snap to hex edges. 4X maps have few,
 * big hexes, so their smooth borders keep closer to the hexes (less wobble,
 * a narrower vote) to look like classic borders at the same screen size.
 */
export function borderBase(map: { meta: { params: { game?: { on: boolean } } } }): { sigma2: number; warp: number } {
  if (!map.meta.params.game?.on) return { sigma2: BORDER_SIGMA2, warp: 1 };
  return { sigma2: BORDER_SIGMA2 + (0.04 - BORDER_SIGMA2) * 0.15, warp: 0.75 };
}

export interface RiverMesh {
  /** x, y per vertex (world units) */
  position: Float32Array;
  /** perpendicular unit vector per vertex, side sign baked in */
  normal: Float32Array;
  /** full river width (world units) per vertex */
  width: Float32Array;
  index: Uint32Array;
}

export interface PointLabel {
  x: number;
  y: number;
  size: number;
  text: string;
  id: number;
}

export interface CurveLabel extends LabelCurve {
  text: string;
  id: number;
}

export interface RenderAssets {
  /** Distance to the coast, R8 (texels × COAST_SCALE), same grid as the heightfield. */
  coast: Uint8Array;
  coastW: number;
  coastH: number;
  /** Texels per world unit of the coast texture. */
  coastRes: number;
  /** Per hex, RGBA8: province+1 (16 bit LE in R,G), realm+1 (B,A). */
  hexOwners: Uint8Array;
  /** Per hex, RGBA8: region+1 (16 bit LE in R,G), biome code (B), terrain code (A). */
  hexAux: Uint8Array;
  /** Per hex, RGBA32F: elevation, temperature °C, moisture, flags. */
  hexData: Float32Array;
  /** Cultivation 0..1 in world space, 1 texel per world unit. */
  farm: Float32Array;
  farmW: number;
  farmH: number;
  /** Painted terrain as climate targets, RGBA32F, 1 texel per world unit:
   *  R sea-level temperature, G moisture, B weight. */
  paint: Float32Array;
  /** Border warp offsets (RG float), grid point i at world i / 2. */
  warp: Float32Array;
  warpW: number;
  warpH: number;
  realmLabels: CurveLabel[];
  regionLabels: CurveLabel[];
  provinceLabels: PointLabel[];
  river: RiverMesh;
  /** Realm colours, RGBA per realm id+1 (index 0 = none). */
  realmPalette: Uint8Array;
}

/** Border warp grid: 2 points per world unit. Deterministic from the seed. */
export function buildWarp(map: MapData): { warp: Float32Array; warpW: number; warpH: number } {
  const warpNoise = new Simplex2(new Rng(map.meta.params.seed).fork('border-warp'));
  const ww = Math.ceil(map.world.width * 2) + 2;
  const wh = Math.ceil(map.world.height * 2) + 2;
  const warp = new Float32Array(ww * wh * 2);
  for (let j = 0; j < wh; j++)
    for (let i = 0; i < ww; i++) {
      const x = i / 2;
      const y = j / 2;
      const k = (j * ww + i) * 2;
      warp[k] = 0.36 * warpNoise.fbm(x * 0.45, y * 0.45, 3) + 0.1 * warpNoise.noise(x * 2.1 + 9, y * 2.1);
      warp[k + 1] = 0.36 * warpNoise.fbm(x * 0.45 + 31, y * 0.45 - 17, 3) + 0.1 * warpNoise.noise(x * 2.1, y * 2.1 + 13);
    }
  return { warp, warpW: ww, warpH: wh };
}

export type OwnerLevel = 'province' | 'region' | 'realm';

/**
 * Who owns world point (x, y): the same warped Gaussian vote the shader uses
 * to draw borders, so a click always lands on the province that is drawn
 * there. Returns the province, region or realm id, or −1 for water.
 */
export function ownerAt(map: MapData, a: Pick<RenderAssets, 'warp' | 'warpW' | 'warpH'>, x: number, y: number, level: OwnerLevel = 'province'): number {
  const { grid, hex, provinces, regions } = map;
  if (sampleField(map.height, x, y) < 0) return -1;
  const ww = a.warpW;
  const wh = a.warpH;
  const fx = Math.max(0, Math.min(ww - 1.001, x * 2));
  const fy = Math.max(0, Math.min(wh - 1.001, y * 2));
  const ii = Math.floor(fx);
  const jj = Math.floor(fy);
  const tx = fx - ii;
  const ty = fy - jj;
  const W = a.warp;
  const at = (i: number, j: number, c: number) => W[(j * ww + i) * 2 + c];
  const dx = (at(ii, jj, 0) * (1 - tx) + at(ii + 1, jj, 0) * tx) * (1 - ty) + (at(ii, jj + 1, 0) * (1 - tx) + at(ii + 1, jj + 1, 0) * tx) * ty;
  const dy = (at(ii, jj, 1) * (1 - tx) + at(ii + 1, jj, 1) * tx) * (1 - ty) + (at(ii, jj + 1, 1) * (1 - tx) + at(ii + 1, jj + 1, 1) * tx) * ty;
  const base = borderBase(map);
  const px = x + dx * base.warp;
  const py = y + dy * base.warp;
  const idOf = (prov: number) => (level === 'province' ? prov : level === 'region' ? provinces[prov].region : regions[provinces[prov].region].realm);
  const h = hexAt(grid, px, py);
  if (h >= 0) {
    const nbr = neighborsOf(map);
    const ids: number[] = [];
    const ws: number[] = [];
    for (let d = -1; d < 6; d++) {
      const c = d < 0 ? h : nbr[h * 6 + d];
      if (c < 0) continue;
      const pc = hex.province[c];
      if (pc < 0) continue;
      const row = Math.floor(c / grid.cols);
      const wgt = Math.exp(-((hexCenterX(c % grid.cols, row) - px) ** 2 + (hexCenterY(row) - py) ** 2) / base.sigma2);
      const id = idOf(pc);
      const t = ids.indexOf(id);
      if (t >= 0) ws[t] += wgt;
      else {
        ids.push(id);
        ws.push(wgt);
      }
    }
    if (ids.length) {
      let best = 0;
      for (let t = 1; t < ids.length; t++) if (ws[t] > ws[best]) best = t;
      return ids[best];
    }
  }
  // land in a water hex (or warped off the grid): nearest land hex around it
  const h0 = hexAt(grid, x, y);
  const prov = nearestProvince(map, h0 >= 0 ? h0 : h, px, py);
  return prov < 0 ? -1 : idOf(prov);
}

const nbrCache = new WeakMap<object, Int32Array>();
/** Per worker: curved labels by realm/region, reused while their land is unchanged. */
const labelCache = new Map<string, { sig: number; name: string; label: LabelCurve | null }>();
function neighborsOf(map: MapData): Int32Array {
  let n = nbrCache.get(map.grid);
  if (!n) {
    n = buildNeighbors(map.grid);
    nbrCache.set(map.grid, n);
  }
  return n;
}

export function buildRenderAssets(
  map: MapData,
  onProgress: (s: string, f: number) => void = () => {},
  reuse?: Pick<RenderAssets, 'warp' | 'warpW' | 'warpH'>,
): RenderAssets {
  const { grid, hex, provinces, regions } = map;

  onProgress('Inking borders', 0.8);
  // the warp depends only on the seed: an edit can hand the previous one back
  const { warp, warpW, warpH } = reuse ? { warp: reuse.warp.slice(), warpW: reuse.warpW, warpH: reuse.warpH } : buildWarp(map);
  const provRealm = provinces.map((p) => (p.region >= 0 ? regions[p.region].realm : -1));

  onProgress('Measuring coasts', 0.86);
  const coastW = map.height.w;
  const coastH = map.height.h;
  const coast = new Uint8Array(coastW * coastH);
  {
    const hd = map.height.data;
    const seed = new Uint8Array(coastW * coastH);
    for (let j = 0; j < coastH; j++)
      for (let i = 0; i < coastW; i++) {
        const k = j * coastW + i;
        const l = hd[k] >= 0;
        if (i + 1 < coastW && l !== hd[k + 1] >= 0) seed[k] = seed[k + 1] = 1;
        if (j + 1 < coastH && l !== hd[k + coastW] >= 0) seed[k] = seed[k + coastW] = 1;
      }
    const d = distanceTransform(seed, coastW, coastH, 255 / COAST_SCALE);
    for (let k = 0; k < coast.length; k++) coast[k] = Math.round(d[k] * COAST_SCALE);
  }

  const nHex = grid.cols * grid.rows;
  const hexOwners = new Uint8Array(nHex * 4);
  const hexAux = new Uint8Array(nHex * 4);
  const hexData = new Float32Array(nHex * 4);
  for (let k = 0; k < nHex; k++) {
    const p = hex.province[k];
    if (p >= 0) {
      hexOwners[k * 4] = (p + 1) & 255;
      hexOwners[k * 4 + 1] = (p + 1) >> 8;
      hexOwners[k * 4 + 2] = (provRealm[p] + 1) & 255;
      hexOwners[k * 4 + 3] = (provRealm[p] + 1) >> 8;
      const rg = provinces[p].region + 1;
      hexAux[k * 4] = rg & 255;
      hexAux[k * 4 + 1] = rg >> 8;
    }
    hexAux[k * 4 + 2] = hex.biome[k];
    hexAux[k * 4 + 3] = hex.terrain[k];
    hexData[k * 4] = hex.elevation[k];
    hexData[k * 4 + 1] = hex.temperature[k];
    hexData[k * 4 + 2] = hex.moisture[k];
    hexData[k * 4 + 3] = hex.flags[k];
  }
  onProgress('Fields', 0.9);
  const { farm, farmW, farmH } = buildFarmField(map);
  const paint = buildPaintField(map, farmW, farmH);

  onProgress('Lettering', 0.92);
  const va = { warp, warpW, warpH };
  // Curved labels are the slow part of a rebuild; a realm or region whose
  // land did not change keeps the label it had.
  const cached = (kind: string, id: number, name: string, hexes: number[], make: () => LabelCurve | null) => {
    let sig = 2166136261 ^ hexes.length;
    for (const h of hexes) sig = Math.imul(sig ^ h, 16777619);
    const key = `${map.meta.params.seed}|${grid.cols}x${grid.rows}|${kind}|${id}`;
    const hit = labelCache.get(key);
    if (hit && hit.sig === sig && hit.name === name) return hit.label;
    const label = make();
    labelCache.set(key, { sig, name, label });
    return label;
  };
  const realmLabels: CurveLabel[] = [];
  map.realms.forEach((r) => {
    if (r.retired) return;
    const hexes: number[] = [];
    for (const rk of r.regions) for (const pk of regions[rk].provinces) for (const h of provinces[pk].hexes) hexes.push(h);
    const c = cached('realm', r.id, r.name, hexes, () => curveLabel(hexes.map((h) => hexXY(map, h)), r.id, (x, y) => ownerAt(map, va, x, y, 'realm'), r.name));
    if (c) realmLabels.push({ ...c, text: r.name, id: r.id });
  });
  const regionLabels: CurveLabel[] = [];
  regions.forEach((rg) => {
    if (rg.retired) return;
    const hexes: number[] = [];
    for (const pk of rg.provinces) for (const h of provinces[pk].hexes) hexes.push(h);
    const c = cached('region', rg.id, rg.name, hexes, () => curveLabel(hexes.map((h) => hexXY(map, h)), rg.id, (x, y) => ownerAt(map, va, x, y, 'region'), rg.name));
    if (c) regionLabels.push({ ...c, text: rg.name, id: rg.id });
  });
  const provinceLabels: PointLabel[] = [];
  for (const p of provinces) {
    if (p.retired || !p.hexes.length) continue;
    const [x, y] = labelPoint(map, p.hexes, p.id);
    provinceLabels.push({ x, y, size: Math.min(1.5, Math.max(0.55, Math.sqrt(p.hexes.length) * 0.2)), text: p.name, id: p.id });
  }

  onProgress('Rivers', 0.96);
  const river = buildRiverMesh(map);

  const realmPalette = new Uint8Array((map.realms.length + 1) * 4);
  map.realms.forEach((r) => {
    // free land (4X maps) has no wash: alpha 0 tells the shader
    realmPalette.set([r.color[0], r.color[1], r.color[2], r.unclaimed ? 0 : 255], (r.id + 1) * 4);
  });

  return { coast, coastW, coastH, coastRes: map.height.res, hexOwners, hexAux, hexData, farm, farmW, farmH, paint, warp, warpW, warpH, realmLabels, regionLabels, provinceLabels, river, realmPalette };
}

export function transferablesOf(a: RenderAssets): ArrayBuffer[] {
  return [a.coast.buffer, a.hexOwners.buffer, a.hexAux.buffer, a.hexData.buffer, a.farm.buffer, a.paint.buffer, a.warp.buffer, a.river.position.buffer, a.river.normal.buffer, a.river.width.buffer, a.river.index.buffer, a.realmPalette.buffer] as ArrayBuffer[];
}

function hexXY(map: MapData, h: number): [number, number] {
  const row = Math.floor(h / map.grid.cols);
  return [hexCenterX(h % map.grid.cols, row), hexCenterY(row)];
}

function nearestProvince(map: MapData, h: number, x: number, y: number): number {
  if (h < 0) return -1;
  const { cols, rows } = map.grid;
  const row = Math.floor(h / cols);
  const col = h % cols;
  let best = -1;
  let bd = Infinity;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const k = r * cols + c;
      const p = map.hex.province[k];
      if (p < 0) continue;
      const d = (hexCenterX(c, r) - x) ** 2 + (hexCenterY(r) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
  return best;
}

/** Point inside the province farthest from its edge (pole of inaccessibility on hexes). */
function labelPoint(map: MapData, hexes: number[], id: number): [number, number] {
  const set = new Set(hexes);
  const { cols, rows } = map.grid;
  const depth = new Map<number, number>();
  let frontier: number[] = [];
  for (const h of hexes) {
    const row = Math.floor(h / cols);
    const col = h % cols;
    const dirs = row & 1 ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]] : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
    let edge = false;
    for (const [dc, dr] of dirs) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows || map.hex.province[r * cols + c] !== id) edge = true;
    }
    if (edge) {
      depth.set(h, 0);
      frontier.push(h);
    }
  }
  let last = frontier.slice();
  let d = 0;
  while (frontier.length) {
    last = frontier;
    d++;
    const next: number[] = [];
    for (const h of frontier) {
      const row = Math.floor(h / cols);
      const col = h % cols;
      const dirs = row & 1 ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]] : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
      for (const [dc, dr] of dirs) {
        const c = col + dc;
        const r = row + dr;
        const k = r * cols + c;
        if (c < 0 || r < 0 || c >= cols || r >= rows || !set.has(k) || depth.has(k)) continue;
        depth.set(k, d);
        next.push(k);
      }
    }
    frontier = next;
  }
  // average of deepest hexes, snapped to the deepest one nearest that average
  let sx = 0;
  let sy = 0;
  for (const h of last) {
    const [x, y] = hexXY(map, h);
    sx += x;
    sy += y;
  }
  const ax = sx / last.length;
  const ay = sy / last.length;
  let best = last[0];
  let bd = Infinity;
  for (const h of last) {
    const [x, y] = hexXY(map, h);
    const dd = (x - ax) ** 2 + (y - ay) ** 2;
    if (dd < bd) {
      bd = dd;
      best = h;
    }
  }
  return hexXY(map, best);
}

/**
 * Fits a gentle curve along the long axis of a territory, the way Paradox
 * maps letter country names across their land.
 */
function curveLabel(pts: [number, number][], owner: number, ownerAt: (x: number, y: number) => number, text: string): LabelCurve | null {
  if (pts.length < 3) return null;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  // keep labels from going steeper than ~50°: tall realms read better slanted than vertical
  const maxA = 0.87;
  if (angle > maxA) angle = maxA;
  if (angle < -maxA) angle = -maxA;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const vx = -uy;
  const vy = ux;

  let tmin = Infinity;
  let tmax = -Infinity;
  for (const [x, y] of pts) {
    const t = (x - mx) * ux + (y - my) * uy;
    if (t < tmin) tmin = t;
    if (t > tmax) tmax = t;
  }
  const bins = 28;
  const span = tmax - tmin || 1;
  const smin = new Float32Array(bins).fill(Infinity);
  const smax = new Float32Array(bins).fill(-Infinity);
  for (const [x, y] of pts) {
    const t = (x - mx) * ux + (y - my) * uy;
    const s = (x - mx) * vx + (y - my) * vy;
    const b = Math.min(bins - 1, Math.floor(((t - tmin) / span) * bins));
    if (s < smin[b]) smin[b] = s;
    if (s > smax[b]) smax[b] = s;
  }
  // thickness and mid-line per bin, measured against the actual owned texels
  const thick = new Float32Array(bins);
  const mid = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    if (smin[b] === Infinity) continue;
    const t = tmin + ((b + 0.5) / bins) * span;
    // walk across the territory to find the longest run inside it
    let bestLen = 0;
    let bestMid = 0;
    let runStart = NaN;
    const step = 0.5;
    for (let s = smin[b] - 1; s <= smax[b] + 1 + step; s += step) {
      const x = mx + ux * t + vx * s;
      const y = my + uy * t + vy * s;
      const inside = ownerAt(x, y) === owner;
      if (inside && isNaN(runStart)) runStart = s;
      if ((!inside || s > smax[b] + 1) && !isNaN(runStart)) {
        const len = s - runStart;
        if (len > bestLen) {
          bestLen = len;
          bestMid = runStart + len / 2;
        }
        runStart = NaN;
      }
    }
    thick[b] = bestLen;
    mid[b] = bestMid;
  }
  let maxThick = 0;
  for (let b = 0; b < bins; b++) maxThick = Math.max(maxThick, thick[b]);
  if (maxThick <= 0) return null;
  // longest contiguous run of bins that are reasonably thick
  const minT = maxThick * 0.4;
  let bestA = 0;
  let bestB = -1;
  let a = -1;
  for (let b = 0; b <= bins; b++) {
    const ok = b < bins && thick[b] >= minT;
    if (ok && a < 0) a = b;
    if (!ok && a >= 0) {
      if (b - 1 - a > bestB - bestA) {
        bestA = a;
        bestB = b - 1;
      }
      a = -1;
    }
  }
  if (bestB < bestA) return null;
  // smooth the mid-line
  const sm = (b: number) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(bestA, b - 2); k <= Math.min(bestB, b + 2); k++) {
      s += mid[k];
      c++;
    }
    return s / c;
  };
  const pt = (b: number): [number, number] => {
    const t = tmin + ((b + 0.5) / bins) * span;
    const s = sm(b);
    return [mx + ux * t + vx * s, my + uy * t + vy * s];
  };
  let p0 = pt(bestA);
  let p2 = pt(bestB);
  const pm = pt(Math.round((bestA + bestB) / 2));
  let p1: [number, number] = [2 * pm[0] - (p0[0] + p2[0]) / 2, 2 * pm[1] - (p0[1] + p2[1]) / 2];
  // trim ends so letters stay off the border
  const lerp2 = (p: [number, number], q: [number, number], t: number): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  p0 = lerp2(p0, p1, 0.12);
  p2 = lerp2(p2, p1, 0.12);
  if (p2[0] < p0[0]) [p0, p2] = [p2, p0];
  const len = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
  let avgThick = 0;
  for (let b = bestA; b <= bestB; b++) avgThick += thick[b];
  avgThick /= bestB - bestA + 1;
  const chars = Math.max(3, text.length);
  const size = Math.max(0.8, Math.min(len / (chars * 0.62), avgThick * 0.42, 11));
  // tone down curvature: large bends read as errors
  const bend = Math.hypot(p1[0] - (p0[0] + p2[0]) / 2, p1[1] - (p0[1] + p2[1]) / 2);
  if (bend > len * 0.18) {
    const k = (len * 0.18) / bend;
    p1 = [(p0[0] + p2[0]) / 2 + (p1[0] - (p0[0] + p2[0]) / 2) * k, (p0[1] + p2[1]) / 2 + (p1[1] - (p0[1] + p2[1]) / 2) * k];
  }
  return { p0, p1, p2, size };
}

function buildRiverMesh(map: MapData): RiverMesh {
  const { hex, grid } = map;
  const rng = new Rng(map.meta.params.seed).fork('river-mesh');
  const pos: number[] = [];
  const nrm: number[] = [];
  const wid: number[] = [];
  const idx: number[] = [];
  // width scale: the same flow threshold the generator uses for rivers, so a
  // tiny hand-drawn stream does not make every other river swell
  const landFlux: number[] = [];
  for (let i = 0; i < hex.flux.length; i++) if (hex.flags[i] & HexFlag.Land) landFlux.push(hex.flux[i]);
  landFlux.sort((a, b) => a - b);
  const thr = Math.max(14, landFlux[Math.floor(landFlux.length * 0.935)] ?? 14);
  // stable per-hex jitter so confluences line up between rivers
  const jit = new Map<number, [number, number]>();
  const jitterOf = (h: number): [number, number] => {
    let j = jit.get(h);
    if (!j) {
      j = [rng.range(-0.3, 0.3), rng.range(-0.3, 0.3)];
      jit.set(h, j);
    }
    return j;
  };
  // strongest upstream feeder of each hex: lets a river emerge from a thin
  // spring instead of starting at full width
  const up = new Int32Array(hex.flowTo.length).fill(-1);
  for (let i = 0; i < hex.flowTo.length; i++) {
    const t = hex.flowTo[i];
    if (t >= 0 && (up[t] < 0 || hex.flux[i] > hex.flux[up[t]])) up[t] = i;
  }
  const smoothedAt = new Map<number, [number, number]>();
  const meander = new Simplex2(rng.fork('meander'));
  for (const r of map.rivers) {
    const path = r.hexes.slice();
    for (let k = 0; k < 2 && up[path[0]] >= 0; k++) path.unshift(up[path[0]]);
    const springs = path.length - r.hexes.length;
    let pts: [number, number, number][] = path.map((h, k) => {
      const [x, y] = hexXY(map, h);
      const last = k === path.length - 1;
      const [jx, jy] = last ? [0, 0] : jitterOf(h);
      const f = hex.flags[h] & HexFlag.Land ? hex.flux[h] : hex.flux[path[Math.max(0, k - 1)]];
      let w = Math.min(0.5, 0.07 + 0.075 * Math.log2(Math.max(f, thr * 0.5) / thr + 1));
      if (k < springs) w = 0.02 + 0.03 * k;
      else if (k === springs) w *= 0.6;
      return [x + jx, y + jy, w];
    });
    // mouth: stop just past the coast instead of the middle of the water hex
    const n0 = pts.length;
    if (n0 >= 2 && !(hex.flags[r.hexes[n0 - 1]] & HexFlag.Land)) {
      const a = pts[n0 - 2];
      const b = pts[n0 - 1];
      pts[n0 - 1] = [a[0] + (b[0] - a[0]) * 0.75, a[1] + (b[1] - a[1]) * 0.75, b[2] * 1.15];
    }
    for (let it = 0; it < 3; it++) pts = chaikin(pts);
    // meander: sideways wander along the course, fading out at both ends so
    // sources, mouths and confluences stay put
    {
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const L = cum[cum.length - 1];
      const disp = pts.map((_, k) => {
        const t = cum[k];
        const taper = Math.min(1, t / 1.6, (L - t) / 1.6);
        return taper <= 0 ? 0 : taper * (0.3 * meander.noise(t * 0.42, r.id * 7.7) + 0.12 * meander.noise(t * 1.3, r.id * 3.1 + 50));
      });
      pts = pts.map((q, k) => {
        const a = pts[Math.max(0, k - 1)];
        const b = pts[Math.min(pts.length - 1, k + 1)];
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        return [q[0] - ty * disp[k], q[1] + tx * disp[k], q[2]];
      });
    }
    // tributaries end exactly on the smoothed course of the river they join
    const end = r.hexes[r.hexes.length - 1];
    const joined = smoothedAt.get(end);
    if (joined && hex.flags[end] & HexFlag.Land) pts[pts.length - 1] = [joined[0], joined[1], pts[pts.length - 1][2]];
    // remember where this river's smoothed line passes each of its hexes
    for (const h of r.hexes) {
      if (smoothedAt.has(h)) continue;
      const [hx, hy] = hexXY(map, h);
      let best = pts[0];
      let bd = Infinity;
      for (const q of pts) {
        const d = (q[0] - hx) ** 2 + (q[1] - hy) ** 2;
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      smoothedAt.set(h, [best[0], best[1]]);
    }
    const base = pos.length / 2;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[Math.max(0, k - 1)];
      const q = pts[Math.min(pts.length - 1, k + 1)];
      let tx = q[0] - p[0];
      let ty = q[1] - p[1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      for (const side of [-1, 1]) {
        pos.push(pts[k][0], pts[k][1]);
        nrm.push(-ty * side, tx * side);
        wid.push(pts[k][2]);
      }
      if (k > 0) {
        const a = base + (k - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  void grid;
  return { position: new Float32Array(pos), normal: new Float32Array(nrm), width: new Float32Array(wid), index: new Uint32Array(idx) };
}

function chaikin(pts: [number, number, number][]): [number, number, number][] {
  if (pts.length < 3) return pts;
  const out: [number, number, number][] = [pts[0]];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * Where people farm: Farmland hexes, and the open, temperate land around
 * every settlement, strongest at the town and fading over two hexes.
 */
function buildFarmField(map: MapData): { farm: Float32Array; farmW: number; farmH: number } {
  const { hex, grid } = map;
  const farmW = Math.ceil(map.world.width) + 1;
  const farmH = Math.ceil(map.world.height) + 1;
  const farm = new Float32Array(farmW * farmH);
  const arable = (h: number) => {
    const t = hex.terrain[h];
    return t === Terrain.Plains || t === Terrain.Farmland || t === Terrain.Steppe || t === Terrain.Hills;
  };
  const splat = (h: number, strength: number, radius: number) => {
    const row = Math.floor(h / grid.cols);
    const cx = hexCenterX(h % grid.cols, row);
    const cy = hexCenterY(row);
    const R = radius * 2;
    for (let j = Math.max(0, Math.floor(cy - R)); j <= Math.min(farmH - 1, Math.ceil(cy + R)); j++)
      for (let i = Math.max(0, Math.floor(cx - R)); i <= Math.min(farmW - 1, Math.ceil(cx + R)); i++) {
        const d2 = (i - cx) ** 2 + (j - cy) ** 2;
        const k = j * farmW + i;
        farm[k] = Math.max(farm[k], strength * Math.exp(-d2 / (radius * radius)));
      }
  };
  for (let h = 0; h < hex.terrain.length; h++) if (hex.terrain[h] === Terrain.Farmland) splat(h, 1, 1.4);
  const nbr = buildNeighbors(grid);
  for (const p of map.provinces) {
    const c = p.capitalHex;
    if (p.retired || c < 0) continue;
    if (arable(c) && hex.temperature[c] > 2) splat(c, 1, 2.2);
    for (let d = 0; d < 6; d++) {
      const j = nbr[c * 6 + d];
      if (j >= 0 && arable(j) && hex.temperature[j] > 2) splat(j, 0.7, 1.6);
    }
  }
  // hand-painted terrain other than farmland clears the fields under it
  const over = map.edits?.terrain;
  if (over) {
    for (let h = 0; h < over.length; h++) {
      if (over[h] < 0 || over[h] === Terrain.Farmland) continue;
      const row = Math.floor(h / grid.cols);
      const cx = hexCenterX(h % grid.cols, row);
      const cy = hexCenterY(row);
      for (let j = Math.max(0, Math.floor(cy - 2)); j <= Math.min(farmH - 1, Math.ceil(cy + 2)); j++)
        for (let i = Math.max(0, Math.floor(cx - 2)); i <= Math.min(farmW - 1, Math.ceil(cx + 2)); i++) {
          const d2 = (i - cx) ** 2 + (j - cy) ** 2;
          farm[j * farmW + i] *= 1 - Math.exp(-d2 / 0.8);
        }
    }
  }
  return { farm, farmW, farmH };
}

/** Sea-level temperature and moisture that make the shader draw a terrain. */
export function paintTargets(t: Terrain, tempC: number): [number, number] | null {
  const c = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  switch (t) {
    case Terrain.Plains:
      return [c(tempC, 3, 24), 0.3];
    case Terrain.Farmland:
      return [c(tempC, 5, 24), 0.38];
    case Terrain.Forest:
      return [c(tempC, 4, 18), 0.74];
    case Terrain.Jungle:
      return [Math.max(tempC, 25), 0.88];
    case Terrain.Taiga:
      return [c(tempC, -1, 4), 0.62];
    case Terrain.Desert:
      return [Math.max(tempC, 20), 0.04];
    case Terrain.Steppe:
      return [c(tempC, 6, 22), 0.2];
    case Terrain.Tundra:
      return [c(tempC, -6, -2), 0.25];
    case Terrain.Glacier:
      return [Math.min(tempC, -14), 0.4];
    case Terrain.Marsh:
      return [c(tempC, 4, 22), 0.6];
    default:
      return null;
  }
}

function buildPaintField(map: MapData, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  const over = map.edits?.terrain;
  if (!over) return out;
  const { grid, hex } = map;
  const sumT = new Float32Array(w * h);
  const sumM = new Float32Array(w * h);
  const sumW = new Float32Array(w * h);
  for (let k = 0; k < over.length; k++) {
    if (over[k] < 0) continue;
    const tg = paintTargets(over[k] as Terrain, hex.temperature[k]);
    if (!tg) continue;
    // the shader subtracts the altitude lapse itself
    const seaT = tg[0] + Math.max(0, hex.elevation[k]) * LAPSE;
    const row = Math.floor(k / grid.cols);
    const cx = hexCenterX(k % grid.cols, row);
    const cy = hexCenterY(row);
    for (let j = Math.max(0, Math.floor(cy - 3)); j <= Math.min(h - 1, Math.ceil(cy + 3)); j++)
      for (let i = Math.max(0, Math.floor(cx - 3)); i <= Math.min(w - 1, Math.ceil(cx + 3)); i++) {
        const wt = Math.exp(-((i - cx) ** 2 + (j - cy) ** 2) / 1.6);
        const q = j * w + i;
        sumT[q] += seaT * wt;
        sumM[q] += tg[1] * wt;
        sumW[q] += wt;
      }
  }
  for (let q = 0; q < w * h; q++) {
    if (sumW[q] <= 0) continue;
    out[q * 4] = sumT[q] / sumW[q];
    out[q * 4 + 1] = sumM[q] / sumW[q];
    out[q * 4 + 2] = Math.min(1, sumW[q]);
  }
  return out;
}
