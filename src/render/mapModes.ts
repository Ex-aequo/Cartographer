import { Biome, BIOME_NAMES, Terrain, TERRAIN_NAMES } from '../model/types';
import { DEPTH_METRES, ELEVATION_METRES } from '../gen/biomes';

export type BuiltinMode = 'political' | 'physical' | 'elevation' | 'temperature' | 'rainfall' | 'biome' | 'terrain';
/** built-in modes, or `layer:<id>` for a custom data layer */
export type MapMode = BuiltinMode | `layer:${string}`;

export const isLayerMode = (m: MapMode): m is `layer:${string}` => m.startsWith('layer:');
export const layerIdOf = (m: MapMode) => (isLayerMode(m) ? m.slice(6) : null);

export interface ModeDef {
  key: MapMode;
  label: string;
  /** art modes render the painted map; data modes show the hex values */
  kind: 'art' | 'data';
  /** shader data mode: 0 none, 1 continuous ramp, 2 categorical, 3 custom layer colours */
  shader: 0 | 1 | 2 | 3;
  /** which hex value a data mode reads: 0 elevation, 1 temperature, 2 moisture, 3 biome, 4 terrain */
  source?: number;
}

export const MODES: ModeDef[] = [
  { key: 'political', label: 'Political', kind: 'art', shader: 0 },
  { key: 'physical', label: 'Physical', kind: 'art', shader: 0 },
  { key: 'elevation', label: 'Elevation', kind: 'data', shader: 1, source: 0 },
  { key: 'temperature', label: 'Temperature', kind: 'data', shader: 1, source: 1 },
  { key: 'rainfall', label: 'Rainfall', kind: 'data', shader: 1, source: 2 },
  { key: 'biome', label: 'Biome', kind: 'data', shader: 2, source: 3 },
  { key: 'terrain', label: 'Terrain type', kind: 'data', shader: 2, source: 4 },
];

export const modeDef = (m: MapMode): ModeDef => (isLayerMode(m) ? { key: m, label: 'Layer', kind: 'data', shader: 3 } : (MODES.find((d) => d.key === m) ?? MODES[0]));

type RGB = [number, number, number];

export interface Ramp {
  /** stop positions in the data's own units, ascending */
  stops: number[];
  colors: RGB[];
  /** legend tick labels at chosen stops */
  ticks: { at: number; label: string }[];
  unit: string;
}

// Hypsometric tints: sea blues, then the classic atlas green-to-white land.
export const ELEVATION_RAMP: Ramp = {
  stops: [-1, -0.25, -0.0001, 0, 0.06, 0.2, 0.4, 0.62, 0.85],
  colors: [
    [22, 46, 84],
    [52, 96, 140],
    [128, 176, 196],
    [92, 132, 82],
    [140, 168, 96],
    [214, 200, 128],
    [176, 128, 82],
    [136, 104, 92],
    [240, 240, 244],
  ],
  ticks: [
    { at: -1, label: `−${(DEPTH_METRES / 1000).toFixed(0)} km` },
    { at: 0, label: 'Sea level' },
    { at: 0.4, label: `${Math.round((0.4 * ELEVATION_METRES) / 100) * 100} m` },
    { at: 0.85, label: `${Math.round((0.85 * ELEVATION_METRES) / 100) * 100} m` },
  ],
  unit: 'm',
};

export const TEMPERATURE_RAMP: Ramp = {
  stops: [-30, -15, -3, 6, 14, 22, 30],
  colors: [
    [72, 60, 140],
    [70, 120, 190],
    [168, 206, 228],
    [236, 232, 196],
    [240, 196, 110],
    [218, 112, 60],
    [156, 34, 38],
  ],
  ticks: [
    { at: -30, label: '−30 °C' },
    { at: 0, label: '0 °C' },
    { at: 15, label: '15 °C' },
    { at: 30, label: '30 °C' },
  ],
  unit: '°C',
};

export const RAINFALL_RAMP: Ramp = {
  stops: [0, 0.15, 0.35, 0.55, 0.75, 1],
  colors: [
    [196, 160, 106],
    [222, 206, 140],
    [168, 196, 110],
    [86, 150, 100],
    [56, 120, 150],
    [40, 70, 140],
  ],
  ticks: [
    { at: 0, label: 'Arid' },
    { at: 0.5, label: 'Moderate' },
    { at: 1, label: 'Very wet' },
  ],
  unit: '',
};

export const BIOME_COLORS: Record<Biome, RGB> = {
  [Biome.Ocean]: [44, 82, 120],
  [Biome.Lake]: [72, 128, 160],
  [Biome.Ice]: [236, 240, 246],
  [Biome.Tundra]: [160, 162, 140],
  [Biome.Taiga]: [70, 104, 86],
  [Biome.TemperateForest]: [62, 122, 62],
  [Biome.Grassland]: [148, 184, 92],
  [Biome.Steppe]: [204, 194, 120],
  [Biome.Desert]: [232, 204, 140],
  [Biome.Savanna]: [200, 168, 82],
  [Biome.TropicalForest]: [24, 100, 52],
  [Biome.Wetland]: [92, 134, 120],
  [Biome.Mediterranean]: [168, 160, 88],
};

export const TERRAIN_COLORS: Record<Terrain, RGB> = {
  [Terrain.DeepOcean]: [36, 66, 104],
  [Terrain.Sea]: [70, 116, 156],
  [Terrain.Lake]: [80, 140, 170],
  [Terrain.Plains]: [184, 196, 112],
  [Terrain.Farmland]: [222, 196, 84],
  [Terrain.Forest]: [56, 120, 60],
  [Terrain.Jungle]: [22, 92, 50],
  [Terrain.Hills]: [168, 136, 88],
  [Terrain.Mountains]: [122, 104, 96],
  [Terrain.Peaks]: [226, 226, 232],
  [Terrain.Desert]: [236, 210, 150],
  [Terrain.Steppe]: [206, 180, 116],
  [Terrain.Tundra]: [150, 160, 150],
  [Terrain.Glacier]: [200, 220, 236],
  [Terrain.Marsh]: [96, 128, 106],
  [Terrain.Taiga]: [74, 102, 90],
};

export function rampFor(m: MapMode): Ramp | null {
  if (m === 'elevation') return ELEVATION_RAMP;
  if (m === 'temperature') return TEMPERATURE_RAMP;
  if (m === 'rainfall') return RAINFALL_RAMP;
  return null;
}

export function categoriesFor(m: MapMode): { code: number; name: string; color: RGB }[] | null {
  if (m === 'biome')
    return (Object.keys(BIOME_COLORS) as unknown as Biome[]).map((k) => ({ code: Number(k), name: BIOME_NAMES[k], color: BIOME_COLORS[k] }));
  if (m === 'terrain')
    return (Object.keys(TERRAIN_COLORS) as unknown as Terrain[]).map((k) => ({ code: Number(k), name: TERRAIN_NAMES[k], color: TERRAIN_COLORS[k] }));
  return null;
}

export function sampleRamp(r: Ramp, v: number): RGB {
  const s = r.stops;
  if (v <= s[0]) return r.colors[0];
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i]) {
      const t = (v - s[i - 1]) / (s[i] - s[i - 1] || 1);
      const a = r.colors[i - 1];
      const b = r.colors[i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return r.colors[r.colors.length - 1];
}
