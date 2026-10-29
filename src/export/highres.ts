import { t } from '../i18n';
import type { MapData } from '../model/types';
import type { RenderAssets } from '../render/assets';
import { MapRenderer } from '../render/MapRenderer';
import type { MapMode } from '../render/mapModes';
import { drawLabels } from '../render/LabelLayer';
import { drawLayerBadges } from '../render/badges';
import { preloadSymbols } from '../render/symbols';
import type { DataLayer } from '../model/layers';

/**
 * High-resolution image of the whole world, rendered in tiles by a second,
 * offscreen renderer and stitched together; lettering and symbols are drawn
 * once over the full image so nothing is cut at tile seams.
 *
 * `look` is the zoom (CSS px per world unit) whose style the image takes: the
 * paper map with realm names, the terrain with region names, or provinces
 * with towns. The pixel size then only sets the sharpness.
 */

export const LOOKS = [
  { key: 'world', name: 'World map', hint: 'Paper map, realm names', zoom: 3.2 },
  { key: 'realm', name: 'Realm map', hint: 'Terrain, region names', zoom: 10 },
  { key: 'province', name: 'Province map', hint: 'Provinces, towns and names', zoom: 22 },
] as const;
export type LookKey = (typeof LOOKS)[number]['key'];

export const WIDTHS = [4096, 8192, 12288, 16384];
/** browsers refuse canvases much past this many pixels */
export const MAX_PIXELS = 200e6;

export interface HighResOptions {
  width: number;
  look: LookKey;
  mode: MapMode;
  layer?: { colors: Uint8Array; badges: DataLayer | null } | null;
}

export function highResSize(map: MapData, width: number): { width: number; height: number } {
  return { width, height: Math.round((width * map.world.height) / map.world.width) };
}

/** Sharpness relative to the screen: below 1 the look is drawn blurrier than on screen. */
export function sharpnessFor(map: MapData, width: number, look: LookKey): number {
  const z = LOOKS.find((l) => l.key === look)!.zoom;
  return width / (map.world.width * z);
}

const TILE = 2048;

export async function renderHighRes(map: MapData, assets: RenderAssets, o: HighResOptions, onProgress: (label: string, f: number) => void): Promise<Blob> {
  const { width, height } = highResSize(map, o.width);
  if (width * height > MAX_PIXELS) throw new Error(t('An image of {w} × {h} pixels is larger than browsers can draw. Choose a smaller size.', { w: width, h: height }));
  const look = LOOKS.find((l) => l.key === o.look)!.zoom;
  const pr = width / (map.world.width * look);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error(t('Your browser could not make an image this large. Choose a smaller size.'));
  const glCanvas = document.createElement('canvas');
  const r = new MapRenderer(glCanvas);
  try {
    r.setMap(map, assets);
    if (o.layer) r.setLayerColors(o.layer.colors, map.grid.cols, map.grid.rows);
    await preloadSymbols(map);
    const scale = width / map.world.width; // output px per world unit
    const cols = Math.ceil(width / TILE);
    const rows = Math.ceil(height / TILE);
    let k = 0;
    for (let ty = 0; ty < rows; ty++)
      for (let tx = 0; tx < cols; tx++) {
        const x0 = tx * TILE;
        const y0 = ty * TILE;
        const tw = Math.min(TILE, width - x0);
        const th = Math.min(TILE, height - y0);
        r.renderExact({ view: { cx: (x0 + tw / 2) / scale, cy: (y0 + th / 2) / scale, zoom: look }, mode: o.mode, selectedProvince: -1, hoveredProvince: -1 }, tw, th, pr);
        ctx.drawImage(glCanvas, 0, 0, tw, th, x0, y0, tw, th);
        k++;
        onProgress(t('Painting the map'), (k / (cols * rows)) * 0.75);
        // let the page breathe between tiles
        await new Promise((res) => setTimeout(res, 0));
      }
    onProgress(t('Lettering'), 0.78);
    const view = { cx: map.world.width / 2, cy: map.world.height / 2, zoom: look };
    drawLabels(ctx, width / pr, height / pr, pr, view, map, assets, null, null, false);
    if (o.layer?.badges) drawLayerBadges(ctx, width / pr, height / pr, pr, view, map, o.layer.badges);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    onProgress(t('Compressing the image'), 0.85);
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
    if (!blob) throw new Error(t('The image could not be compressed. Try a smaller size.'));
    onProgress(t('Done'), 1);
    return blob;
  } finally {
    r.dispose(true);
    out.width = out.height = 0;
  }
}
