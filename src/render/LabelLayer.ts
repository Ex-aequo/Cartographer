import type { MapData } from '../model/types';
import type { CurveLabel, RenderAssets } from './assets';
import type { View } from './MapRenderer';
import { hexCenterX, hexCenterY } from '../model/hex';

export const LABEL_FONT = '"IM Fell English SC", "IM Fell English", Georgia, serif';
export const NAME_FONT = '"IM Fell English", Georgia, serif';

const fade = (z: number, a: number, b: number) => Math.min(1, Math.max(0, (z - a) / (b - a)));

/**
 * Map lettering and settlement marks, drawn with Canvas 2D on top of the
 * WebGL map. Kept in a canvas (not SVG) so exports can flatten both layers.
 */
export function drawLabels(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, dpr: number, view: View, map: MapData, a: RenderAssets): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const z = view.zoom;
  const toScreen = (x: number, y: number): [number, number] => [(x - view.cx) * z + cssW / 2, (y - view.cy) * z + cssH / 2];
  const onScreen = (x: number, y: number, m: number) => x > -m && y > -m && x < cssW + m && y < cssH + m;

  // ---- realm names: large, curved, letter-spaced (world zooms)
  const realmAlpha = 1 - fade(z, 9, 15);
  if (realmAlpha > 0.01) {
    for (const l of a.realmLabels) drawCurved(ctx, l, toScreen, z, realmAlpha, onScreen);
  }

  // ---- settlements
  const iconAlpha = fade(z, 13, 18);
  if (iconAlpha > 0.01) {
    const realmCapitals = new Set(map.realms.map((r) => r.capitalProvince));
    ctx.globalAlpha = iconAlpha;
    for (const p of map.provinces) {
      const row = Math.floor(p.capitalHex / map.grid.cols);
      const [sx, sy] = toScreen(hexCenterX(p.capitalHex % map.grid.cols, row), hexCenterY(row));
      if (!onScreen(sx, sy, 30)) continue;
      drawKeep(ctx, sx, sy, Math.min(1.6, Math.max(0.8, z / 28)) * (realmCapitals.has(p.id) ? 1.35 : 1), realmCapitals.has(p.id));
    }
    ctx.globalAlpha = 1;
  }

  // ---- province names
  const provAlpha = fade(z, 13, 18);
  if (provAlpha > 0.01) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of a.provinceLabels) {
      const [sx, sy] = toScreen(l.x, l.y);
      if (!onScreen(sx, sy, 120)) continue;
      const px = Math.min(22, Math.max(10, l.size * z * 0.62));
      ctx.font = `italic ${px}px ${NAME_FONT}`;
      const w = ctx.measureText(l.text).width;
      const radius = Math.sqrt(map.provinces[l.id].hexes.length * 0.83) * z;
      if (w > radius * 2.4) continue; // not enough room: leave it for the next zoom step
      ctx.globalAlpha = provAlpha;
      ctx.lineWidth = Math.max(2.5, px * 0.22);
      ctx.strokeStyle = 'rgba(28, 20, 12, 0.72)';
      ctx.strokeText(l.text, sx, sy + px * 0.9);
      ctx.fillStyle = '#f1e6c8';
      ctx.fillText(l.text, sx, sy + px * 0.9);
    }
    ctx.globalAlpha = 1;
  }
}

function drawCurved(
  ctx: CanvasRenderingContext2D,
  l: CurveLabel,
  toScreen: (x: number, y: number) => [number, number],
  z: number,
  alpha: number,
  onScreen: (x: number, y: number, m: number) => boolean,
): void {
  const p0 = toScreen(l.p0[0], l.p0[1]);
  const p1 = toScreen(l.p1[0], l.p1[1]);
  const p2 = toScreen(l.p2[0], l.p2[1]);
  let px = l.size * z;
  if (px < 7) return;
  if (!onScreen(p0[0], p0[1], 400) && !onScreen(p2[0], p2[1], 400) && !onScreen(p1[0], p1[1], 400)) return;
  // arc-length table
  const N = 48;
  const pts: [number, number][] = [];
  const cum = [0];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    if (i > 0) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const length = cum[N];
  const text = l.text.toUpperCase();
  const chars = [...text];
  ctx.font = `${px}px ${LABEL_FONT}`;
  let widths = chars.map((c) => ctx.measureText(c).width);
  let total = widths.reduce((s, w) => s + w, 0);
  if (total > length) {
    px *= length / total;
    if (px < 7) return;
    ctx.font = `${px}px ${LABEL_FONT}`;
    widths = chars.map((c) => ctx.measureText(c).width);
    total = widths.reduce((s, w) => s + w, 0);
  }
  // spread letters along the curve, like hand-lettered country names
  const gap = chars.length > 1 ? Math.min(px * 0.85, (length - total) / (chars.length - 1)) : 0;
  const used = total + gap * (chars.length - 1);
  let s = (length - used) / 2;
  const at = (dist: number): [number, number, number] => {
    let i = 1;
    while (i < N && cum[i] < dist) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (dist - cum[i - 1]) / seg;
    const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
    const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
    return [x, y, Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])];
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(52, 34, 20, ${0.8 * alpha})`;
  ctx.strokeStyle = `rgba(236, 224, 196, ${0.35 * alpha})`;
  ctx.lineWidth = Math.max(1, px * 0.08);
  for (let k = 0; k < chars.length; k++) {
    const mid = s + widths[k] / 2;
    const [x, y, ang] = at(mid);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.strokeText(chars[k], 0, 0);
    ctx.fillText(chars[k], 0, 0);
    ctx.restore();
    s += widths[k] + gap;
  }
}

/** A small keep: the settlement mark at each province capital. */
function drawKeep(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, capital: boolean): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  // body with crenellations
  ctx.moveTo(-5, 5);
  ctx.lineTo(-5, -3);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-3, -5);
  ctx.lineTo(-3, -3.5);
  ctx.lineTo(-1, -3.5);
  ctx.lineTo(-1, -5);
  ctx.lineTo(1, -5);
  ctx.lineTo(1, -3.5);
  ctx.lineTo(3, -3.5);
  ctx.lineTo(3, -5);
  ctx.lineTo(5, -5);
  ctx.lineTo(5, 5);
  ctx.closePath();
  ctx.fillStyle = capital ? '#e2c27a' : '#e9dcbc';
  ctx.strokeStyle = 'rgba(30, 20, 12, 0.9)';
  ctx.lineWidth = 1.4;
  ctx.fill();
  ctx.stroke();
  // gate
  ctx.beginPath();
  ctx.moveTo(-1.6, 5);
  ctx.lineTo(-1.6, 1.8);
  ctx.arc(0, 1.8, 1.6, Math.PI, 0);
  ctx.lineTo(1.6, 5);
  ctx.fillStyle = 'rgba(30, 20, 12, 0.85)';
  ctx.fill();
  if (capital) {
    // pennant
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(0, -10.5);
    ctx.strokeStyle = 'rgba(30, 20, 12, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -10.5);
    ctx.lineTo(5, -9);
    ctx.lineTo(0, -7.5);
    ctx.fillStyle = '#9a2f25';
    ctx.fill();
  }
  ctx.restore();
}
