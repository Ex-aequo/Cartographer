import { BIOME_NAMES, HexFlag, RELIEF_NAMES, TERRAIN_NAMES, type MapData } from './types';
import { hexCenterX, hexCenterY, toAxial } from './hex';
import { DEPTH_METRES, ELEVATION_METRES } from '../gen/biomes';

export const GAME_EXPORT_SCHEMA = 'cartographer-game-data';
export const GAME_EXPORT_VERSION = 1;

/**
 * Readable game data: one object per hex, province, region and realm, with
 * stable ids and plain field names. Documented in docs/DATA_FORMAT.md.
 */
export function buildGameExport(map: MapData) {
  const { cols, rows } = map.grid;
  const hexes = [];
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
      });
    }
  }
  return {
    schema: GAME_EXPORT_SCHEMA,
    version: GAME_EXPORT_VERSION,
    name: map.meta.name,
    seed: map.meta.params.seed,
    grid: { cols, rows, layout: map.grid.layout, hexRadius: 1, worldWidth: round(map.world.width, 3), worldHeight: round(map.world.height, 3) },
    terrainTypes: Object.entries(TERRAIN_NAMES).map(([code, name]) => ({ code: Number(code), name })),
    biomeTypes: Object.entries(BIOME_NAMES).map(([code, name]) => ({ code: Number(code), name })),
    realms: map.realms.map((r) => ({
      id: r.id,
      name: r.name,
      title: r.title,
      culture: r.culture,
      color: '#' + r.color.map((c) => c.toString(16).padStart(2, '0')).join(''),
      capitalProvince: r.capitalProvince,
      regions: r.regions,
    })),
    regions: map.regions.map((g) => ({ id: g.id, name: g.name, realm: g.realm, capitalProvince: g.capitalProvince, provinces: g.provinces })),
    provinces: map.provinces.map((p) => ({
      id: p.id,
      name: p.name,
      region: p.region,
      realm: map.regions[p.region].realm,
      capitalHex: p.capitalHex,
      center: [round(p.center[0], 3), round(p.center[1], 3)],
      terrain: TERRAIN_NAMES[p.terrain],
      terrainCode: p.terrain,
      coastal: p.coastal,
      hexCount: p.hexes.length,
      hexes: p.hexes,
      neighbors: p.neighbors,
      seaNeighbors: p.seaNeighbors,
    })),
    cultures: map.cultures,
    rivers: map.rivers.map((r) => ({ id: r.id, name: r.name, hexes: r.hexes })),
    hexes,
    layers: map.layers,
  };
}

function round(v: number, d: number): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
