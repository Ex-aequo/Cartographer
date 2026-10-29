import { DEFAULT_PARAMS, FORMAT_ID, FORMAT_VERSION, type GenParams, type MapData } from '../model/types';
import { gameGrid, sanitizeGame } from '../model/game';
import { worldSize } from '../model/hex';
import { Rng } from '../util/rng';
import { generateHeightfield } from './heightfield';
import { erode } from './erosion';
import { generateMoisture, generateTemperature } from './climate';
import { buildHexes } from './hydrology';
import { buildPolitical } from './political';
import { buildGamePolitical } from './political4x';

export type Progress = (step: string, fraction: number) => void;

export function generateMap(params: GenParams, onProgress: Progress = () => {}): MapData {
  const p = sanitize(params);
  const grid = { cols: p.cols, rows: p.rows };
  const { width, height } = worldSize(grid);
  const rng = new Rng(p.seed);

  onProgress('Raising continents', 0.05);
  const hf = generateHeightfield(p, width, height, rng);
  onProgress('Carving valleys', 0.25);
  erode(hf, rng.fork('erosion'), p.erosion);
  onProgress('Setting the winds', 0.4);
  const baseTemp = generateTemperature(p, width, height, rng);
  const moisture = generateMoisture(p, hf, baseTemp, width, height, rng);
  onProgress('Carving rivers and lakes', 0.5);
  // first pass finds the lakes and carves them into the land …
  buildHexes(p, grid, hf, baseTemp, moisture, rng);
  // … then rain and rivers are worked out on the final land. This is exactly
  // what an edit later recomputes, so an untouched map rebuilds identically.
  const finalMoisture = generateMoisture(p, hf, baseTemp, width, height, rng);
  const { hex, nbr, rivers } = buildHexes(p, grid, hf, baseTemp, finalMoisture, rng, { autoLakes: false });
  onProgress('Drawing borders', 0.7);
  const pol = p.game?.on ? buildGamePolitical(p, grid, hex, nbr, rivers, rng) : buildPolitical(p, grid, hex, nbr, rivers, rng);

  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    meta: { name: pol.realms.length ? `The Known World` : 'Untitled', createdAt: new Date().toISOString(), params: p },
    grid: { cols: p.cols, rows: p.rows, layout: 'pointy-odd-r', hexSize: 1 },
    world: { width, height },
    height: hf,
    baseTemp,
    moisture: finalMoisture,
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
  const game = sanitizeGame(p.game);
  const landFraction = c(p.landFraction, 0.15, 0.7);
  const size = game?.on ? gameGrid(game, landFraction) : null;
  return {
    ...p,
    ...(game ? { game } : {}),
    seed: String(p.seed || 'cartographer'),
    cols: size ? size.cols : Math.round(c(p.cols, 40, 600)),
    rows: size ? size.rows : Math.round(c(p.rows, 30, 400)),
    landFraction,
    mountains: c(p.mountains, 0, 1),
    rainfall: c(p.rainfall, 0.4, 1.6),
    erosion: c(p.erosion ?? DEFAULT_PARAMS.erosion, 0, 1),
    provinceSize: Math.round(c(p.provinceSize, 6, 120)),
    regionSize: Math.round(c(p.regionSize, 2, 12)),
    realmCount: Math.round(c(p.realmCount, 1, 120)),
    tempNorth: c(p.tempNorth, -40, 40),
    tempSouth: c(p.tempSouth, -40, 40),
  };
}
