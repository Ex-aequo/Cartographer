import { ZOOM, applyZoomProfile } from '../render/MapRenderer';

export interface ZoomLevel {
  key: string;
  name: string;
  hint: string;
  /** CSS px per world unit (1 world unit = 1 hex radius) where the level starts */
  from: number;
  /** where the ladder button flies to (0 = fit the whole world) */
  target: number;
}

/** The four zoom levels of a classic map. */
export const LEVELS: ZoomLevel[] = [
  { key: 'world', name: 'World', hint: 'Paper map of realms', from: 0, target: 0 /* fit */ },
  { key: 'realm', name: 'Realm', hint: 'Regions and terrain', from: 7, target: 10 },
  { key: 'province', name: 'Province', hint: 'Provinces and settlements', from: 16, target: 26 },
  { key: 'hex', name: 'Hex', hint: 'Individual hexes', from: 45, target: 80 },
];

/**
 * 4X maps have three: the paper map of kingdoms, a kingdom with its provinces
 * and towns, and the hexes. Their zooms follow the map's zoom profile (set
 * when the map is shown), since a small map fills the screen at a high zoom.
 */
export function levelsFor(game: boolean, world?: { width: number }): ZoomLevel[] {
  if (!game) return LEVELS;
  if (world) applyZoomProfile(world, true);
  return [
    { key: 'world', name: 'World', hint: 'Paper map of kingdoms', from: 0, target: 0 },
    { key: 'kingdom', name: 'Kingdom', hint: 'Provinces and settlements', from: ZOOM.paperEnd * 1.05, target: ZOOM.townFade1 * 1.05 },
    { key: 'hex', name: 'Hex', hint: 'Individual hexes', from: ZOOM.hexStart * 1.05, target: ZOOM.hexFull * 1.3 },
  ];
}

export function levelIndexFor(zoom: number, levels: ZoomLevel[] = LEVELS): number {
  let k = 0;
  levels.forEach((l, i) => {
    if (zoom >= l.from) k = i;
  });
  return k;
}
