import type { EditLayers, HexLayers, MapData, Province, Realm, Region, River } from '../model/types';
import { HexFlag } from '../model/types';
import { hexCenterX, hexCenterY } from '../model/hex';
import { Rng } from '../util/rng';
import { generateMoisture } from './climate';
import { buildHexes } from './hydrology';
import { computeAdjacency, provinceFacts } from './political';
import { makeCulture, NameForge } from './names';
import { refreshLayers } from '../model/layers';

/** Edit layers for a map, created empty the first time someone edits it. */
export function ensureEdits(map: MapData): EditLayers {
  if (!map.edits) {
    const n = map.grid.cols * map.grid.rows;
    map.edits = { terrain: new Int8Array(n).fill(-1), riverBlock: new Uint8Array(n), riverPaths: [], touched: new Uint8Array(n) };
  }
  return map.edits;
}

/**
 * Rebuilds everything that follows from the heightfield and the hand edits:
 * rainfall (so rain shadows move with new mountains), water, rivers, biomes,
 * terrain, and the political map. Province, region and realm ids are kept:
 * land that appears joins the province next to it, land that floods leaves
 * its province, and a province with no land left is retired, never reused.
 *
 * Deterministic: the same heightfield, edits and political state always give
 * the same map, which is what makes undo exact.
 */
export function rederive(map: MapData): MapData {
  const p = map.meta.params;
  const grid = { cols: map.grid.cols, rows: map.grid.rows };
  const rng = new Rng(p.seed);
  const moisture = generateMoisture(p, map.height, map.baseTemp, map.world.width, map.world.height, rng);
  const { hex, nbr, rivers } = buildHexes(p, grid, map.height, map.baseTemp, moisture, rng, { autoLakes: false, edits: map.edits });
  const pol = repairPolitical(map, hex, nbr, rivers);
  const out: MapData = { ...map, moisture, hex, rivers, ...pol };
  refreshLayers(out);
  return out;
}

function repairPolitical(old: MapData, hex: HexLayers, nbr: Int32Array, rivers: River[]) {
  const n = hex.province.length;
  const { cols } = old.grid;
  const seed = old.meta.params.seed;
  const isLand = (i: number) => (hex.flags[i] & HexFlag.Land) !== 0;
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    cx[i] = hexCenterX(i % cols, row);
    cy[i] = hexCenterY(row);
  }

  // 1. Keep every hex that is still land in its province.
  const prov = hex.province;
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = old.hex.province[i];
    if (isLand(i) && o >= 0 && o < old.provinces.length) {
      prov[i] = o;
      queue.push(i);
    }
  }
  // 2. New land joins the nearest neighbouring province (breadth first).
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (let d = 0; d < 6; d++) {
      const j = nbr[i * 6 + d];
      if (j >= 0 && prov[j] < 0 && isLand(j)) {
        prov[j] = prov[i];
        queue.push(j);
      }
    }
  }

  const provinces: Province[] = old.provinces.map((pr) => ({ ...pr }));
  const regions: Region[] = old.regions.map((r) => ({ ...r, provinces: [] }));
  const realms: Realm[] = old.realms.map((r) => ({ ...r, regions: [] }));

  const newProvince = (hexes: number[]): number => {
    const id = provinces.length;
    // nearest living province decides the region (and so the realm and naming style)
    let sx = 0;
    let sy = 0;
    for (const h of hexes) {
      sx += cx[h];
      sy += cy[h];
    }
    sx /= hexes.length;
    sy /= hexes.length;
    let region = 0;
    let bd = Infinity;
    for (const pr of provinces) {
      if (pr.retired || pr.region < 0) continue;
      const d = (pr.center[0] - sx) ** 2 + (pr.center[1] - sy) ** 2;
      if (d < bd) {
        bd = d;
        region = pr.region;
      }
    }
    provinces.push({
      id,
      name: nameFor(old, seed, id, regions[region] ? realms[regions[region].realm]?.culture ?? 0 : 0),
      hexes: [],
      capitalHex: -1,
      region,
      neighbors: [],
      seaNeighbors: [],
      coastal: false,
      center: [sx, sy],
      terrain: hex.terrain[hexes[0]],
    });
    for (const h of hexes) prov[h] = id;
    return id;
  };

  // 3. Land with no province anywhere near it (a new island) becomes a province.
  forEachComponent(n, nbr, (i) => isLand(i) && prov[i] < 0, (comp) => newProvince(comp));

  // 4. A province split in pieces keeps the piece with its settlement (else
  //    its largest); the other pieces join the neighbour they border most.
  for (let pass = 0; pass < 2; pass++) {
    const members: number[][] = provinces.map(() => []);
    for (let i = 0; i < n; i++) if (prov[i] >= 0) members[prov[i]].push(i);
    let changed = false;
    members.forEach((hs, id) => {
      if (hs.length < 2) return;
      const set = new Set(hs);
      const comps: number[][] = [];
      const seen = new Set<number>();
      for (const s of hs) {
        if (seen.has(s)) continue;
        const comp = [s];
        seen.add(s);
        for (let q = 0; q < comp.length; q++)
          for (let d = 0; d < 6; d++) {
            const j = nbr[comp[q] * 6 + d];
            if (j >= 0 && set.has(j) && !seen.has(j)) {
              seen.add(j);
              comp.push(j);
            }
          }
        comps.push(comp);
      }
      if (comps.length < 2) return;
      const cap = provinces[id].capitalHex;
      let keep = comps.findIndex((c) => c.includes(cap));
      if (keep < 0) keep = comps.reduce((b, c, k) => (c.length > comps[b].length ? k : b), 0);
      comps.forEach((comp, k) => {
        if (k === keep) return;
        changed = true;
        const shared = new Map<number, number>();
        for (const h of comp)
          for (let d = 0; d < 6; d++) {
            const j = nbr[h * 6 + d];
            if (j >= 0 && prov[j] >= 0 && prov[j] !== id) shared.set(prov[j], (shared.get(prov[j]) ?? 0) + 1);
          }
        let target = -1;
        let most = 0;
        shared.forEach((v, t) => {
          if (v > most || (v === most && t < target)) {
            most = v;
            target = t;
          }
        });
        if (target >= 0) for (const h of comp) prov[h] = target;
        else newProvince(comp);
      });
    });
    if (!changed) break;
  }

  // 5. Facts, settlements and adjacency for every province.
  const members: number[][] = provinces.map(() => []);
  for (let i = 0; i < n; i++) if (prov[i] >= 0) members[prov[i]].push(i);
  provinces.forEach((pr, id) => {
    const hs = members[id];
    pr.hexes = hs;
    if (!hs.length) {
      Object.assign(pr, { retired: true, capitalHex: -1, neighbors: [], seaNeighbors: [], coastal: false });
      return;
    }
    delete pr.retired;
    Object.assign(pr, provinceFacts(hex, hs, cx, cy, pr.capitalHex));
    hex.flags[pr.capitalHex] |= HexFlag.Capital;
  });
  computeAdjacency(provinces, hex, nbr);

  // 6. Regions and realms follow their members.
  for (const pr of provinces) if (!pr.retired && regions[pr.region]) regions[pr.region].provinces.push(pr.id);
  for (const rg of regions) {
    if (!rg.provinces.length) {
      rg.retired = true;
      rg.capitalProvince = -1;
      continue;
    }
    delete rg.retired;
    if (!rg.provinces.includes(rg.capitalProvince)) rg.capitalProvince = rg.provinces[0];
    if (realms[rg.realm]) realms[rg.realm].regions.push(rg.id);
  }
  for (const r of realms) {
    if (!r.regions.length) {
      r.retired = true;
      r.capitalProvince = -1;
      continue;
    }
    delete r.retired;
    const own = new Set(r.regions.flatMap((k) => regions[k].provinces));
    if (!own.has(r.capitalProvince)) r.capitalProvince = regions[r.regions[0]].capitalProvince;
  }

  // 7. Rivers keep the names of the rivers they overlap most.
  const oldRiverOf = new Map<number, number>();
  for (const rv of old.rivers) for (const h of rv.hexes.slice(0, -1)) if (!oldRiverOf.has(h)) oldRiverOf.set(h, rv.id);
  const claimed = new Set<number>();
  for (const rv of rivers) {
    const votes = new Map<number, number>();
    for (const h of rv.hexes) {
      const o = oldRiverOf.get(h);
      if (o !== undefined) votes.set(o, (votes.get(o) ?? 0) + 1);
    }
    let best = -1;
    let most = 0;
    votes.forEach((v, o) => {
      if (v > most && !claimed.has(o)) {
        most = v;
        best = o;
      }
    });
    if (best >= 0) {
      claimed.add(best);
      rv.name = old.rivers[best].name;
    } else {
      const src = prov[rv.hexes[0]];
      const realm = src >= 0 ? realms[regions[provinces[src].region]?.realm] : undefined;
      rv.name = nameFor(old, seed, 100000 + rv.hexes[0], realm?.culture ?? 0);
    }
  }

  return { provinces, regions, realms };
}

/** A name in a culture's style for something made by an edit. Deterministic per id. */
export function nameFor(map: MapData, seed: string, id: number, culture: number): string {
  const palette = map.cultures[culture]?.palette ?? culture;
  const style = makeCulture(new Rng(`${seed}:culture:${culture}`), palette);
  return new NameForge(new Rng(`${seed}:edit-name:${id}`)).word(style, 1, 2);
}

function forEachComponent(n: number, nbr: Int32Array, inside: (i: number) => boolean, visit: (comp: number[]) => void): void {
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s] || !inside(s)) continue;
    const comp = [s];
    seen[s] = 1;
    for (let q = 0; q < comp.length; q++)
      for (let d = 0; d < 6; d++) {
        const j = nbr[comp[q] * 6 + d];
        if (j >= 0 && !seen[j] && inside(j)) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    visit(comp);
  }
}
