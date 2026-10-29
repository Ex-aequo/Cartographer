import { t } from '../i18n';
import { HexFlag, Terrain, type HexLayers, type MapData } from './types';
import { buildNeighbors } from './hex';

/**
 * Races: peoples with a homeland bias. A race says what its kingdoms should be
 * made of ("at least 50 % mountains and hills"), what climate and coast it
 * likes, how many kingdoms it has and how large they are. The generator seeds
 * each race's kingdoms on matching land and grows their borders toward their
 * terrain; Fit borders (and, if allowed, terrain shaping) closes any gap.
 */

export interface RaceBias {
  /** terrain codes this line counts */
  terrains: number[];
  op: 'min' | 'max';
  /** percent of the kingdom's land hexes, 0–100 */
  pct: number;
}

export type RaceSize = 'small' | 'medium' | 'large';
export type CoastPref = 'any' | 'coastal' | 'inland';

export interface RaceDef {
  id: string;
  name: string;
  /** present in this world */
  enabled: boolean;
  color: [number, number, number];
  biases: RaceBias[];
  /** preferred sea-level-adjusted temperature range, °C */
  tempMin: number;
  tempMax: number;
  coast: CoastPref;
  /** number of kingdoms, or percent of all realms */
  count: { mode: 'number' | 'share'; value: number };
  size: RaceSize;
  /** name style key (see gen/names NAME_STYLES); 'auto' keeps the world's cultures */
  names: string;
  /** symbol asset for this race's towns (empty = the standard keep) */
  townMark: string;
  /** Fit may repaint terrain inside this race's kingdoms */
  terraform: boolean;
  /** preset this race came from, for Reset */
  preset?: string;
}

const T = Terrain;
const LAND_TERRAINS = [T.Plains, T.Farmland, T.Forest, T.Jungle, T.Hills, T.Mountains, T.Peaks, T.Desert, T.Steppe, T.Tundra, T.Glacier, T.Marsh, T.Taiga];
export { LAND_TERRAINS as RACE_TERRAINS };

const base = (o: Partial<RaceDef> & Pick<RaceDef, 'id' | 'name' | 'color' | 'biases'>): RaceDef => ({
  enabled: false,
  tempMin: -30,
  tempMax: 40,
  coast: 'any',
  count: { mode: 'number', value: 2 },
  size: 'medium',
  names: 'auto',
  townMark: '',
  terraform: false,
  preset: o.id,
  ...o,
});

/** Starting points from common fantasy convention; every value can be changed. */
export const RACE_PRESETS: RaceDef[] = [
  base({ id: 'humans', name: 'Humans', color: [176, 132, 74], biases: [{ terrains: [T.Plains, T.Farmland], op: 'min', pct: 40 }], tempMin: 0, tempMax: 28, count: { mode: 'share', value: 35 }, names: 'auto' }),
  base({ id: 'dwarves', name: 'Dwarves', color: [112, 118, 128], biases: [{ terrains: [T.Mountains, T.Hills, T.Peaks], op: 'min', pct: 50 }], tempMin: -15, tempMax: 18, count: { mode: 'number', value: 3 }, size: 'small', names: 'dwarf', townMark: 'ink:tower' }),
  base({
    id: 'elves',
    name: 'Elves',
    color: [64, 128, 84],
    biases: [
      { terrains: [T.Forest, T.Taiga, T.Jungle], op: 'min', pct: 50 },
      { terrains: [T.Desert], op: 'max', pct: 5 },
    ],
    tempMin: -5,
    tempMax: 26,
    count: { mode: 'number', value: 2 },
    names: 'elf',
  }),
  base({
    id: 'auroch',
    name: 'Auroch',
    color: [150, 96, 58],
    biases: [
      { terrains: [T.Plains, T.Steppe, T.Hills], op: 'min', pct: 50 },
      { terrains: [T.Jungle, T.Marsh, T.Desert], op: 'max', pct: 10 },
    ],
    tempMin: 6,
    tempMax: 30,
    coast: 'inland',
    count: { mode: 'number', value: 2 },
    size: 'large',
    names: 'auroch',
    townMark: 'ink:camp',
  }),
  base({ id: 'orcs', name: 'Orcs', color: [104, 120, 48], biases: [{ terrains: [T.Steppe, T.Hills, T.Desert], op: 'min', pct: 40 }], tempMin: 0, tempMax: 34, count: { mode: 'number', value: 2 }, names: 'orc', townMark: 'ink:camp' }),
  base({ id: 'lizardfolk', name: 'Lizardfolk', color: [52, 118, 110], biases: [{ terrains: [T.Marsh, T.Jungle], op: 'min', pct: 40 }], tempMin: 18, tempMax: 40, coast: 'coastal', count: { mode: 'number', value: 1 }, size: 'small', names: 'lizard' }),
  base({ id: 'nomads', name: 'Nomads', color: [196, 160, 92], biases: [{ terrains: [T.Steppe, T.Desert], op: 'min', pct: 50 }], tempMin: 8, tempMax: 40, count: { mode: 'number', value: 2 }, size: 'large', names: 'steppe', townMark: 'ink:camp' }),
  base({ id: 'frostfolk', name: 'Frost folk', color: [118, 150, 176], biases: [{ terrains: [T.Tundra, T.Glacier, T.Taiga], op: 'min', pct: 50 }], tempMin: -40, tempMax: 4, count: { mode: 'number', value: 1 }, names: 'north' }),
];

export const SIZE_STRENGTH: Record<RaceSize, number> = { small: 0.6, medium: 1.05, large: 1.7 };

export function presetById(id: string): RaceDef | undefined {
  const p = RACE_PRESETS.find((r) => r.id === id);
  return p && (JSON.parse(JSON.stringify(p)) as RaceDef);
}

/** The races list for the World tab: the given one, or all presets switched off. */
export function racesOrPresets(list: RaceDef[] | undefined): RaceDef[] {
  return list && list.length ? list : RACE_PRESETS.map((r) => ({ ...(JSON.parse(JSON.stringify(r)) as RaceDef), name: t(r.name) }));
}

export function activeRaces(list: RaceDef[] | undefined): RaceDef[] {
  return (list ?? []).filter((r) => r.enabled && r.biases.every((b) => b.terrains.length > 0 || b.pct === 0));
}

/** Kingdoms per active race, scaled down together if they ask for more realms than exist. */
export function kingdomCounts(races: RaceDef[], realmCount: number): Map<string, number> {
  const want = races.map((r) => Math.max(1, r.count.mode === 'number' ? Math.round(r.count.value) : Math.round((r.count.value / 100) * realmCount)));
  const total = want.reduce((a, b) => a + b, 0);
  const scale = total > realmCount ? realmCount / total : 1;
  const out = new Map<string, number>();
  races.forEach((r, i) => out.set(r.id, Math.max(1, Math.floor(want[i] * scale))));
  // never more race kingdoms than realms
  let sum = [...out.values()].reduce((a, b) => a + b, 0);
  for (const r of [...races].reverse()) {
    while (sum > realmCount && out.get(r.id)! > 1) {
      out.set(r.id, out.get(r.id)! - 1);
      sum--;
    }
  }
  return out;
}

// ------------------------------------------------------------ fitness

/** Terrain make-up of a set of hexes, for scoring. */
export interface Makeup {
  land: number;
  counts: Float64Array;
  temp: number;
  coastal: number;
}

export function makeupOf(map: { hex: HexLayers }, hexes: Iterable<number>): Makeup {
  const counts = new Float64Array(16);
  let land = 0;
  let temp = 0;
  let coastal = 0;
  for (const h of hexes) {
    if (!(map.hex.flags[h] & HexFlag.Land)) continue;
    land++;
    counts[map.hex.terrain[h]]++;
    temp += map.hex.temperature[h];
    if (map.hex.flags[h] & HexFlag.Coastal) coastal++;
  }
  return { land, counts, temp: land ? temp / land : 0, coastal: land ? coastal / land : 0 };
}

export const shareOf = (m: Makeup, terrains: number[]) => (m.land ? terrains.reduce((a, t) => a + m.counts[t], 0) / m.land : 0);

/**
 * How well some land suits a race, about 0 (hostile) to 1.5 (ideal): its
 * terrain against the race's biases, its climate against the race's range,
 * its coast against the race's preference.
 */
export function suitability(race: RaceDef, m: Makeup): number {
  if (!m.land) return 0;
  let s = 0;
  let n = 0;
  for (const b of race.biases) {
    const share = shareOf(m, b.terrains);
    if (b.op === 'min') {
      s += Math.min(1.5, share / Math.max(0.05, b.pct / 100));
      n++;
    } else if (share > b.pct / 100) s -= Math.min(1, (share - b.pct / 100) * 4);
  }
  let v = n ? s / n : 1;
  const off = m.temp < race.tempMin ? race.tempMin - m.temp : m.temp > race.tempMax ? m.temp - race.tempMax : 0;
  v *= Math.max(0.15, 1 - off / 12);
  if (race.coast === 'coastal') v *= 0.55 + m.coastal * 1.5;
  if (race.coast === 'inland') v *= 1.15 - Math.min(0.6, m.coastal * 1.2);
  return Math.max(0, v);
}

export interface BiasResult {
  bias: RaceBias;
  share: number;
  ok: boolean;
}

export interface RealmFit {
  realm: number;
  race: RaceDef;
  land: number;
  results: BiasResult[];
  ok: boolean;
  /** how far below target, summed over unmet lines (0 = all met) */
  deficit: number;
}

export function racesOf(map: MapData): RaceDef[] {
  return map.meta.params.races ?? [];
}

export function raceOfRealm(map: MapData, realm: number): RaceDef | undefined {
  const id = map.realms[realm]?.race;
  return id ? racesOf(map).find((r) => r.id === id) : undefined;
}

function evaluate(race: RaceDef, realm: number, m: Makeup): RealmFit {
  const results = race.biases
    .filter((b) => b.terrains.length)
    .map((b) => {
      const share = shareOf(m, b.terrains);
      return { bias: b, share, ok: b.op === 'min' ? share + 1e-9 >= b.pct / 100 : share <= b.pct / 100 + 1e-9 };
    });
  const deficit = results.reduce((a, r) => a + (r.ok ? 0 : Math.abs(r.share - r.bias.pct / 100)), 0);
  return { realm, race, land: m.land, results, ok: results.every((r) => r.ok), deficit };
}

/** Every race kingdom checked against its race's targets. */
export function raceReport(map: MapData): RealmFit[] {
  const out: RealmFit[] = [];
  for (const r of map.realms) {
    if (r.retired || !r.race) continue;
    const race = raceOfRealm(map, r.id);
    if (!race) continue;
    out.push(evaluate(race, r.id, makeupOf(map, realmHexes(map, r.id))));
  }
  return out;
}

export function realmHexes(map: MapData, realm: number): number[] {
  const out: number[] = [];
  for (const rg of map.realms[realm]?.regions ?? []) for (const p of map.regions[rg]?.provinces ?? []) out.push(...(map.provinces[p]?.hexes ?? []));
  return out;
}

// ------------------------------------------------------------ fit borders

/**
 * Trades border provinces so race kingdoms meet their targets: a kingdom
 * short of its terrain takes neighbouring provinces rich in it, and hands
 * poor border provinces to its neighbours. Capitals stay put, no realm is
 * emptied, and a neighbour of another race is never pushed below its own
 * targets. Changes only which region each province belongs to; the rebuild
 * that follows tidies everything else. Returns the number of provinces moved.
 */
export function fitBorders(map: MapData, maxMoves = 400): number {
  const races = racesOf(map);
  if (!races.length) return 0;
  const provRealm = (p: number) => map.regions[map.provinces[p].region]?.realm ?? -1;
  // live realm membership (provinces), rebuilt as we go
  const members = new Map<number, Set<number>>();
  for (const p of map.provinces) {
    if (p.retired || !p.hexes.length) continue;
    const r = provRealm(p.id);
    if (!members.has(r)) members.set(r, new Set());
    members.get(r)!.add(p.id);
  }
  const makeupOfRealm = (r: number) => {
    const hs: number[] = [];
    for (const p of members.get(r) ?? []) hs.push(...map.provinces[p].hexes);
    return makeupOf(map, hs);
  };
  const capitals = new Set(map.realms.map((r) => r.capitalProvince));
  for (const rg of map.regions) capitals.add(rg.capitalProvince);
  const fitOf = (r: number, m?: Makeup) => {
    const race = raceOfRealm(map, r);
    return race ? evaluate(race, r, m ?? makeupOfRealm(r)) : null;
  };
  const pMakeup = new Map<number, Makeup>();
  const mk = (p: number) => {
    let m = pMakeup.get(p);
    if (!m) pMakeup.set(p, (m = makeupOf(map, map.provinces[p].hexes)));
    return m;
  };
  const merged = (a: Makeup, b: Makeup, sign: 1 | -1): Makeup => {
    const counts = new Float64Array(16);
    for (let i = 0; i < 16; i++) counts[i] = a.counts[i] + sign * b.counts[i];
    const land = a.land + sign * b.land;
    return { land, counts, temp: land ? (a.temp * a.land + sign * b.temp * b.land) / land : 0, coastal: land ? (a.coastal * a.land + sign * b.coastal * b.land) / land : 0 };
  };
  /** a region of realm `r` that touches province `p` */
  const regionFor = (r: number, p: number) => {
    for (const q of map.provinces[p].neighbors) if (provRealm(q) === r) return map.provinces[q].region;
    return -1;
  };
  let moves = 0;
  const tried = new Set<string>();
  while (moves < maxMoves) {
    const fits = [...members.keys()].map((r) => fitOf(r)).filter((f): f is RealmFit => !!f && !f.ok).sort((a, b) => b.deficit - a.deficit);
    let moved = false;
    for (const f of fits) {
      const r = f.realm;
      const cur = makeupOfRealm(r);
      let best: { p: number; to: number; region: number; gain: number } | null = null;
      // take: neighbouring provinces into r
      for (const p of members.get(r) ?? [])
        for (const q of map.provinces[p].neighbors) {
          const owner = provRealm(q);
          if (owner === r || owner < 0 || capitals.has(q) || (members.get(owner)?.size ?? 0) <= 1) continue;
          const key = `${q}>${r}`;
          if (tried.has(key)) continue;
          const after = evaluate(f.race, r, merged(cur, mk(q), 1));
          const gain = f.deficit - after.deficit;
          if (gain <= 1e-6) continue;
          const other = fitOf(owner, merged(makeupOfRealm(owner), mk(q), -1));
          const otherBefore = fitOf(owner);
          if (other && otherBefore && other.deficit > otherBefore.deficit + 1e-6 && !(otherBefore.ok === false && other.deficit <= otherBefore.deficit)) continue;
          if (!best || gain > best.gain) best = { p: q, to: r, region: map.provinces[p].region, gain };
        }
      // give: r's poor border provinces to a neighbour
      for (const p of members.get(r) ?? []) {
        if (capitals.has(p) || (members.get(r)?.size ?? 0) <= 2) continue;
        for (const q of map.provinces[p].neighbors) {
          const owner = provRealm(q);
          if (owner === r || owner < 0) continue;
          const key = `${p}>${owner}`;
          if (tried.has(key)) continue;
          const after = evaluate(f.race, r, merged(cur, mk(p), -1));
          const gain = f.deficit - after.deficit;
          if (gain <= 1e-6) continue;
          const other = fitOf(owner, merged(makeupOfRealm(owner), mk(p), 1));
          const otherBefore = fitOf(owner);
          if (other && otherBefore && other.deficit > otherBefore.deficit + 1e-6) continue;
          if (!best || gain > best.gain) best = { p, to: owner, region: map.provinces[q].region, gain };
          break;
        }
      }
      if (!best) continue;
      const from = provRealm(best.p);
      const region = best.region >= 0 ? best.region : regionFor(best.to, best.p);
      if (region < 0) {
        tried.add(`${best.p}>${best.to}`);
        continue;
      }
      map.provinces[best.p].region = region;
      members.get(from)?.delete(best.p);
      if (!members.has(best.to)) members.set(best.to, new Set());
      members.get(best.to)!.add(best.p);
      // keep each province contiguous with its new region: a lone province is fine,
      // the rebuild splits nothing at province level
      tried.add(`${best.p}>${from}`);
      moves++;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  // regions list their provinces again
  for (const rg of map.regions) rg.provinces = [];
  for (const p of map.provinces) if (!p.retired && p.hexes.length && map.regions[p.region]) map.regions[p.region].provinces.push(p.id);
  return moves;
}

// ------------------------------------------------------------ terrain shaping

/** Which hexes best take on a terrain (higher = sooner). */
function aptness(map: MapData, h: number, t: number): number {
  const e = map.hex.elevation[h];
  const wet = map.hex.moisture[h];
  const temp = map.hex.temperature[h];
  switch (t) {
    case T.Mountains:
    case T.Hills:
    case T.Peaks:
      return e;
    case T.Forest:
    case T.Taiga:
    case T.Jungle:
      return wet;
    case T.Desert:
    case T.Steppe:
      return 1 - wet;
    case T.Marsh:
      return wet - e;
    case T.Tundra:
    case T.Glacier:
      return -temp;
    default:
      return 1 - Math.abs(wet - 0.5) - e;
  }
}

/**
 * For races allowed to change the land: repaints hexes inside their
 * kingdoms (the most suitable first) until each "at least" target is met.
 * Uses painted terrain, so it shows on the map and in the game data as hand
 * edits and can be undone. Returns the number of hexes repainted.
 */
export function shapeTerrain(map: MapData, edits: { terrain: Int8Array; touched: Uint8Array }): number {
  const terrainEdits = edits.terrain;
  let changed = 0;
  for (const f of raceReport(map)) {
    if (!f.race.terraform) continue;
    const hexes = realmHexes(map, f.realm).filter((h) => map.hex.flags[h] & HexFlag.Land);
    for (const r of f.results) {
      if (r.ok || r.bias.op !== 'min') continue;
      const target = Math.ceil((r.bias.pct / 100) * hexes.length + 0.5);
      const t = r.bias.terrains[0];
      let have = hexes.filter((h) => r.bias.terrains.includes(map.hex.terrain[h])).length;
      const candidates = hexes.filter((h) => !r.bias.terrains.includes(map.hex.terrain[h]) && !(map.hex.flags[h] & HexFlag.Capital)).sort((a, b) => aptness(map, b, t) - aptness(map, a, t));
      for (const h of candidates) {
        if (have >= target) break;
        terrainEdits[h] = t;
        edits.touched[h] |= 2; // Touched.Terrain
        map.hex.terrain[h] = t;
        have++;
        changed++;
      }
    }
  }
  return changed;
}

/** Colour per hex (RGBA8) for the Races map mode. */
export function raceColors(map: MapData): Uint8Array {
  const n = map.grid.cols * map.grid.rows;
  const out = new Uint8Array(n * 4);
  const races = racesOf(map);
  const colorOf = new Map(races.map((r) => [r.id, r.color]));
  const realmColor = map.realms.map((r) => (r.race ? colorOf.get(r.race) : undefined));
  for (let h = 0; h < n; h++) {
    const p = map.hex.province[h];
    if (p < 0) continue;
    const realm = map.regions[map.provinces[p]?.region]?.realm;
    const c = realm !== undefined ? realmColor[realm] : undefined;
    if (!c) {
      out[h * 4] = 205;
      out[h * 4 + 1] = 196;
      out[h * 4 + 2] = 176;
      out[h * 4 + 3] = 90;
      continue;
    }
    out[h * 4] = c[0];
    out[h * 4 + 1] = c[1];
    out[h * 4 + 2] = c[2];
    out[h * 4 + 3] = 230;
  }
  return out;
}

export function newRace(existing: RaceDef[], name: string): RaceDef {
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'race';
  const baseId = id;
  for (let k = 2; existing.some((r) => r.id === id); k++) id = `${baseId}-${k}`;
  return base({ id, name, color: [140, 120, 150], biases: [{ terrains: [T.Plains], op: 'min', pct: 30 }], enabled: true, preset: undefined });
}

/** Neighbour table cache for callers that need hex adjacency. */
export const neighborsOf = (map: MapData) => buildNeighbors(map.grid);

// ------------------------------------------------------------ templates

export const RACE_TEMPLATE_FORMAT = 'cartographer-races';

export function raceTemplate(races: RaceDef[]): string {
  return JSON.stringify({ format: RACE_TEMPLATE_FORMAT, version: 1, races }, null, 2);
}

export function readRaceTemplate(text: string): RaceDef[] {
  const o = JSON.parse(text);
  if (o?.format !== RACE_TEMPLATE_FORMAT || !Array.isArray(o.races)) throw new Error('not-a-race-template');
  return o.races as RaceDef[];
}
