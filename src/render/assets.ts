import type { LabelCurve, MapData } from '../model/types';
import { HexFlag } from '../model/types';
import { buildNeighbors, hexAt, hexCenterX, hexCenterY, sampleField } from '../model/hex';
import { Rng } from '../util/rng';
import { Simplex2 } from '../util/noise';
import { distanceTransform } from './edt';

/** Texels per world unit for the ID and border-distance textures. */
export const ID_RES = 6;
/** Border-distance channels store texels × this scale (max 255 / scale). */
export const COAST_SCALE = 4;
/** Gaussian kernel (σ², world units²) of the province vote. Shared with the shader. */
export const BORDER_SIGMA2 = 0.62;

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
  idW: number;
  idH: number;
  /** Province+1 per texel (same vote as the shader), for picking. */
  provinceIds: Uint16Array;
  /** RGBA8; B = distance to the coast (texels × COAST_SCALE). Other channels reserved. */
  distData: Uint8Array;
  /** Per hex, RGBA8: province+1 (16 bit LE in R,G), realm+1 (B,A). */
  hexOwners: Uint8Array;
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

export function buildRenderAssets(map: MapData, onProgress: (s: string, f: number) => void = () => {}): RenderAssets {
  const { world, grid, hex, provinces, regions } = map;
  const idW = Math.ceil(world.width * ID_RES);
  const idH = Math.ceil(world.height * ID_RES);
  const n = idW * idH;

  onProgress('Inking borders', 0.8);
  // Organic borders: hex lookups use a gently warped position, so province
  // edges meander instead of following hex sides. Coasts come from the
  // continuous heightfield and are smooth already.
  const warpNoise = new Simplex2(new Rng(map.meta.params.seed).fork('border-warp'));
  const ww = Math.ceil(world.width * 2) + 2;
  const wh = Math.ceil(world.height * 2) + 2;
  const warpX = new Float32Array(ww * wh);
  const warpY = new Float32Array(ww * wh);
  for (let j = 0; j < wh; j++)
    for (let i = 0; i < ww; i++) {
      const x = i / 2;
      const y = j / 2;
      warpX[j * ww + i] = 0.36 * warpNoise.fbm(x * 0.45, y * 0.45, 3) + 0.1 * warpNoise.noise(x * 2.1 + 9, y * 2.1);
      warpY[j * ww + i] = 0.36 * warpNoise.fbm(x * 0.45 + 31, y * 0.45 - 17, 3) + 0.1 * warpNoise.noise(x * 2.1, y * 2.1 + 13);
    }

  const provOf = new Uint16Array(n);
  const realmOf = new Uint16Array(n);
  const regionOf = new Uint16Array(n);
  const land = new Uint8Array(n);
  const provRealm = provinces.map((p) => regions[p.region].realm);
  const nbr = buildNeighbors(grid);
  const hcx = new Float32Array(grid.cols * grid.rows);
  const hcy = new Float32Array(grid.cols * grid.rows);
  for (let k = 0; k < hcx.length; k++) {
    const row = Math.floor(k / grid.cols);
    hcx[k] = hexCenterX(k % grid.cols, row);
    hcy[k] = hexCenterY(row);
  }
  const candP = new Int32Array(7);
  const candW = new Float64Array(7);
  for (let j = 0; j < idH; j++) {
    const y = (j + 0.5) / ID_RES;
    for (let i = 0; i < idW; i++) {
      const x = (i + 0.5) / ID_RES;
      const k = j * idW + i;
      if (sampleField(map.height, x, y) < 0) continue;
      land[k] = 1;
      const fx = x * 2;
      const fy = y * 2;
      const ii = Math.min(ww - 2, Math.floor(fx));
      const jj = Math.min(wh - 2, Math.floor(fy));
      const tx = fx - ii;
      const ty = fy - jj;
      const kk = jj * ww + ii;
      const dx = (warpX[kk] * (1 - tx) + warpX[kk + 1] * tx) * (1 - ty) + (warpX[kk + ww] * (1 - tx) + warpX[kk + ww + 1] * tx) * ty;
      const dy = (warpY[kk] * (1 - tx) + warpY[kk + 1] * tx) * (1 - ty) + (warpY[kk + ww] * (1 - tx) + warpY[kk + ww + 1] * tx) * ty;
      const px = x + dx;
      const py = y + dy;
      const h = hexAt(grid, px, py);
      // Gaussian vote among the hex and its neighbours: rounds the hex
      // zig-zag into smooth curves while every hex centre keeps its owner.
      let prov = -1;
      if (h >= 0) {
        let bestW = 0;
        let nCand = 0;
        for (let d = -1; d < 6; d++) {
          const c = d < 0 ? h : nbr[h * 6 + d];
          if (c < 0) continue;
          const pc = hex.province[c];
          if (pc < 0) continue;
          const wgt = Math.exp(-((hcx[c] - px) ** 2 + (hcy[c] - py) ** 2) / BORDER_SIGMA2);
          let found = false;
          for (let t = 0; t < nCand; t++)
            if (candP[t] === pc) {
              candW[t] += wgt;
              found = true;
              break;
            }
          if (!found) {
            candP[nCand] = pc;
            candW[nCand++] = wgt;
          }
        }
        for (let t = 0; t < nCand; t++)
          if (candW[t] > bestW) {
            bestW = candW[t];
            prov = candP[t];
          }
      }
      if (prov < 0) {
        // land texel in a water hex (or warped off-grid): nearest land hex around it
        const h0 = hexAt(grid, x, y);
        prov = nearestProvince(map, h0 >= 0 ? h0 : h, px, py);
      }
      if (prov < 0) continue;
      provOf[k] = prov + 1;
      realmOf[k] = provRealm[prov] + 1;
      regionOf[k] = provinces[prov].region + 1;
    }
  }

  onProgress('Measuring coasts', 0.86);
  const distData = new Uint8Array(n * 4);
  {
    const seed = new Uint8Array(n);
    for (let j = 0; j < idH; j++)
      for (let i = 0; i < idW; i++) {
        const k = j * idW + i;
        if (i + 1 < idW && land[k] !== land[k + 1]) seed[k] = seed[k + 1] = 1;
        if (j + 1 < idH && land[k] !== land[k + idW]) seed[k] = seed[k + idW] = 1;
      }
    const d = distanceTransform(seed, idW, idH, 255 / COAST_SCALE);
    for (let k = 0; k < n; k++) distData[k * 4 + 2] = Math.round(d[k] * COAST_SCALE);
  }

  const hexOwners = new Uint8Array(grid.cols * grid.rows * 4);
  for (let k = 0; k < grid.cols * grid.rows; k++) {
    const p = hex.province[k];
    if (p < 0) continue;
    hexOwners[k * 4] = (p + 1) & 255;
    hexOwners[k * 4 + 1] = (p + 1) >> 8;
    hexOwners[k * 4 + 2] = (provRealm[p] + 1) & 255;
    hexOwners[k * 4 + 3] = (provRealm[p] + 1) >> 8;
  }
  const warp = new Float32Array(ww * wh * 2);
  for (let k = 0; k < ww * wh; k++) {
    warp[k * 2] = warpX[k];
    warp[k * 2 + 1] = warpY[k];
  }

  onProgress('Lettering', 0.92);
  const texelOwner = (ids: Uint16Array) => (x: number, y: number) => {
    const i = Math.floor(x * ID_RES);
    const j = Math.floor(y * ID_RES);
    if (i < 0 || j < 0 || i >= idW || j >= idH) return 0;
    return ids[j * idW + i];
  };
  const realmLabels: CurveLabel[] = [];
  map.realms.forEach((r) => {
    const pts: [number, number][] = [];
    for (const rk of r.regions) for (const pk of regions[rk].provinces) for (const h of provinces[pk].hexes) pts.push(hexXY(map, h));
    const c = curveLabel(pts, r.id + 1, texelOwner(realmOf), r.name);
    if (c) realmLabels.push({ ...c, text: r.name, id: r.id });
  });
  const regionLabels: CurveLabel[] = [];
  regions.forEach((rg) => {
    const pts: [number, number][] = [];
    for (const pk of rg.provinces) for (const h of provinces[pk].hexes) pts.push(hexXY(map, h));
    const c = curveLabel(pts, rg.id + 1, texelOwner(regionOf), rg.name);
    if (c) regionLabels.push({ ...c, text: rg.name, id: rg.id });
  });
  const provinceLabels = provinces.map((p) => {
    const [x, y] = labelPoint(map, p.hexes, p.id);
    return { x, y, size: Math.min(1.5, Math.max(0.55, Math.sqrt(p.hexes.length) * 0.2)), text: p.name, id: p.id };
  });

  const river = buildRiverMesh(map);

  const realmPalette = new Uint8Array((map.realms.length + 1) * 4);
  map.realms.forEach((r) => {
    realmPalette.set([r.color[0], r.color[1], r.color[2], 255], (r.id + 1) * 4);
  });

  return { idW, idH, provinceIds: provOf, distData, hexOwners, warp, warpW: ww, warpH: wh, realmLabels, regionLabels, provinceLabels, river, realmPalette };
}

export function transferablesOf(a: RenderAssets): ArrayBuffer[] {
  return [a.hexOwners.buffer, a.warp.buffer, a.provinceIds.buffer, a.distData.buffer, a.river.position.buffer, a.river.normal.buffer, a.river.width.buffer, a.river.index.buffer, a.realmPalette.buffer] as ArrayBuffer[];
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
  let thr = Infinity;
  for (const r of map.rivers) thr = Math.min(thr, hex.flux[r.hexes[0]]);
  if (!isFinite(thr)) thr = 1;
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
  for (const r of map.rivers) {
    const path = r.hexes.slice();
    for (let k = 0; k < 2 && up[path[0]] >= 0; k++) path.unshift(up[path[0]]);
    const springs = path.length - r.hexes.length;
    let pts: [number, number, number][] = path.map((h, k) => {
      const [x, y] = hexXY(map, h);
      const last = k === path.length - 1;
      const [jx, jy] = last ? [0, 0] : jitterOf(h);
      const f = hex.flags[h] & HexFlag.Land ? hex.flux[h] : hex.flux[path[Math.max(0, k - 1)]];
      let w = Math.min(0.5, 0.07 + 0.075 * Math.log2(f / thr + 1));
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
