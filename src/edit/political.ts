import { t } from '../i18n';
import type { MapData, Province } from '../model/types';
import { HexFlag } from '../model/types';
import { buildNeighbors, hexCenterX, hexCenterY } from '../model/hex';
import { nameFor } from '../gen/rederive';
import { PALETTE } from '../gen/political';

/**
 * Political edits on the main thread. They only change ownership (which hex
 * belongs to which province, which province to which region, which region to
 * which realm) and names; the rebuild that follows works out everything else
 * (settlements, borders, adjacency, labels) and keeps provinces contiguous.
 */

const nbrCache = new WeakMap<object, Int32Array>();
function nbrOf(map: MapData): Int32Array {
  let n = nbrCache.get(map.grid);
  if (!n) {
    n = buildNeighbors(map.grid);
    nbrCache.set(map.grid, n);
  }
  return n;
}

export const isLand = (map: MapData, h: number) => (map.hex.flags[h] & HexFlag.Land) !== 0;

function centerOf(map: MapData, hs: number[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const h of hs) {
    const row = Math.floor(h / map.grid.cols);
    x += hexCenterX(h % map.grid.cols, row);
    y += hexCenterY(row);
  }
  return [x / hs.length, y / hs.length];
}

function cultureOfRegion(map: MapData, region: number): number {
  return map.realms[map.regions[region]?.realm]?.culture ?? 0;
}

/** Adds a province (filled in by the next rebuild) and returns its id. */
export function addProvince(map: MapData, hexes: number[], region: number): number {
  const id = map.provinces.length;
  const p: Province = {
    id,
    name: nameFor(map, map.meta.params.seed, id, cultureOfRegion(map, region)),
    hexes: hexes.slice(),
    capitalHex: -1,
    region,
    neighbors: [],
    seaNeighbors: [],
    coastal: false,
    center: centerOf(map, hexes),
    terrain: map.hex.terrain[hexes[0]],
  };
  map.provinces.push(p);
  for (const h of hexes) map.hex.province[h] = id;
  return id;
}

/**
 * Grows `target` into the land hexes listed, one ring at a time, so a brush
 * stroke extends the province outward instead of dropping disconnected bits.
 * Returns the hexes taken.
 */
export function growInto(map: MapData, target: number, hexes: number[]): number[] {
  const nbr = nbrOf(map);
  const pending = new Set(hexes.filter((h) => isLand(map, h) && map.hex.province[h] !== target));
  const taken: number[] = [];
  let changed = true;
  while (changed && pending.size) {
    changed = false;
    for (const h of [...pending]) {
      for (let d = 0; d < 6; d++) {
        const j = nbr[h * 6 + d];
        if (j >= 0 && map.hex.province[j] === target) {
          map.hex.province[h] = target;
          pending.delete(h);
          taken.push(h);
          changed = true;
          break;
        }
      }
    }
  }
  return taken;
}

/**
 * Splits the province the line crosses. The line's hexes are the cut; the
 * part with the settlement keeps the province, every other part becomes a
 * new province in the same region.
 */
export function splitProvince(map: MapData, path: number[]): { ok: true; created: number[] } | { ok: false; message: string } {
  const counts = new Map<number, number>();
  for (const h of path) {
    const p = map.hex.province[h];
    if (p >= 0) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let target = -1;
  let most = 0;
  counts.forEach((c, p) => {
    if (c > most) {
      most = c;
      target = p;
    }
  });
  if (target < 0) return { ok: false, message: t('Draw the line across a province.') };
  const prov = map.provinces[target];
  const cut = new Set(path.filter((h) => map.hex.province[h] === target));
  const rest = prov.hexes.filter((h) => !cut.has(h) && map.hex.province[h] === target);
  const nbr = nbrOf(map);
  const restSet = new Set(rest);
  const comps: number[][] = [];
  const seen = new Set<number>();
  for (const s of rest) {
    if (seen.has(s)) continue;
    const comp = [s];
    seen.add(s);
    for (let q = 0; q < comp.length; q++)
      for (let d = 0; d < 6; d++) {
        const j = nbr[comp[q] * 6 + d];
        if (j >= 0 && restSet.has(j) && !seen.has(j)) {
          seen.add(j);
          comp.push(j);
        }
      }
    comps.push(comp);
  }
  // ignore crumbs the line happened to isolate
  const parts = comps.filter((c) => c.length >= 2);
  if (parts.length < 2) return { ok: false, message: t('Draw the line all the way across {name}, from border to border.', { name: prov.name }) };
  let keep = parts.findIndex((c) => c.includes(prov.capitalHex));
  if (keep < 0) keep = parts.reduce((b, c, k) => (c.length > parts[b].length ? k : b), 0);
  const created: number[] = [];
  parts.forEach((c, k) => {
    if (k !== keep) created.push(addProvince(map, c, prov.region));
  });
  // the cut itself goes to whichever side it borders most (crumbs too)
  const leftovers = [...cut, ...comps.filter((c) => c.length < 2).flat()];
  for (const h of leftovers) {
    const votes = new Map<number, number>();
    for (let d = 0; d < 6; d++) {
      const j = nbr[h * 6 + d];
      if (j < 0) continue;
      const p = map.hex.province[j];
      if (p === target || created.includes(p)) votes.set(p, (votes.get(p) ?? 0) + 1);
    }
    let best = target;
    let bv = 0;
    votes.forEach((v, p) => {
      if (v > bv) {
        bv = v;
        best = p;
      }
    });
    map.hex.province[h] = best;
  }
  return { ok: true, created };
}

/** Merges province `b` into neighbouring province `a`. */
export function mergeProvinces(map: MapData, a: number, b: number): { ok: true } | { ok: false; message: string } {
  if (a === b || a < 0 || b < 0) return { ok: false, message: t('Drag from one province into a neighbouring one.') };
  const pa = map.provinces[a];
  const pb = map.provinces[b];
  if (!pa.neighbors.includes(b)) return { ok: false, message: t('{a} and {b} do not share a border, so they cannot be merged.', { a: pa.name, b: pb.name }) };
  for (const h of pb.hexes) if (map.hex.province[h] === b) map.hex.province[h] = a;
  return { ok: true };
}

/** Makes a province the first of a new region in the same realm. */
export function newRegionFrom(map: MapData, province: number): number {
  const p = map.provinces[province];
  const realm = map.regions[p.region].realm;
  const id = map.regions.length;
  map.regions.push({ id, name: nameFor(map, map.meta.params.seed, 200000 + id, map.realms[realm].culture), provinces: [province], realm, capitalProvince: province });
  p.region = id;
  return id;
}

/** Makes a region independent: a new realm with a colour unlike its neighbours'. */
export function newRealmFrom(map: MapData, region: number): number {
  const rg = map.regions[region];
  const old = map.realms[rg.realm];
  const id = map.realms.length;
  // colours of every realm that touches this region
  const near = new Set<number>([rg.realm]);
  for (const pk of rg.provinces)
    for (const q of [...map.provinces[pk].neighbors, ...map.provinces[pk].seaNeighbors]) near.add(map.regions[map.provinces[q].region].realm);
  let best = PALETTE[0];
  let bestScore = -1;
  for (const c of PALETTE) {
    let minD = Infinity;
    for (const r of near) {
      const o = map.realms[r].color;
      minD = Math.min(minD, Math.sqrt(2 * (c[0] - o[0]) ** 2 + 4 * (c[1] - o[1]) ** 2 + 3 * (c[2] - o[2]) ** 2));
    }
    if (minD > bestScore) {
      bestScore = minD;
      best = c;
    }
  }
  map.realms.push({
    id,
    name: nameFor(map, map.meta.params.seed, 300000 + id, old.culture),
    title: rg.provinces.length >= 3 ? 'Duchy' : 'County',
    culture: old.culture,
    color: [...best] as [number, number, number],
    regions: [region],
    capitalProvince: rg.capitalProvince,
    ...(old.race ? { race: old.race } : {}),
  });
  rg.realm = id;
  return id;
}

export const REALM_TITLES = ['Empire', 'Kingdom', 'Grand Duchy', 'Duchy', 'County', 'Principality', 'Republic', 'Khanate', 'Sultanate', 'Theocracy'];
