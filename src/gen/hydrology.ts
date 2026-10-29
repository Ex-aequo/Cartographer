import type { EditLayers, Field, GenParams, HexLayers, River } from '../model/types';
import { Biome, HexFlag, Relief } from '../model/types';
import { buildNeighbors, hexCenterX, hexCenterY, sampleField, type Grid } from '../model/hex';
import { MinHeap } from '../util/heap';
import { landBiome, landRelief, terrainFor, LAPSE } from './biomes';
import { Rng } from '../util/rng';
import { Simplex2, smoothstep } from '../util/noise';

/**
 * Samples the art fields at every hex centre and derives the hex data:
 * water bodies, lakes, drainage, rivers, biome, relief and terrain.
 * Lakes are carved back into the heightfield so the art matches the data.
 */
export interface HexBuildOptions {
  /** Turn enclosed depressions into lakes (generation only; edits make lakes by hand). */
  autoLakes?: boolean;
  edits?: EditLayers;
}

export function buildHexes(
  p: GenParams,
  grid: Grid,
  height: Field,
  baseTemp: Field,
  moisture: Field,
  rngRoot: Rng,
  opts: HexBuildOptions = {},
): { hex: HexLayers; nbr: Int32Array; rivers: River[] } {
  const autoLakes = opts.autoLakes ?? true;
  const edits = opts.edits;
  const n = grid.cols * grid.rows;
  const nbr = buildNeighbors(grid);
  const hex: HexLayers = {
    elevation: new Float32Array(n),
    temperature: new Float32Array(n),
    moisture: new Float32Array(n),
    biome: new Uint8Array(n),
    relief: new Uint8Array(n),
    terrain: new Uint8Array(n),
    flags: new Uint8Array(n),
    flux: new Float32Array(n),
    flowTo: new Int32Array(n).fill(-1),
    province: new Int32Array(n).fill(-1),
  };
  const rough = new Float32Array(n);

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const i = row * grid.cols + col;
      const x = hexCenterX(col, row);
      const y = hexCenterY(row);
      const e = sampleField(height, x, y);
      hex.elevation[i] = e;
      let lo = e;
      let hi = e;
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const s = sampleField(height, x + Math.cos(a) * 0.72, y + Math.sin(a) * 0.72);
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      rough[i] = hi - lo;
      hex.moisture[i] = sampleField(moisture, x, y);
      hex.temperature[i] = sampleField(baseTemp, x, y) - Math.max(0, e) * LAPSE;
      if (e >= 0) hex.flags[i] |= HexFlag.Land;
    }
  }

  // --- Water bodies: enclosed small water becomes lake, the rest is ocean.
  const isOcean = new Uint8Array(n);
  const isLake = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s] || hex.flags[s] & HexFlag.Land) continue;
    const comp: number[] = [];
    let touchesEdge = false;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j < 0) {
          touchesEdge = true;
          continue;
        }
        if (!seen[j] && !(hex.flags[j] & HexFlag.Land)) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const lake = !touchesEdge && comp.length < 60;
    for (const i of comp) (lake ? isLake : isOcean)[i] = 1;
  }

  // --- Routing surface: elevation with a faint network of valleys along the
  // zero lines of a noise field, so water on broad slopes gathers into
  // branching rivers instead of running down in parallel lines.
  const valleyNoise = new Simplex2(rngRoot.fork('valleys'));
  const route = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const e = hex.elevation[i];
    if (!(hex.flags[i] & HexFlag.Land)) {
      route[i] = e;
      continue;
    }
    const row = Math.floor(i / grid.cols);
    const x = hexCenterX(i % grid.cols, row);
    const y = hexCenterY(row);
    const v = 1 - Math.abs(valleyNoise.fbm(x / 9, y / 9, 3));
    route[i] = e - 0.035 * v * v * v;
  }

  // --- Priority flood from the ocean: gives every land hex a drainage path.
  const filled = new Float32Array(n).fill(Infinity);
  const heap = new MinHeap(n);
  for (let i = 0; i < n; i++) {
    if (isOcean[i]) {
      filled[i] = hex.elevation[i];
      // only shore ocean hexes need to seed the flood
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j >= 0 && !isOcean[j]) {
          heap.push(i, 0);
          break;
        }
      }
    }
  }
  const order: number[] = [];
  const eps = 1e-5;
  while (heap.size) {
    const i = heap.pop();
    for (let d = 0; d < 6; d++) {
      const j = nbr[i * 6 + d];
      if (j < 0 || isOcean[j] || filled[j] !== Infinity) continue;
      const base = isOcean[i] ? 0 : filled[i];
      filled[j] = Math.max(isLake[j] ? 0 : route[j], base + eps);
      hex.flowTo[j] = i;
      order.push(j);
      heap.push(j, filled[j]);
    }
  }

  // --- Depression lakes: land sitting well below its spill level.
  const rng = rngRoot.fork('lakes');
  const cand = new Uint8Array(n);
  for (const i of order) if (hex.flags[i] & HexFlag.Land && filled[i] - route[i] > 0.02) cand[i] = 1;
  const lseen = new Uint8Array(n);
  const newLake = new Uint8Array(n);
  let lakeBudget = autoLakes ? Math.round((n / 4000) * (0.6 + p.rainfall * 0.6)) : 0;
  for (let s = 0; s < n && lakeBudget > 0; s++) {
    if (!cand[s] || lseen[s]) continue;
    const comp: number[] = [];
    stack.push(s);
    lseen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j >= 0 && cand[j] && !lseen[j]) {
          lseen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (comp.length >= 2 && comp.length <= 40 && rng.chance(0.85)) {
      for (const i of comp) {
        isLake[i] = 1;
        newLake[i] = 1;
        hex.flags[i] &= ~HexFlag.Land;
      }
      lakeBudget--;
    }
  }

  // New lakes are carved into the art heightfield as smooth basins (lakes
  // that are already water in the heightfield are left as they are).
  const lakeCenters: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!newLake[i]) continue;
    hex.elevation[i] = -0.04;
    lakeCenters.push([hexCenterX(i % grid.cols, Math.floor(i / grid.cols)), hexCenterY(Math.floor(i / grid.cols))]);
  }
  carveLakes(height, lakeCenters, rng);
  if (lakeCenters.length) {
    for (let i = 0; i < n; i++) {
      if (!(hex.flags[i] & HexFlag.Land)) continue;
      const row = Math.floor(i / grid.cols);
      hex.elevation[i] = Math.max(0.001, sampleField(height, hexCenterX(i % grid.cols, row), hexCenterY(row)));
    }
  }

  // --- Hand-drawn rivers: their hexes drain along the drawn path, and the
  // end of the path drains on to the sea without ever running back into it.
  const forced = new Uint8Array(n);
  if (edits) {
    const chainHits = (start: number, avoid: Set<number>) => {
      for (let j = start, g = 0; j >= 0 && !isOcean[j] && g < n; g++, j = hex.flowTo[j]) if (avoid.has(j)) return true;
      return false;
    };
    for (const raw of edits.riverPaths) {
      // the land part of the path, plus the water hex it runs into (if any)
      let m = 0;
      while (m < raw.length && hex.flags[raw[m]] & HexFlag.Land) m++;
      if (m === 0) continue;
      const path = raw.slice(0, m);
      for (const h of path) forced[h] = 1;
      const inPath = new Set(path);
      const end = path[m - 1];
      if (m < raw.length && isNeighbor(nbr, end, raw[m])) {
        hex.flowTo[end] = raw[m];
      } else if (chainHits(hex.flowTo[end], inPath)) {
        // the land around the end drains back up the path: lead it out the shortest way
        const parent = new Map<number, number>([[end, -1]]);
        const queue = [end];
        let exit = -1;
        for (let q = 0; q < queue.length && exit < 0 && q < 4000; q++) {
          const i = queue[q];
          for (let d = 0; d < 6 && exit < 0; d++) {
            const j = nbr[i * 6 + d];
            if (j < 0 || parent.has(j) || inPath.has(j)) continue;
            parent.set(j, i);
            const route = new Set<number>(inPath);
            for (let r = i; r >= 0; r = parent.get(r)!) route.add(r);
            if (!(hex.flags[j] & HexFlag.Land) || !chainHits(hex.flowTo[j], route)) exit = j;
            else queue.push(j);
          }
        }
        if (exit >= 0) for (let r = exit; parent.get(r)! >= 0; r = parent.get(r)!) hex.flowTo[parent.get(r)!] = r;
      }
      for (let k = m - 2; k >= 0; k--) hex.flowTo[path[k]] = path[k + 1];
    }
  }

  // --- Drainage order: every hex after everything that drains into it.
  const indeg = new Int32Array(n);
  for (const i of order) {
    const t = hex.flowTo[i];
    if (t >= 0 && !isOcean[t]) indeg[t]++;
  }
  const topo: number[] = [];
  for (const i of order) if (indeg[i] === 0) topo.push(i);
  for (let q = 0; q < topo.length; q++) {
    const t = hex.flowTo[topo[q]];
    if (t >= 0 && !isOcean[t] && --indeg[t] === 0) topo.push(t);
  }

  // --- Flow accumulation.
  const precip = new Float32Array(n);
  for (let i = 0; i < n; i++) if (!isOcean[i]) precip[i] = 0.25 + hex.moisture[i] * 1.6;
  for (const i of topo) {
    hex.flux[i] += precip[i];
    const t = hex.flowTo[i];
    if (t >= 0 && !isOcean[t]) hex.flux[t] += hex.flux[i];
    // a drawn river carries on downstream
    if (forced[i] && t >= 0 && hex.flags[t] & HexFlag.Land) forced[t] = 1;
  }
  // an erased hex takes everything upstream of it with it
  const blocked = new Uint8Array(n);
  if (edits) {
    for (let q = topo.length - 1; q >= 0; q--) {
      const i = topo[q];
      const t = hex.flowTo[i];
      if (edits.riverBlock[i] || (t >= 0 && hex.flags[t] & HexFlag.Land && blocked[t])) blocked[i] = 1;
    }
  }

  // --- Rivers: hexes whose flow passes the threshold.
  const landFlux: number[] = [];
  for (let i = 0; i < n; i++) if (hex.flags[i] & HexFlag.Land) landFlux.push(hex.flux[i]);
  landFlux.sort((a, b) => a - b);
  const threshold = Math.max(14, landFlux[Math.floor(landFlux.length * 0.935)] ?? 14);
  const isRiver = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (hex.flags[i] & HexFlag.Land && (hex.flux[i] >= threshold || forced[i]) && !blocked[i]) isRiver[i] = 1;
  const hasRiverUpstream = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (isRiver[i] && hex.flowTo[i] >= 0) hasRiverUpstream[hex.flowTo[i]] = 1;
  const sources: number[] = [];
  for (let i = 0; i < n; i++) if (isRiver[i] && !hasRiverUpstream[i]) sources.push(i);
  // longest-reaching rivers first so the main stem owns its course
  sources.sort((a, b) => filled[b] - filled[a]);
  const used = new Uint8Array(n);
  const rivers: River[] = [];
  for (const s of sources) {
    const path: number[] = [];
    const marked: number[] = [];
    let i = s;
    let guard = 0;
    while (i >= 0 && guard++ < n) {
      path.push(i);
      if (used[i] || !(hex.flags[i] & HexFlag.Land)) break;
      used[i] = 1;
      marked.push(i);
      i = hex.flowTo[i];
    }
    if (path.length >= 4 || (path.length >= 2 && forced[s])) {
      rivers.push({ id: rivers.length, name: '', hexes: path });
      for (const k of marked) hex.flags[k] |= HexFlag.River;
    } else {
      for (const k of marked) used[k] = 0;
    }
  }

  // --- Classification.
  for (let i = 0; i < n; i++) {
    const e = hex.elevation[i];
    if (isLake[i]) {
      hex.flags[i] |= HexFlag.Lake;
      hex.biome[i] = Biome.Lake;
      hex.relief[i] = Relief.ShallowWater;
    } else if (isOcean[i]) {
      hex.biome[i] = Biome.Ocean;
      hex.relief[i] = e < -0.22 ? Relief.DeepWater : Relief.ShallowWater;
    } else {
      hex.biome[i] = landBiome(hex.temperature[i], hex.moisture[i], e);
      hex.relief[i] = landRelief(e, rough[i]);
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j >= 0 && !(hex.flags[j] & HexFlag.Land)) {
          hex.flags[i] |= HexFlag.Coastal;
          break;
        }
      }
    }
    const fertile = !!(hex.flags[i] & HexFlag.River) && hex.temperature[i] > 6 && hex.temperature[i] < 28;
    hex.terrain[i] = terrainFor(hex.biome[i], hex.relief[i], fertile);
    // painted terrain wins on land
    if (edits && edits.terrain[i] >= 0 && hex.flags[i] & HexFlag.Land) hex.terrain[i] = edits.terrain[i];
  }

  enforceCoasts(height, grid, hex);
  return { hex, nbr, rivers };
}

/**
 * Guarantees that the art agrees with the data at every hex centre: land hexes
 * get a small mound of dry ground there, water hexes a small dip. Radius stays
 * well inside the hex, so neighbouring hexes never compete.
 */
function enforceCoasts(f: Field, grid: Grid, hex: HexLayers): void {
  // Full strength over everything the centre checks below read (bilinear
  // footprint ≤ 0.77), fading out before the hex edge (0.866). Full strength
  // matters: a partial blend would creep a little further on every rebuild.
  const R = 0.86;
  const FULL = 0.78;
  const LEVEL = 0.006;
  for (let i = 0; i < grid.cols * grid.rows; i++) {
    const land = (hex.flags[i] & HexFlag.Land) !== 0;
    const row = Math.floor(i / grid.cols);
    const cx = hexCenterX(i % grid.cols, row);
    const cy = hexCenterY(row);
    // skip hexes that are already clearly on the right side
    // skip hexes whose whole centre area is already on the right side
    let ok = true;
    for (let k = 0; k < 7 && ok; k++) {
      const a = (Math.PI / 3) * k;
      const r = k === 6 ? 0 : 0.3;
      const c = sampleField(f, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      if (land ? c < 0.002 : c > -0.002) ok = false;
    }
    if (ok) continue;
    const i0 = Math.max(0, Math.floor((cx - R) * f.res));
    const i1 = Math.min(f.w - 1, Math.ceil((cx + R) * f.res));
    const j0 = Math.max(0, Math.floor((cy - R) * f.res));
    const j1 = Math.min(f.h - 1, Math.ceil((cy + R) * f.res));
    for (let j = j0; j <= j1; j++)
      for (let k = i0; k <= i1; k++) {
        const d = Math.hypot((k + 0.5) / f.res - cx, (j + 0.5) / f.res - cy);
        const w = 1 - smoothstep(FULL, R, d);
        if (w <= 0) continue;
        const idx = j * f.w + k;
        const h = f.data[idx];
        f.data[idx] = land ? Math.max(h, h + (LEVEL - h) * w) : Math.min(h, h + (-LEVEL - h) * w);
      }
  }
}

/**
 * Lake basins from a sum of Gaussian kernels on lake hex centres: adjacent
 * lake hexes merge into one smooth body, and a little noise keeps the shore
 * from looking machine-made. Land hex centres stay land.
 */
function isNeighbor(nbr: Int32Array, a: number, b: number): boolean {
  for (let d = 0; d < 6; d++) if (nbr[a * 6 + d] === b) return true;
  return false;
}

function carveLakes(f: Field, centers: [number, number][], rng: Rng): void {
  if (!centers.length) return;
  const noise = new Simplex2(rng.fork('lake-shore'));
  const n = f.w * f.h;
  const Lw = new Float32Array(n); // tight kernel: the water body
  const Lb = new Float32Array(n); // wide kernel: the valley floor around it
  const touched = new Uint8Array(n);
  const R = 4.2;
  for (const [cx, cy] of centers) {
    const i0 = Math.max(0, Math.floor((cx - R) * f.res));
    const i1 = Math.min(f.w - 1, Math.ceil((cx + R) * f.res));
    const j0 = Math.max(0, Math.floor((cy - R) * f.res));
    const j1 = Math.min(f.h - 1, Math.ceil((cy + R) * f.res));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) / f.res;
        const y = (j + 0.5) / f.res;
        const d2 = (x - cx) ** 2 + (y - cy) ** 2;
        const k = j * f.w + i;
        Lw[k] += Math.exp(-d2 / 0.65);
        Lb[k] += Math.exp(-d2 / 4.2);
        touched[k] = 1;
      }
  }
  for (let k = 0; k < n; k++) {
    if (!touched[k]) continue;
    const x = ((k % f.w) + 0.5) / f.res;
    const y = (Math.floor(k / f.w) + 0.5) / f.res;
    const wobble = 0.85 + 0.3 * (0.5 + 0.5 * noise.noise(x * 1.3, y * 1.3));
    const lw = Lw[k] * wobble;
    const h = f.data[k];
    // lower the surroundings into a basin so the lake does not sit in a pit
    const floorK = smoothstep(0.02, 0.9, Lb[k]);
    let out = h > 0.03 ? h + (0.03 - h) * floorK : h;
    if (lw > 0.2) {
      // flat-bottomed water body; shallow so the surface reads as one sheet
      const water = 0.03 - 0.068 * smoothstep(0.2, 0.55, lw);
      out = Math.min(out, water);
    }
    f.data[k] = out;
  }
}
