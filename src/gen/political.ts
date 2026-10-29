import type { Culture, GenParams, HexLayers, Province, Realm, Region, River } from '../model/types';
import { HexFlag, Relief, Terrain } from '../model/types';
import { hexCenterX, hexCenterY, type Grid } from '../model/hex';
import { MinHeap } from '../util/heap';
import { Rng } from '../util/rng';
import { makeCulture, NameForge, PALETTE_COUNT, type NameCulture } from './names';

const HEX_AREA = 2.598;

export interface Political {
  provinces: Province[];
  regions: Region[];
  realms: Realm[];
  cultures: Culture[];
}

export function buildPolitical(p: GenParams, grid: Grid, hex: HexLayers, nbr: Int32Array, rivers: River[], rngRoot: Rng): Political {
  const rng = rngRoot.fork('political');
  const n = grid.cols * grid.rows;
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / grid.cols);
    cx[i] = hexCenterX(i % grid.cols, row);
    cy[i] = hexCenterY(row);
  }

  // ---------- Provinces ----------
  const owner = growProvinces(p, grid, hex, nbr, cx, cy, rng.fork('prov'));
  const provCount = owner.count;
  const hexOf: number[][] = Array.from({ length: provCount }, () => []);
  for (let i = 0; i < n; i++) if (owner.of[i] >= 0) hexOf[owner.of[i]].push(i);

  // Stable ids: order provinces by position (top-left first).
  const order = hexOf
    .map((hs, k) => ({ k, hs, key: hs.length ? Math.min(...hs) : Infinity }))
    .filter((o) => o.hs.length > 0)
    .sort((a, b) => a.key - b.key);
  const remap = new Int32Array(provCount).fill(-1);
  order.forEach((o, id) => (remap[o.k] = id));
  for (let i = 0; i < n; i++) hex.province[i] = owner.of[i] >= 0 ? remap[owner.of[i]] : -1;

  const provinces: Province[] = order.map((o, id) => {
    const f = provinceFacts(hex, o.hs, cx, cy, -1);
    hex.flags[f.capitalHex] |= HexFlag.Capital;
    return { id, name: '', hexes: o.hs, region: -1, neighbors: [], seaNeighbors: [], ...f };
  });
  computeAdjacency(provinces, hex, nbr);

  // ---------- Regions ----------
  const regionOf = clusterGraph(
    provinces.map((pr) => pr.center),
    provinces.map((pr) => pr.neighbors),
    provinces.map((pr) => pr.seaNeighbors),
    Math.max(1, Math.round(provinces.length / p.regionSize)),
    p.regionSize * 1.9,
    provinces.map((pr) => (pr.terrain === Terrain.Mountains || pr.terrain === Terrain.Peaks ? 1.6 : 1)),
    null,
    rng.fork('regions'),
  );
  const regionCount = Math.max(...regionOf) + 1;
  const regions: Region[] = Array.from({ length: regionCount }, (_, id) => ({ id, name: '', provinces: [], realm: -1, capitalProvince: -1 }));
  provinces.forEach((pr, k) => {
    pr.region = regionOf[k];
    regions[regionOf[k]].provinces.push(k);
  });
  const regionCenters = regions.map((r) => centroidOf(r.provinces.map((k) => provinces[k].center)));
  const regionNb = regions.map(() => new Set<number>());
  const regionSea = regions.map(() => new Set<number>());
  provinces.forEach((pr) => {
    for (const q of pr.neighbors) if (regionOf[q] !== pr.region) regionNb[pr.region].add(regionOf[q]);
    for (const q of pr.seaNeighbors) if (regionOf[q] !== pr.region) regionSea[pr.region].add(regionOf[q]);
  });
  regions.forEach((r) => {
    const c = regionCenters[r.id];
    r.capitalProvince = r.provinces.reduce((best, k) => (dist2(provinces[k].center, c) < dist2(provinces[best].center, c) ? k : best), r.provinces[0]);
  });

  // ---------- Realms ----------
  const realmRng = rng.fork('realms');
  const strength = Array.from({ length: Math.max(p.realmCount, 1) }, () => realmRng.range(0.55, 1.7));
  const realmOf = clusterGraph(
    regionCenters,
    regionNb.map((s) => [...s]),
    regionSea.map((s) => [...s]),
    Math.min(p.realmCount, regions.length),
    Infinity,
    regions.map(() => 1),
    strength,
    realmRng,
  );
  const realmCount = Math.max(...realmOf) + 1;

  // ---------- Cultures ----------
  const cultureRng = rng.fork('cultures');
  const cultureCount = Math.max(2, Math.min(7, Math.round(realmCount / 4)));
  const realmCenters: [number, number][] = [];
  for (let r = 0; r < realmCount; r++) {
    const pts: [number, number][] = [];
    regions.forEach((rg, k) => {
      if (realmOf[k] === r) for (const pk of rg.provinces) pts.push(provinces[pk].center);
    });
    realmCenters.push(centroidOf(pts));
  }
  const cultureSeeds = farthestPoints(realmCenters, cultureCount, cultureRng);
  const realmCulture = realmCenters.map((c) => {
    let best = 0;
    for (let k = 1; k < cultureSeeds.length; k++) if (dist2(c, realmCenters[cultureSeeds[k]]) < dist2(c, realmCenters[cultureSeeds[best]])) best = k;
    return best;
  });
  const paletteOrder = cultureRng.shuffle(Array.from({ length: PALETTE_COUNT }, (_, k) => k));
  const nameCultures: NameCulture[] = cultureSeeds.map((_, k) => makeCulture(cultureRng, paletteOrder[k % PALETTE_COUNT]));
  const forge = new NameForge(rng.fork('names'));
  const cultures: Culture[] = nameCultures.map((c, id) => ({ id, name: forge.word(c, 2, 2, 0), palette: paletteOrder[id % PALETTE_COUNT] }));

  const realms: Realm[] = Array.from({ length: realmCount }, (_, id) => ({
    id,
    name: '',
    title: '',
    culture: realmCulture[id],
    color: [0, 0, 0],
    regions: [],
    capitalProvince: -1,
  }));
  regions.forEach((rg, k) => {
    rg.realm = realmOf[k];
    realms[realmOf[k]].regions.push(k);
  });
  const realmSize = realms.map((r) => r.regions.reduce((s, k) => s + regions[k].provinces.length, 0));
  const sortedSizes = realmSize.slice().sort((a, b) => b - a);
  realms.forEach((r) => {
    const c = realmCenters[r.id];
    let best = -1;
    let bd = Infinity;
    for (const rk of r.regions)
      for (const pk of regions[rk].provinces) {
        const d = dist2(provinces[pk].center, c) - provinces[pk].neighbors.length * 0.5;
        if (d < bd) {
          bd = d;
          best = pk;
        }
      }
    r.capitalProvince = best;
    const size = realmSize[r.id];
    r.title = size >= sortedSizes[0] && realmCount > 6 && size > 40 ? 'Empire' : size >= 14 ? 'Kingdom' : size >= 7 ? 'Grand Duchy' : size >= 3 ? 'Duchy' : 'County';
  });

  // ---------- Names ----------
  for (const r of realms) r.name = forge.word(nameCultures[r.culture], 2, 3, 0.4);
  for (const rg of regions) rg.name = forge.word(nameCultures[realms[rg.realm].culture], 1, 2, 0.6);
  for (const pr of provinces) pr.name = forge.word(nameCultures[realms[regions[pr.region].realm].culture], 1, 2);
  for (const rv of rivers) {
    const src = rv.hexes[0];
    const pr = hex.province[src] >= 0 ? hex.province[src] : 0;
    const cul = provinces.length ? realms[regions[provinces[pr].region].realm].culture : 0;
    rv.name = forge.word(nameCultures[cul], 1, 2, 0);
  }

  assignColors(realms, regions, provinces, rng.fork('colors'));
  return { provinces, regions, realms, cultures };
}

// ---------------------------------------------------------------------------

/** Centre, dominant terrain, coast flag and settlement hex of a province.
 *  The settlement stays where it was (`keepCapital`) while that hex is still inside. */
export function provinceFacts(hex: HexLayers, hs: number[], cx: Float32Array, cy: Float32Array, keepCapital: number) {
  let sx = 0;
  let sy = 0;
  for (const h of hs) {
    sx += cx[h];
    sy += cy[h];
  }
  const center: [number, number] = [sx / hs.length, sy / hs.length];
  const counts = new Map<number, number>();
  let coastal = false;
  let best = hs[0];
  let bestScore = Infinity;
  let keep = false;
  for (const h of hs) {
    counts.set(hex.terrain[h], (counts.get(hex.terrain[h]) ?? 0) + 1);
    if (hex.flags[h] & HexFlag.Coastal) coastal = true;
    if (h === keepCapital) keep = true;
    let score = Math.hypot(cx[h] - center[0], cy[h] - center[1]);
    if (hex.flags[h] & HexFlag.River) score -= 1.6;
    if (hex.flags[h] & HexFlag.Coastal) score -= 0.9;
    if (hex.relief[h] >= Relief.Mountains) score += 4;
    if (hex.relief[h] === Relief.Hills) score += 0.6;
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  let terrain = Terrain.Plains;
  let tc = -1;
  counts.forEach((c, t) => {
    if (c > tc) {
      tc = c;
      terrain = t as Terrain;
    }
  });
  return { center, coastal, terrain, capitalHex: keep ? keepCapital : best };
}

/** Land neighbours, and neighbours across at most four hexes of water. */
export function computeAdjacency(provinces: Province[], hex: HexLayers, nbr: Int32Array): void {
  const n = hex.province.length;
  const isLand = (i: number) => (hex.flags[i] & HexFlag.Land) !== 0;
  const nb = provinces.map(() => new Set<number>());
  for (let i = 0; i < n; i++) {
    const a = hex.province[i];
    if (a < 0) continue;
    for (let d = 0; d < 6; d++) {
      const j = nbr[i * 6 + d];
      if (j < 0) continue;
      const b = hex.province[j];
      if (b >= 0 && b !== a) nb[a].add(b);
    }
  }
  provinces.forEach((pr, k) => (pr.neighbors = [...nb[k]].sort((a, b) => a - b)));

  const seaNb = provinces.map(() => new Set<number>());
  const label = new Int32Array(n).fill(-1);
  const dist = new Int32Array(n).fill(99);
  const link = (a: number, b: number) => {
    if (a === b || nb[a].has(b)) return;
    seaNb[a].add(b);
    seaNb[b].add(a);
  };
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isLand(i) || hex.province[i] < 0) continue;
    for (let d = 0; d < 6; d++) {
      const j = nbr[i * 6 + d];
      if (j >= 0 && !isLand(j)) {
        if (label[j] === -1) {
          label[j] = hex.province[i];
          dist[j] = 1;
          frontier.push(j);
        } else if (label[j] !== hex.province[i]) {
          link(label[j], hex.province[i]);
        }
      }
    }
  }
  for (let step = 1; step < 4 && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j < 0 || isLand(j)) continue;
        if (label[j] === -1) {
          label[j] = label[i];
          dist[j] = step + 1;
          next.push(j);
        } else if (label[j] !== label[i] && dist[j] + dist[i] <= 5) {
          link(label[j], label[i]);
        }
      }
    }
    frontier = next;
  }
  provinces.forEach((pr, k) => (pr.seaNeighbors = [...seaNb[k]].sort((a, b) => a - b)));
}

function growProvinces(p: GenParams, grid: Grid, hex: HexLayers, nbr: Int32Array, cx: Float32Array, cy: Float32Array, rng: Rng): { of: Int32Array; count: number } {
  const n = grid.cols * grid.rows;
  const isLand = (i: number) => (hex.flags[i] & HexFlag.Land) !== 0;
  const land: number[] = [];
  for (let i = 0; i < n; i++) if (isLand(i)) land.push(i);

  // Land components, so every island gets at least one province.
  const comp = new Int32Array(n).fill(-1);
  let compCount = 0;
  for (const s of land) {
    if (comp[s] >= 0) continue;
    const st = [s];
    comp[s] = compCount;
    while (st.length) {
      const i = st.pop()!;
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j >= 0 && comp[j] < 0 && isLand(j)) {
          comp[j] = compCount;
          st.push(j);
        }
      }
    }
    compCount++;
  }

  const target = Math.max(1, Math.round(land.length / p.provinceSize));
  const spacing = 2 * Math.sqrt((p.provinceSize * HEX_AREA) / Math.PI) * 0.82;
  const cell = spacing;
  const buckets = new Map<number, number[]>();
  const key = (x: number, y: number) => Math.floor(x / cell) * 100003 + Math.floor(y / cell);
  let seeds: number[] = [];
  const shuffled = rng.shuffle(land.slice());
  for (const i of shuffled) {
    if (seeds.length >= target * 1.15) break;
    const gx = Math.floor(cx[i] / cell);
    const gy = Math.floor(cy[i] / cell);
    let ok = true;
    for (let a = -1; a <= 1 && ok; a++)
      for (let b = -1; b <= 1 && ok; b++) {
        const list = buckets.get((gx + a) * 100003 + gy + b);
        if (list) for (const s of list) if ((cx[s] - cx[i]) ** 2 + (cy[s] - cy[i]) ** 2 < spacing * spacing) ok = false;
      }
    if (!ok) continue;
    seeds.push(i);
    const k = key(cx[i], cy[i]);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(i);
  }
  const compHasSeed = new Uint8Array(compCount);
  for (const s of seeds) compHasSeed[comp[s]] = 1;
  for (const i of land) {
    if (!compHasSeed[comp[i]]) {
      compHasSeed[comp[i]] = 1;
      seeds.push(i);
    }
  }

  const jitter = new Float32Array(n);
  for (let i = 0; i < n; i++) jitter[i] = rng.next() * 0.7;
  const stepCost = (i: number, j: number) => {
    let c = 1 + jitter[j] + Math.abs(hex.elevation[j] - hex.elevation[i]) * 9;
    if (hex.relief[j] >= Relief.Mountains) c += 1.6;
    if (hex.relief[j] === Relief.Peaks) c += 3;
    if ((hex.flags[j] & HexFlag.River) !== (hex.flags[i] & HexFlag.River)) c += 0.9;
    return c;
  };

  let of = new Int32Array(n).fill(-1);
  const grow = () => {
    of = new Int32Array(n).fill(-1);
    const cost = new Float64Array(n).fill(Infinity);
    const heap = new MinHeap(n);
    seeds.forEach((s, k) => {
      of[s] = k;
      cost[s] = 0;
      heap.push(s, 0);
    });
    while (heap.size) {
      const c0 = heap.peekKey();
      const i = heap.pop();
      if (c0 > cost[i]) continue;
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j < 0 || !isLand(j)) continue;
        const c = cost[i] + stepCost(i, j);
        if (c < cost[j]) {
          cost[j] = c;
          of[j] = of[i];
          heap.push(j, c);
        }
      }
    }
  };

  // Grow, then relax seeds toward province centres twice (Lloyd-style).
  for (let it = 0; it < 3; it++) {
    grow();
    if (it === 2) break;
    const sx = new Float64Array(seeds.length);
    const sy = new Float64Array(seeds.length);
    const cnt = new Int32Array(seeds.length);
    for (const i of land) {
      const k = of[i];
      if (k < 0) continue;
      sx[k] += cx[i];
      sy[k] += cy[i];
      cnt[k]++;
    }
    const best = new Float64Array(seeds.length).fill(Infinity);
    const next = seeds.slice();
    for (const i of land) {
      const k = of[i];
      if (k < 0 || !cnt[k]) continue;
      const d = (cx[i] - sx[k] / cnt[k]) ** 2 + (cy[i] - sy[k] / cnt[k]) ** 2;
      if (d < best[k]) {
        best[k] = d;
        next[k] = i;
      }
    }
    seeds = next;
  }

  // Merge slivers into the neighbour they share the longest border with.
  const count = seeds.length;
  const size = new Int32Array(count);
  for (const i of land) if (of[i] >= 0) size[of[i]]++;
  const minSize = Math.max(2, Math.round(p.provinceSize * 0.3));
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < count; k++) {
      if (size[k] === 0 || size[k] >= minSize) continue;
      const shared = new Map<number, number>();
      for (const i of land) {
        if (of[i] !== k) continue;
        for (let d = 0; d < 6; d++) {
          const j = nbr[i * 6 + d];
          if (j >= 0 && of[j] >= 0 && of[j] !== k) shared.set(of[j], (shared.get(of[j]) ?? 0) + 1);
        }
      }
      let target = -1;
      let bestShared = 0;
      shared.forEach((v, t) => {
        if (v > bestShared) {
          bestShared = v;
          target = t;
        }
      });
      if (target < 0) continue;
      for (const i of land) if (of[i] === k) of[i] = target;
      size[target] += size[k];
      size[k] = 0;
    }
  }
  return { of, count };
}

/**
 * Groups graph nodes into clusters by multi-source growth. Used for provinces
 * → regions and regions → realms. Returns a cluster id per node.
 */
function clusterGraph(
  centers: [number, number][],
  landNb: number[][],
  seaNb: number[][],
  targetCount: number,
  maxSize: number,
  nodeCost: number[],
  strength: number[] | null,
  rng: Rng,
): number[] {
  const m = centers.length;
  if (m === 0) return [];
  let seeds = farthestPoints(centers, Math.min(targetCount, m), rng);
  let of: number[] = [];
  const grow = () => {
    // Costs are tracked per (cluster, node) so that when a cluster is full
    // the next-cheapest cluster can still claim the node.
    const K = seeds.length;
    of = new Array(m).fill(-1);
    const cost = new Float64Array(K * m).fill(Infinity);
    const size = new Int32Array(K);
    const heap = new MinHeap(m * 8);
    seeds.forEach((s, k) => {
      cost[k * m + s] = 0;
      heap.push(k * m + s, 0);
    });
    const assigned = new Uint8Array(m);
    while (heap.size) {
      const c0 = heap.peekKey();
      const item = heap.pop();
      const k = Math.floor(item / m);
      const i = item - k * m;
      if (assigned[i] || c0 > cost[item]) continue;
      if (size[k] >= maxSize) continue;
      assigned[i] = 1;
      of[i] = k;
      size[k]++;
      const st = strength ? strength[k % strength.length] : 1;
      const relax = (j: number, mult: number) => {
        if (assigned[j]) return;
        const d = Math.sqrt(dist2(centers[i], centers[j]));
        const c = c0 + (d * mult * nodeCost[j] * rng.range(0.92, 1.08)) / st;
        if (c < cost[k * m + j]) {
          cost[k * m + j] = c;
          heap.push(k * m + j, c);
        }
      };
      for (const j of landNb[i]) relax(j, 1);
      for (const j of seaNb[i]) relax(j, 1.7);
    }
  };
  grow();
  if (strength === null) {
    // one relaxation pass toward cluster centres
    const sums = seeds.map(() => [0, 0, 0]);
    of.forEach((k, i) => {
      if (k < 0) return;
      sums[k][0] += centers[i][0];
      sums[k][1] += centers[i][1];
      sums[k][2]++;
    });
    seeds = seeds.map((s, k) => {
      if (!sums[k][2]) return s;
      const c: [number, number] = [sums[k][0] / sums[k][2], sums[k][1] / sums[k][2]];
      let best = s;
      of.forEach((kk, i) => {
        if (kk === k && dist2(centers[i], c) < dist2(centers[best], c)) best = i;
      });
      return best;
    });
    grow();
  }

  // Nodes no cluster reached (separate land masses, full clusters).
  let next = seeds.length;
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < m; i++) {
      if (of[i] >= 0) continue;
      const nbs = [...landNb[i], ...seaNb[i]].filter((j) => of[j] >= 0);
      if (nbs.length) {
        of[i] = of[nbs[0]];
        changed = true;
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < m; i++) {
    if (of[i] >= 0) continue;
    // flood this disconnected group into a new cluster, or attach it to the nearest one
    const group: number[] = [];
    const st = [i];
    of[i] = -2;
    while (st.length) {
      const a = st.pop()!;
      group.push(a);
      for (const j of [...landNb[a], ...seaNb[a]])
        if (of[j] === -1) {
          of[j] = -2;
          st.push(j);
        }
    }
    let id: number;
    if (group.length >= 3 || strength === null) id = next++;
    else {
      let best = -1;
      let bd = Infinity;
      for (let j = 0; j < m; j++)
        if (of[j] >= 0) {
          const d = dist2(centers[j], centers[i]);
          if (d < bd) {
            bd = d;
            best = j;
          }
        }
      id = best >= 0 ? of[best] : next++;
    }
    for (const a of group) of[a] = id;
  }
  // compact ids
  const remap = new Map<number, number>();
  return of.map((k) => {
    if (!remap.has(k)) remap.set(k, remap.size);
    return remap.get(k)!;
  });
}

function farthestPoints(pts: [number, number][], k: number, rng: Rng): number[] {
  if (!pts.length) return [];
  const chosen = [rng.int(0, pts.length - 1)];
  const minD = pts.map((p) => dist2(p, pts[chosen[0]]));
  while (chosen.length < k) {
    // farthest point with a little randomness so layouts vary
    let best = -1;
    let bd = -1;
    for (let i = 0; i < pts.length; i++) {
      const d = minD[i] * rng.range(0.75, 1);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0 || minD[best] === 0) break;
    chosen.push(best);
    for (let i = 0; i < pts.length; i++) minD[i] = Math.min(minD[i], dist2(pts[i], pts[best]));
  }
  return chosen;
}

function dist2(a: [number, number], b: [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function centroidOf(pts: [number, number][]): [number, number] {
  if (!pts.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/** Heraldic palette: muted, distinct, readable over parchment and terrain. */
export const PALETTE: [number, number, number][] = [
  [150, 42, 38], [40, 74, 140], [196, 156, 44], [52, 112, 58], [104, 60, 138], [196, 104, 44],
  [36, 122, 124], [124, 92, 56], [176, 70, 108], [86, 102, 36], [88, 128, 182], [118, 44, 88],
  [210, 178, 96], [60, 108, 90], [160, 64, 44], [84, 72, 140], [160, 152, 60], [44, 90, 60],
  [182, 128, 92], [70, 98, 140], [140, 80, 108], [112, 140, 62], [200, 76, 76], [62, 140, 168],
  [134, 110, 150], [168, 120, 40], [90, 60, 46], [120, 150, 140],
];

function assignColors(realms: Realm[], regions: Region[], provinces: Province[], rng: Rng): void {
  const adj = realms.map(() => new Set<number>());
  for (const pr of provinces) {
    const a = regions[pr.region].realm;
    for (const q of [...pr.neighbors, ...pr.seaNeighbors]) {
      const b = regions[provinces[q].region].realm;
      if (a !== b) adj[a].add(b);
    }
  }
  const pal = rng.shuffle(PALETTE.slice());
  const uses = new Int32Array(pal.length);
  const cap = Math.ceil(realms.length / pal.length) + 1;
  const assigned: number[] = new Array(realms.length).fill(-1);
  // biggest first: they are the most visible
  const order = realms.map((r) => r.id).sort((a, b) => realms[b].regions.length - realms[a].regions.length);
  for (const r of order) {
    let best = 0;
    let bestScore = -Infinity;
    for (let c = 0; c < pal.length; c++) {
      if (uses[c] >= cap) continue;
      let minD = 1e9;
      for (const o of adj[r]) if (assigned[o] >= 0) minD = Math.min(minD, colorDist(pal[c], pal[assigned[o]]));
      const score = Math.min(minD, 200) - uses[c] * 40 + rng.next() * 5;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    assigned[r] = best;
    uses[best]++;
    // slight per-realm variation so repeated palette colours are not identical
    const v = rng.range(-10, 10);
    realms[r].color = pal[best].map((x) => Math.max(0, Math.min(255, Math.round(x + v)))) as [number, number, number];
  }
}

function colorDist(a: number[], b: number[]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}
