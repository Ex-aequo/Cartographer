import { FORMAT_ID, FORMAT_VERSION, type GenParams, type MapData } from '../model/types';
import { worldSize } from '../model/hex';
import { Rng } from '../util/rng';
import { generateHeightfield } from './heightfield';
import { generateMoisture, generateTemperature } from './climate';
import { buildHexes } from './hydrology';
import { buildPolitical } from './political';

export type Progress = (step: string, fraction: number) => void;

export function generateMap(params: GenParams, onProgress: Progress = () => {}): MapData {
  const p = sanitize(params);
  const grid = { cols: p.cols, rows: p.rows };
  const { width, height } = worldSize(grid);
  const rng = new Rng(p.seed);

  onProgress('Raising continents', 0.05);
  const hf = generateHeightfield(p, width, height, rng);
  onProgress('Setting the winds', 0.35);
  const baseTemp = generateTemperature(p, width, height, rng);
  const moisture = generateMoisture(p, hf, baseTemp, width, height, rng);
  onProgress('Carving rivers and lakes', 0.5);
  const { hex, nbr, rivers } = buildHexes(p, grid, hf, baseTemp, moisture, rng);
  onProgress('Drawing borders', 0.7);
  const pol = buildPolitical(p, grid, hex, nbr, rivers, rng);

  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    meta: { name: pol.realms.length ? `The Known World` : 'Untitled', createdAt: new Date().toISOString(), params: p },
    grid: { cols: p.cols, rows: p.rows, layout: 'pointy-odd-r', hexSize: 1 },
    world: { width, height },
    height: hf,
    baseTemp,
    moisture,
    hex,
    provinces: pol.provinces,
    regions: pol.regions,
    realms: pol.realms,
    cultures: pol.cultures,
    rivers,
    layers: [],
  };
}

export function sanitize(p: GenParams): GenParams {
  const c = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
  return {
    ...p,
    seed: String(p.seed || 'cartographer'),
    cols: Math.round(c(p.cols, 40, 600)),
    rows: Math.round(c(p.rows, 30, 400)),
    landFraction: c(p.landFraction, 0.15, 0.7),
    mountains: c(p.mountains, 0, 1),
    rainfall: c(p.rainfall, 0.4, 1.6),
    provinceSize: Math.round(c(p.provinceSize, 6, 120)),
    regionSize: Math.round(c(p.regionSize, 2, 12)),
    realmCount: Math.round(c(p.realmCount, 1, 120)),
    tempNorth: c(p.tempNorth, -40, 40),
    tempSouth: c(p.tempSouth, -40, 40),
  };
}
