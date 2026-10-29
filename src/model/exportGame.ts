import { BIOME_NAMES, HexFlag, RELIEF_NAMES, TERRAIN_NAMES, type MapData } from './types';
import { hexCenterX, hexCenterY, toAxial } from './hex';
import { DEPTH_METRES, ELEVATION_METRES } from '../gen/biomes';
import type { DataLayer } from './layers';
import { pinnedForExport } from './symbols';
import { seaZones } from '../export/maps';

/** A layer value as plain JSON: category id (or null), number, true/false, or a list of tag ids. */
export function exportValue(l: DataLayer, i: number): number | boolean | number[] | null {
  const v = l.values[i];
  switch (l.def.type) {
    case 'category':
      return v < 0 ? null : v;
    case 'flag':
      return v !== 0;
    case 'tags':
      return l.def.categories.filter((c) => (v >>> 0) & (1 << c.id)).map((c) => c.id);
    default:
      return v;
  }
}
const dataOf = (ls: DataLayer[], i: number) => Object.fromEntries(ls.map((l) => [l.def.id, exportValue(l, i)]));


export const GAME_EXPORT_SCHEMA = 'cartographer-game-data';
export const GAME_EXPORT_VERSION = 1;

/**
 * Readable game data: one object per hex, province, region and realm, with
 * stable ids and plain field names. Documented in docs/DATA_FORMAT.md.
 */
export function buildGameExport(map: MapData) {
  const { cols, rows } = map.grid;
  const hexes = [];
  const pinned = pinnedForExport(map);
  const sea = seaZones(map);
  const raceOfProvince = (p: number) => (p >= 0 ? (map.realms[map.regions[map.provinces[p]?.region]?.realm]?.race ?? null) : null);
  const symbolsByHex = new Map<number, string[]>();
  for (const p of pinned) symbolsByHex.set(p.hex, [...(symbolsByHex.get(p.hex) ?? []), p.symbol]);
  const hexLayers = (map.layers ?? []).filter((l) => l.def.scope === 'hex');
  const provLayers = (map.layers ?? []).filter((l) => l.def.scope === 'province');
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const [q, r] = toAxial(col, row);
      const f = map.hex.flags[i];
      const e = map.hex.elevation[i];
      hexes.push({
        id: i,
        col,
        row,
        q,
        r,
        x: round(hexCenterX(col, row), 3),
        y: round(hexCenterY(row), 3),
        land: !!(f & HexFlag.Land),
        elevation: round(e, 4),
        elevationMetres: Math.round(e >= 0 ? e * ELEVATION_METRES : e * DEPTH_METRES),
        temperatureC: round(map.hex.temperature[i], 1),
        moisture: round(map.hex.moisture[i], 3),
        biome: BIOME_NAMES[map.hex.biome[i] as 0],
        biomeCode: map.hex.biome[i],
        relief: RELIEF_NAMES[map.hex.relief[i] as 0],
        reliefCode: map.hex.relief[i],
        terrain: TERRAIN_NAMES[map.hex.terrain[i] as 0],
        terrainCode: map.hex.terrain[i],
        coastal: !!(f & HexFlag.Coastal),
        lake: !!(f & HexFlag.Lake),
        river: !!(f & HexFlag.River),
        riverFlow: f & HexFlag.River ? round(map.hex.flux[i], 1) : 0,
        flowsTo: map.hex.flowTo[i],
        province: map.hex.province[i],
        seaZone: sea.zoneOf[i] >= 0 ? sea.zones[sea.zoneOf[i]].id : -1,
        race: raceOfProvince(map.hex.province[i]),
        edited: map.edits ? map.edits.touched[i] !== 0 : false,
        paintedTerrain: !!map.edits && map.edits.terrain[i] >= 0,
        data: dataOf(hexLayers, i),
        symbols: symbolsByHex.get(i) ?? [],
      });
    }
  }
  return {
    schema: GAME_EXPORT_SCHEMA,
    version: GAME_EXPORT_VERSION,
    name: map.meta.name,
    seed: map.meta.params.seed,
    // 4X maps: the rules the map was made to (null on classic maps)
    game: map.meta.params.game?.on
      ? { players: map.realms.filter((r) => r.player).length, provincesPerKingdom: map.meta.params.game.provinces, hexesPerProvince: map.meta.params.game.hexes, freeLand: map.meta.params.game.free, balanced: map.meta.params.game.balanced }
      : null,
    grid: { cols, rows, layout: map.grid.layout, hexRadius: 1, worldWidth: round(map.world.width, 3), worldHeight: round(map.world.height, 3) },
    terrainTypes: Object.entries(TERRAIN_NAMES).map(([code, name]) => ({ code: Number(code), name })),
    biomeTypes: Object.entries(BIOME_NAMES).map(([code, name]) => ({ code: Number(code), name })),
    retired: {
      provinces: map.provinces.filter((p) => p.retired).map((p) => p.id),
      regions: map.regions.filter((r) => r.retired).map((r) => r.id),
      realms: map.realms.filter((r) => r.retired).map((r) => r.id),
    },
    realms: map.realms.map((r) => ({
      id: r.id,
      retired: !!r.retired,
      name: r.name,
      title: r.title,
      culture: r.culture,
      race: r.race ?? null,
      color: hex(r.color),
      capitalProvince: r.capitalProvince,
      regions: r.regions,
      // 4X maps: the player slot (null for classic realms and free land), and whether nobody rules it
      player: r.player ?? null,
      unclaimed: !!r.unclaimed,
    })),
    regions: map.regions.map((g) => ({ id: g.id, retired: !!g.retired, name: g.name, realm: g.realm, capitalProvince: g.capitalProvince, provinces: g.provinces })),
    provinces: map.provinces.map((p) => ({
      id: p.id,
      retired: !!p.retired,
      name: p.name,
      region: p.region,
      realm: map.regions[p.region].realm,
      race: raceOfProvince(p.id),
      player: map.realms[map.regions[p.region].realm]?.player ?? null,
      free: !!map.realms[map.regions[p.region].realm]?.unclaimed,
      capitalHex: p.capitalHex,
      center: [round(p.center[0], 3), round(p.center[1], 3)],
      terrain: TERRAIN_NAMES[p.terrain],
      terrainCode: p.terrain,
      coastal: p.coastal,
      hexCount: p.hexes.length,
      hexes: p.hexes,
      neighbors: p.neighbors,
      seaNeighbors: p.seaNeighbors,
      data: dataOf(provLayers, p.id),
    })),
    cultures: map.cultures,
    rivers: map.rivers.map((r) => ({ id: r.id, name: r.name, hexes: r.hexes })),
    hexes,
    races: (map.meta.params.races ?? [])
      .filter((r) => r.enabled)
      .map((r) => ({ id: r.id, name: r.name, color: hex(r.color), biases: r.biases.map((b) => ({ terrains: b.terrains.map((c) => TERRAIN_NAMES[c as 0]), terrainCodes: b.terrains, op: b.op, percent: b.pct })), climateC: [r.tempMin, r.tempMax], coast: r.coast, size: r.size })),
    seaZones: sea.zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind, hexCount: z.hexes.length, coastalProvinces: z.coast })),
    symbols: pinned,
    layers: (map.layers ?? []).map(({ def }) => ({
      id: def.id,
      name: def.name,
      type: def.type,
      scope: def.scope,
      categories: def.type === 'category' || def.type === 'tags' ? def.categories.map((c) => ({ id: c.id, name: c.name, color: hex(c.color) })) : undefined,
      min: def.type === 'number' ? def.min : undefined,
      max: def.type === 'number' ? def.max : undefined,
      decimals: def.type === 'number' ? def.decimals : undefined,
      rollUp: def.rollUp,
    })),
  };
}

function round(v: number, d: number): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}

function hex(c: [number, number, number]): string {
  return '#' + c.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}
