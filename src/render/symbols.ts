import type { MapData } from '../model/types';
import { assetById, heightOf, levelOf, visibleAt, type Placement, type SymbolAsset } from '../model/symbols';
import type { View } from './MapRenderer';

/**
 * Draws placed symbols on the lettering canvas, under the names. Pictures
 * are decoded once and rasterised per size bucket; tinted and ink-look
 * variants are cached separately.
 */

type Ready = HTMLImageElement | HTMLCanvasElement;
const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
const variants = new Map<string, HTMLCanvasElement>();
let onReady: (() => void) | null = null;

export const INK_RGB: [number, number, number] = [42, 29, 19];
export const PAPER_RGB: [number, number, number] = [239, 227, 196];

/** Called when a picture finishes loading, so the view can redraw. */
export function setSymbolReadyCallback(cb: () => void): void {
  onReady = cb;
}

function sourceOf(a: SymbolAsset): HTMLImageElement | null {
  const key = a.id + ':' + a.data.length;
  const got = images.get(key);
  if (got instanceof HTMLImageElement) return got;
  if (got) return null;
  images.set(key, 'loading');
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    images.set(key, img);
    onReady?.();
  };
  img.onerror = () => images.set(key, 'failed');
  img.src = a.kind === 'svg' ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(a.data) : a.data;
  return null;
}

/** Resolves once every picture the map uses has loaded (or failed), for exports. */
export function preloadSymbols(map: MapData): Promise<void> {
  const ids = new Set<string>((map.symbols?.placements ?? []).map((p) => p.asset));
  const st = map.symbols?.settlements;
  if (st) for (const v of [...Object.values(st.size), ...Object.values(st.realm), ...Object.values(st.culture)]) if (v) ids.add(v);
  const waits: Promise<void>[] = [];
  for (const id of ids) {
    const a = assetById(map, id);
    if (!a) continue;
    if (sourceOf(a)) continue;
    const key = a.id + ':' + a.data.length;
    waits.push(
      new Promise((res) => {
        const t0 = performance.now();
        const tick = () => (images.get(key) !== 'loading' || performance.now() - t0 > 5000 ? res() : setTimeout(tick, 30));
        tick();
      }),
    );
  }
  return Promise.all(waits).then(() => {});
}

/**
 * A ready-to-draw picture for an asset at roughly `px` pixels wide, tinted or
 * redrawn in ink if asked. Returns null while it is still loading.
 */
export function pictureFor(a: SymbolAsset, px: number, tint: [number, number, number] | null, ink: boolean): Ready | null {
  const src = sourceOf(a);
  if (!src) return null;
  if (!tint && !ink && a.kind === 'png') return src;
  // rasterise at a power-of-two width so SVGs stay crisp when zoomed
  const bucket = Math.min(1024, Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, px)))));
  const key = `${a.id}:${a.data.length}:${bucket}:${tint ? tint.join(',') : '-'}:${ink ? 1 : 0}`;
  let c = variants.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = bucket;
  c.height = Math.max(1, Math.round((bucket * a.h) / Math.max(1, a.w)));
  const ctx = c.getContext('2d', { willReadFrequently: ink })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  if (ink) {
    // dark lines become ink, light areas paper; transparency is kept
    const im = ctx.getImageData(0, 0, c.width, c.height);
    const d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const lum = (d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15) / 255;
      const t = Math.min(1, Math.max(0, (lum - 0.3) / 0.4));
      for (let k = 0; k < 3; k++) d[i + k] = INK_RGB[k] + (PAPER_RGB[k] - INK_RGB[k]) * t;
    }
    ctx.putImageData(im, 0, 0);
  }
  if (tint) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${tint.join(',')})`;
    ctx.fillRect(0, 0, c.width, c.height);
    // multiply fills the transparent parts too: cut back to the picture's shape
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (variants.size > 600) variants.delete(variants.keys().next().value!);
  variants.set(key, c);
  return c;
}

export function drawSymbols(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, dpr: number, view: View, map: MapData, selected: number | null): void {
  const ps = map.symbols?.placements;
  if (!ps?.length) return;
  const z = view.zoom;
  const level = levelOf(z);
  for (const p of ps) {
    if (!visibleAt(p, level)) continue;
    drawPlacement(ctx, cssW, cssH, dpr, view, map, p, p.id === selected);
  }
}

export function drawPlacement(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, dpr: number, view: View, map: MapData, p: Placement, selected: boolean, alpha = 1): void {
  const a = assetById(map, p.asset);
  if (!a) return;
  const z = view.zoom;
  const w = p.size * z;
  const h = heightOf(map, p) * z;
  if (w < 2) return;
  const sx = (p.x - view.cx) * z + cssW / 2;
  const sy = (p.y - view.cy) * z + cssH / 2;
  const r = Math.max(w, h);
  if (sx < -r || sy < -r || sx > cssW + r || sy > cssH + r) return;
  const pic = pictureFor(a, w * dpr, p.tint, p.ink);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate((p.rotation * Math.PI) / 180);
  if (p.flip) ctx.scale(-1, 1);
  if (pic) {
    ctx.globalAlpha = p.opacity * alpha;
    ctx.drawImage(pic, -w / 2, -h / 2, w, h);
  }
  if (selected) {
    ctx.globalAlpha = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
    ctx.strokeStyle = 'rgba(40, 26, 14, 0.9)';
    ctx.lineDashOffset = 3.5;
    ctx.strokeRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6);
  }
  ctx.restore();
}
