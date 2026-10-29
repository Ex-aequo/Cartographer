import { drawSymbols, pictureFor } from './symbols';
import { assetById, settlementAsset } from '../model/symbols';
import type { LabelEdit, MapData } from '../model/types';
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
export interface DrawnLabel {
  key: string;
  /** screen box [x0, y0, x1, y1], CSS px */
  box: number[];
}

/** A curved label with its hand adjustments applied, and the current name. */
export function adjustedCurve(l: CurveLabel, e: LabelEdit | undefined, text: string): CurveLabel {
  if (!e) return { ...l, text };
  const cx = (l.p0[0] + l.p2[0]) / 2;
  const cy = (l.p0[1] + l.p2[1]) / 2;
  const a = e.angle ?? 0;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const tf = (p: [number, number]): [number, number] => {
    const x = p[0] - cx;
    const y = p[1] - cy;
    return [cx + x * ca - y * sa + (e.dx ?? 0), cy + x * sa + y * ca + (e.dy ?? 0)];
  };
  const p0 = tf(l.p0);
  const p2 = tf(l.p2);
  let p1 = tf(l.p1);
  if (e.bend) {
    const len = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]) || 1;
    // perpendicular, pointing "up" on screen for a positive bend
    let nx = -(p2[1] - p0[1]) / len;
    let ny = (p2[0] - p0[0]) / len;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    p1 = [p1[0] + nx * e.bend * len, p1[1] + ny * e.bend * len];
  }
  return { ...l, p0, p1, p2, size: l.size * (e.scale ?? 1), text };
}

export function drawLabels(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  view: View,
  map: MapData,
  a: RenderAssets,
  selectedLabel: string | null = null,
  selectedSymbol: number | null = null,
  /** false to draw over what is already on the canvas (export) */
  clear = true,
): DrawnLabel[] {
  const drawn: DrawnLabel[] = [];
  const edits = map.labels ?? {};
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (clear) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // placed symbols sit under the lettering
  drawSymbols(ctx, cssW, cssH, dpr, view, map, selectedSymbol);
  const z = view.zoom;
  const toScreen = (x: number, y: number): [number, number] => [(x - view.cx) * z + cssW / 2, (y - view.cy) * z + cssH / 2];
  const onScreen = (x: number, y: number, m: number) => x > -m && y > -m && x < cssW + m && y < cssH + m;

  // Placed boxes, for collision checks: [x0, y0, x1, y1]
  const boxes: number[][] = [];
  const hits = (b: number[]) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

  // ---- realm names: large, curved, letter-spaced (world zooms)
  const realmAlpha = 1 - fade(z, 6, 8.5);
  if (realmAlpha > 0.01) {
    for (const l0 of a.realmLabels) {
      const key = `realm:${l0.id}`;
      const e = edits[key];
      if (e?.hidden || map.realms[l0.id]?.retired) continue;
      const box = drawCurved(ctx, adjustedCurve(l0, e, map.realms[l0.id]?.name ?? l0.text), toScreen, z, realmAlpha, onScreen, REALM_STYLE);
      // while realm names are still legible, region names keep clear of them
      if (box && realmAlpha > 0.25) {
        boxes.push(box);
        drawn.push({ key, box });
      }
    }
  }

  // ---- region (duchy) names: realm zoom
  const regionAlpha = fade(z, 7, 9) * (1 - fade(z, 15, 19));
  if (regionAlpha > 0.01) {
    for (const l0 of a.regionLabels) {
      const key = `region:${l0.id}`;
      const e = edits[key];
      if (e?.hidden || map.regions[l0.id]?.retired) continue;
      // a label placed by hand stays where it was put, collisions or not
      const box = drawCurved(ctx, adjustedCurve(l0, e, map.regions[l0.id]?.name ?? l0.text), toScreen, z, regionAlpha, onScreen, REGION_STYLE, e ? undefined : hits);
      if (box) {
        boxes.push(box);
        if (regionAlpha > 0.25) drawn.push({ key, box });
      }
    }
  }

  // ---- settlements
  const iconAlpha = fade(z, 13, 18);
  const iconAt: [number, number, number][] = []; // per province: x, y, half-size
  if (iconAlpha > 0.01) {
    const realmCapitals = new Set(map.realms.filter((r) => !r.retired).map((r) => r.capitalProvince));
    const seats = new Set(map.regions.filter((r) => !r.retired).map((r) => r.capitalProvince));
    const st = map.symbols?.settlements;
    ctx.globalAlpha = iconAlpha;
    for (const p of map.provinces) {
      if (p.retired || p.capitalHex < 0) continue;
      const row = Math.floor(p.capitalHex / map.grid.cols);
      const [sx, sy] = toScreen(hexCenterX(p.capitalHex % map.grid.cols, row), hexCenterY(row));
      if (!onScreen(sx, sy, 30)) continue;
      const cap = realmCapitals.has(p.id);
      const sc = Math.min(1.6, Math.max(0.8, z / 28)) * (cap ? 1.35 : 1);
      const custom = settlementAsset(map, p.id, cap ? 'capital' : seats.has(p.id) ? 'seat' : 'town');
      const asset = custom ? assetById(map, custom) : undefined;
      let hs = 6 * sc;
      if (asset) {
        // the user's own town mark, centred on the town like the keep
        const w = 15 * sc * (st?.scale ?? 1.8);
        const h = (w * asset.h) / Math.max(1, asset.w);
        const pic = pictureFor(asset, w * dpr, null, st?.ink ?? false);
        if (pic) ctx.drawImage(pic, sx - w / 2, sy - h / 2, w, h);
        hs = Math.max(w, h) / 2;
      } else drawKeep(ctx, sx, sy, sc, cap);
      iconAt[p.id] = [sx, sy, hs];
      boxes.push([sx - hs, sy - hs * (cap && !asset ? 1.9 : 1), sx + hs, sy + hs]);
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
      const key = `province:${l.id}`;
      const e = edits[key];
      const prov = map.provinces[l.id];
      if (e?.hidden || !prov || prov.retired) continue;
      const text = prov.name;
      const [lx, ly] = toScreen(l.x + (e?.dx ?? 0), l.y + (e?.dy ?? 0));
      if (!onScreen(lx, ly, 120)) continue;
      const px = Math.min(22 * (e?.scale ?? 1), Math.max(10, l.size * z * 0.62 * (e?.scale ?? 1)));
      ctx.font = `italic ${px}px ${NAME_FONT}`;
      const w = ctx.measureText(text).width;
      const radius = Math.sqrt(prov.hexes.length * 0.83) * z;
      if (!e && w > radius * 2.4) continue; // not enough room: leave it for the next zoom step
      // a hand-placed name goes exactly where it was put; otherwise try the
      // open middle of the province first, then beside its own settlement
      const cands: [number, number][] = [[lx, ly]];
      const ic = iconAt[l.id];
      if (ic && !e) cands.push([ic[0], ic[1] + ic[2] + px * 0.7], [ic[0], ic[1] - ic[2] * 2 - px * 0.6]);
      let placed: [number, number] | null = null;
      for (const [cx, cy] of cands) {
        const box = [cx - w / 2 - 2, cy - px * 0.55, cx + w / 2 + 2, cy + px * 0.55];
        if (e || !hits(box)) {
          placed = [cx, cy];
          boxes.push(box);
          drawn.push({ key, box });
          break;
        }
      }
      if (!placed) continue;
      ctx.globalAlpha = provAlpha;
      ctx.lineWidth = Math.max(2.5, px * 0.22);
      ctx.strokeStyle = 'rgba(28, 20, 12, 0.72)';
      ctx.strokeText(text, placed[0], placed[1]);
      ctx.fillStyle = '#f1e6c8';
      ctx.fillText(text, placed[0], placed[1]);
    }
    ctx.globalAlpha = 1;
  }

  // the label being adjusted
  const sel = selectedLabel ? drawn.find((d) => d.key === selectedLabel) : null;
  if (sel) {
    const [x0, y0, x1, y1] = sel.box;
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(240, 230, 205, 0.95)';
    ctx.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
    ctx.strokeStyle = 'rgba(30, 20, 12, 0.8)';
    ctx.lineDashOffset = 4;
    ctx.strokeRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
  return drawn;
}

/** The topmost drawn label under a screen point. */
export function labelAt(drawn: DrawnLabel[], x: number, y: number): string | null {
  for (let k = drawn.length - 1; k >= 0; k--) {
    const [x0, y0, x1, y1] = drawn[k].box;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return drawn[k].key;
  }
  return null;
}

interface CurveStyle {
  font: string;
  fill: [number, number, number, number];
  halo: [number, number, number, number];
  maxPx: number;
  minPx: number;
  /** extra spacing between letters, as a fraction of font size (max) */
  spread: number;
}

const REALM_STYLE: CurveStyle = { font: LABEL_FONT, fill: [52, 34, 20, 0.8], halo: [236, 224, 196, 0.35], maxPx: 9999, minPx: 7, spread: 0.85 };
const REGION_STYLE: CurveStyle = { font: LABEL_FONT, fill: [36, 24, 14, 0.86], halo: [240, 230, 205, 0.5], maxPx: 24, minPx: 10, spread: 0.3 };

function drawCurved(
  ctx: CanvasRenderingContext2D,
  l: CurveLabel,
  toScreen: (x: number, y: number) => [number, number],
  z: number,
  alpha: number,
  onScreen: (x: number, y: number, m: number) => boolean,
  style: CurveStyle,
  blocked?: (box: number[]) => boolean,
): number[] | null {
  const p0 = toScreen(l.p0[0], l.p0[1]);
  const p1 = toScreen(l.p1[0], l.p1[1]);
  const p2 = toScreen(l.p2[0], l.p2[1]);
  let px = Math.min(style.maxPx, l.size * z);
  if (px < style.minPx) return null;
  if (!onScreen(p0[0], p0[1], 400) && !onScreen(p2[0], p2[1], 400) && !onScreen(p1[0], p1[1], 400)) return null;
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
  ctx.font = `${px}px ${style.font}`;
  let widths = chars.map((c) => ctx.measureText(c).width);
  let total = widths.reduce((s, w) => s + w, 0);
  if (total > length) {
    px *= length / total;
    if (px < style.minPx) return null;
    ctx.font = `${px}px ${style.font}`;
    widths = chars.map((c) => ctx.measureText(c).width);
    total = widths.reduce((s, w) => s + w, 0);
  }
  // spread letters along the curve, like hand-lettered country names
  const gap = chars.length > 1 ? Math.min(px * style.spread, (length - total) / (chars.length - 1)) : 0;
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
  // bounding box of the lettering, for collision checks
  const [bx0, by0] = at(s);
  const [bx1, by1] = at(s + used);
  const [bxm, bym] = at(s + used / 2);
  const box = [Math.min(bx0, bx1, bxm) - px * 0.5, Math.min(by0, by1, bym) - px * 0.6, Math.max(bx0, bx1, bxm) + px * 0.5, Math.max(by0, by1, bym) + px * 0.6];
  if (blocked && blocked(box)) return null;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const f = style.fill;
  const hl = style.halo;
  ctx.fillStyle = `rgba(${f[0]}, ${f[1]}, ${f[2]}, ${f[3] * alpha})`;
  ctx.strokeStyle = `rgba(${hl[0]}, ${hl[1]}, ${hl[2]}, ${hl[3] * alpha})`;
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
  return box;
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
