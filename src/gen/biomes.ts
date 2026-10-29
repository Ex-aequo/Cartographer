import { Biome, Relief, Terrain } from '../model/types';

/** Elevation 1.0 is this many °C colder than sea level. Mirrored in the shader. */
export const LAPSE = 32;
/** Elevation 1.0 in metres, for display. */
export const ELEVATION_METRES = 5200;
export const DEPTH_METRES = 6000;

export function landBiome(tempC: number, moist: number, elevation: number): Biome {
  if (tempC < -12) return Biome.Ice;
  if (tempC < -1) return Biome.Tundra;
  if (tempC < 6) return moist > 0.32 ? Biome.Taiga : Biome.Tundra;
  if (moist > 0.82 && elevation < 0.12) return Biome.Wetland;
  if (tempC < 19) {
    if (moist < 0.14) return Biome.Desert;
    if (moist < 0.3) return Biome.Steppe;
    if (moist < 0.52) return Biome.Grassland;
    return Biome.TemperateForest;
  }
  if (moist < 0.16) return Biome.Desert;
  if (moist < 0.32) return tempC > 23 ? Biome.Savanna : Biome.Steppe;
  if (moist < 0.5) return tempC > 23 ? Biome.Savanna : Biome.Mediterranean;
  if (moist < 0.66) return tempC > 24 ? Biome.Savanna : Biome.Grassland;
  return tempC > 22 ? Biome.TropicalForest : Biome.TemperateForest;
}

export function landRelief(elevation: number, roughness: number): Relief {
  if (elevation > 0.74) return Relief.Peaks;
  if (elevation > 0.46 || (elevation > 0.34 && roughness > 0.11)) return Relief.Mountains;
  if (elevation > 0.24 || roughness > 0.075) return Relief.Hills;
  return Relief.Flat;
}

export function terrainFor(biome: Biome, relief: Relief, fertileRiver: boolean): Terrain {
  if (biome === Biome.Ocean) return relief === Relief.DeepWater ? Terrain.DeepOcean : Terrain.Sea;
  if (biome === Biome.Lake) return Terrain.Lake;
  if (relief === Relief.Peaks) return Terrain.Peaks;
  if (relief === Relief.Mountains) return biome === Biome.Ice ? Terrain.Glacier : Terrain.Mountains;
  if (relief === Relief.Hills) return biome === Biome.Ice ? Terrain.Glacier : Terrain.Hills;
  switch (biome) {
    case Biome.Ice:
      return Terrain.Glacier;
    case Biome.Tundra:
      return Terrain.Tundra;
    case Biome.Taiga:
      return Terrain.Taiga;
    case Biome.TemperateForest:
      return Terrain.Forest;
    case Biome.TropicalForest:
      return Terrain.Jungle;
    case Biome.Wetland:
      return Terrain.Marsh;
    case Biome.Desert:
      return fertileRiver ? Terrain.Farmland : Terrain.Desert;
    case Biome.Steppe:
      return fertileRiver ? Terrain.Farmland : Terrain.Steppe;
    default:
      return fertileRiver ? Terrain.Farmland : Terrain.Plains;
  }
}
