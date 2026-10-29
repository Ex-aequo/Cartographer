/**
 * Cartographer map data model.
 *
 * The hex grid is the source of truth for game data. The continuous
 * heightfield exists for the art; every hex's values are sampled from it at
 * the hex centre, so art and data agree wherever a game looks.
 *
 * Hex indices are row-major: index = row * cols + col.
 * Layout is pointy-top, "odd-r" offset (odd rows shifted right by half a hex).
 * Axial coordinates: q = col - (row - (row & 1)) / 2, r = row.
 * World units: hex circumradius = 1. Hex (0,0) centre is at (√3/2, 1).
 */

export const FORMAT_ID = 'cartographer-map';
/** 2: heightfield stored as 16-bit integers; erosion setting added. Version 1 files still open. */
export const FORMAT_VERSION = 2;

export type Template = 'continents' | 'pangaea' | 'archipelago' | 'inland-sea';

export interface GenParams {
  seed: string;
  cols: number;
  rows: number;
  template: Template;
  /** Share of the surface that is land, 0.15–0.7. */
  landFraction: number;
  /** 0 = gentle lowlands, 1 = jagged highlands. */
  mountains: number;
  /** Multiplier on rainfall, 0.4–1.6. */
  rainfall: number;
  /** Strength of water erosion carving valleys, 0–1. */
  erosion: number;
  /** Average land hexes per province. */
  provinceSize: number;
  /** Average provinces per region (duchy-level grouping). */
  regionSize: number;
  /** Number of realms (kingdom-level grouping). */
  realmCount: number;
  /** Temperature at the north edge and south edge of the map, °C at sea level. */
  tempNorth: number;
  tempSouth: number;
}

export const DEFAULT_PARAMS: GenParams = {
  seed: 'amber-reach-417',
  cols: 300,
  rows: 190,
  template: 'continents',
  landFraction: 0.42,
  mountains: 0.55,
  rainfall: 1,
  erosion: 0.6,
  provinceSize: 30,
  regionSize: 5,
  realmCount: 26,
  tempNorth: -14,
  tempSouth: 31,
};

/** Climate class of a hex. Stable numeric codes: never renumber. */
export enum Biome {
  Ocean = 0,
  Lake = 1,
  Ice = 2,
  Tundra = 3,
  Taiga = 4,
  TemperateForest = 5,
  Grassland = 6,
  Steppe = 7,
  Desert = 8,
  Savanna = 9,
  TropicalForest = 10,
  Wetland = 11,
  Mediterranean = 12,
}

export const BIOME_NAMES: Record<Biome, string> = {
  [Biome.Ocean]: 'Ocean',
  [Biome.Lake]: 'Lake',
  [Biome.Ice]: 'Ice',
  [Biome.Tundra]: 'Tundra',
  [Biome.Taiga]: 'Taiga',
  [Biome.TemperateForest]: 'Temperate forest',
  [Biome.Grassland]: 'Grassland',
  [Biome.Steppe]: 'Steppe',
  [Biome.Desert]: 'Desert',
  [Biome.Savanna]: 'Savanna',
  [Biome.TropicalForest]: 'Tropical forest',
  [Biome.Wetland]: 'Wetland',
  [Biome.Mediterranean]: 'Mediterranean scrub',
};

/** Shape of the land. */
export enum Relief {
  DeepWater = 0,
  ShallowWater = 1,
  Flat = 2,
  Hills = 3,
  Mountains = 4,
  Peaks = 5,
}

export const RELIEF_NAMES: Record<Relief, string> = {
  [Relief.DeepWater]: 'Deep water',
  [Relief.ShallowWater]: 'Shallow water',
  [Relief.Flat]: 'Flat',
  [Relief.Hills]: 'Hills',
  [Relief.Mountains]: 'Mountains',
  [Relief.Peaks]: 'Impassable peaks',
};

/** Gameplay terrain, combining relief and biome. Stable numeric codes. */
export enum Terrain {
  DeepOcean = 0,
  Sea = 1,
  Lake = 2,
  Plains = 3,
  Farmland = 4,
  Forest = 5,
  Jungle = 6,
  Hills = 7,
  Mountains = 8,
  Peaks = 9,
  Desert = 10,
  Steppe = 11,
  Tundra = 12,
  Glacier = 13,
  Marsh = 14,
  Taiga = 15,
}

export const TERRAIN_NAMES: Record<Terrain, string> = {
  [Terrain.DeepOcean]: 'Deep ocean',
  [Terrain.Sea]: 'Coastal sea',
  [Terrain.Lake]: 'Lake',
  [Terrain.Plains]: 'Plains',
  [Terrain.Farmland]: 'Farmland',
  [Terrain.Forest]: 'Forest',
  [Terrain.Jungle]: 'Jungle',
  [Terrain.Hills]: 'Hills',
  [Terrain.Mountains]: 'Mountains',
  [Terrain.Peaks]: 'Peaks',
  [Terrain.Desert]: 'Desert',
  [Terrain.Steppe]: 'Steppe',
  [Terrain.Tundra]: 'Tundra',
  [Terrain.Glacier]: 'Glacier',
  [Terrain.Marsh]: 'Marsh',
  [Terrain.Taiga]: 'Taiga',
};

/** Bit flags stored per hex. */
export const HexFlag = {
  Land: 1,
  Coastal: 2,
  Lake: 4,
  River: 8,
  Capital: 16,
} as const;

export interface HexLayers {
  /** Height: < 0 water depth (−1 deepest), 0..1 land (1 highest). */
  elevation: Float32Array;
  /** Mean temperature, °C. */
  temperature: Float32Array;
  /** Rainfall, 0 (arid) .. 1 (very wet). */
  moisture: Float32Array;
  biome: Uint8Array;
  relief: Uint8Array;
  terrain: Uint8Array;
  flags: Uint8Array;
  /** Accumulated water flow; rivers where this exceeds the river threshold. */
  flux: Float32Array;
  /** Downstream hex index, −1 for water or sinks. */
  flowTo: Int32Array;
  /** Province id, −1 for water. */
  province: Int32Array;
}

export interface Province {
  id: number;
  name: string;
  hexes: number[];
  capitalHex: number;
  region: number;
  /** Provinces sharing a land border. */
  neighbors: number[];
  /** Provinces reachable across a narrow stretch of water (≤ 4 hexes). */
  seaNeighbors: number[];
  coastal: boolean;
  /** Centroid in world units. */
  center: [number, number];
  /** Dominant terrain code. */
  terrain: Terrain;
}

export interface Region {
  id: number;
  name: string;
  provinces: number[];
  realm: number;
  capitalProvince: number;
}

export interface Realm {
  id: number;
  name: string;
  /** Rank title, e.g. "Kingdom". */
  title: string;
  culture: number;
  color: [number, number, number];
  regions: number[];
  capitalProvince: number;
}

export interface Culture {
  id: number;
  name: string;
}

export interface River {
  id: number;
  name: string;
  /** Hex path from source to the water hex it drains into. */
  hexes: number[];
}

/** Continuous field aligned to the world: texel (i, j) covers world
 *  [i / res, (i+1) / res) × [j / res, (j+1) / res). */
export interface Field {
  w: number;
  h: number;
  /** Texels per world unit. */
  res: number;
  data: Float32Array;
}

export interface LabelCurve {
  /** Quadratic Bézier control points in world units. */
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  /** Font size in world units. */
  size: number;
}

export interface MapData {
  format: typeof FORMAT_ID;
  version: number;
  meta: { name: string; createdAt: string; params: GenParams };
  grid: { cols: number; rows: number; layout: 'pointy-odd-r'; hexSize: 1 };
  /** World size in world units. */
  world: { width: number; height: number };
  height: Field;
  /** Sea-level temperature, °C, coarse. */
  baseTemp: Field;
  /** Rainfall 0..1, coarse. */
  moisture: Field;
  hex: HexLayers;
  provinces: Province[];
  regions: Region[];
  realms: Realm[];
  cultures: Culture[];
  rivers: River[];
  /** Custom game data layers (Phase 3). Kept in the format from day one. */
  layers: unknown[];
}
