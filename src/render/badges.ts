import { projector } from './camera';
import type { MapData } from '../model/types';
import { HexFlag } from '../model/types';
import { hexCenterX, hexCenterY } from '../model/hex';
import { formatValue, type DataLayer } from '../model/layers';
import type { View } from './MapRenderer';

/** Pixels per hex radius before values are lettered on the map. */
export const BADGE_ZOOM = 14;

/**
 * Letters a custom layer's values on the map at close zoom: a small disc with
 * the category's initials (or the number) on every hex or province that has a
 * value. Drawn on the label canvas, after the names.
 */
export function drawLayerBadges(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, _dpr: number, view: View, map: MapData, layer: DataLayer): void {
  const z = view.zoom;
  if (z < BADGE_ZOOM) return;
  const def = layer.def;
  const proj = projector(view, cssW, cssH, map.height);
  const scr = (x: number, y: number) => proj.pt(x, y, proj.ground(x, y));
  const { cols, rows } = map.grid;
  const r = Math.min(z * 0.36, 15);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(r * 0.95)}px "Alegreya Sans", sans-serif`;
  const draw = (x: number, y: number, v: number) => {
    const text = badgeText(layer, v);
    if (!text) return;
    const color = badgeColor(layer, v);
    const w = Math.max(r * 2, ctx.measureText(text).width + r);
    ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.92)`;
    ctx.strokeStyle = 'rgba(40, 28, 18, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - r, w, r * 2, r);
    ctx.fill();
    ctx.stroke();
    const lum = color[0] * 0.3 + color[1] * 0.55 + color[2] * 0.15;
    ctx.fillStyle = lum > 150 ? '#2a1d12' : '#fbf4e2';
    ctx.fillText(text, x, y + 0.5);
  };
  if (def.scope === 'hex') {
    // the hexes on screen: a box around what the corners of the view see
    let bx0 = view.cx - cssW / 2 / z, bx1 = view.cx + cssW / 2 / z, by0 = view.cy - cssH / 2 / z, by1 = view.cy + cssH / 2 / z;
    if (!proj.flat) {
      const cs = [proj.unproject(0, 0), proj.unproject(cssW, 0), proj.unproject(0, cssH), proj.unproject(cssW, cssH)];
      if (cs.every(Boolean)) {
        bx0 = Math.min(...cs.map((c) => c![0])) - 2;
        bx1 = Math.max(...cs.map((c) => c![0])) + 2;
        by0 = Math.min(...cs.map((c) => c![1])) - 2;
        by1 = Math.max(...cs.map((c) => c![1])) + 2;
      } else {
        bx0 = 0;
        by0 = 0;
        bx1 = map.world.width;
        by1 = map.world.height;
      }
    }
    const x0 = Math.max(0, Math.floor(bx0 / 1.732) - 1);
    const x1 = Math.min(cols - 1, Math.ceil(bx1 / 1.732) + 1);
    const y0 = Math.max(0, Math.floor((by0 - 1) / 1.5) - 1);
    const y1 = Math.min(rows - 1, Math.ceil(by1 / 1.5) + 1);
    for (let row = y0; row <= y1; row++)
      for (let col = x0; col <= x1; col++) {
        const h = row * cols + col;
        if (!(map.hex.flags[h] & HexFlag.Land)) continue;
        const q = scr(hexCenterX(col, row), hexCenterY(row));
        if (!q || q[2] < BADGE_ZOOM * 0.7 || q[0] < -30 || q[1] < -30 || q[0] > cssW + 30 || q[1] > cssH + 30) continue;
        draw(q[0], q[1], layer.values[h]);
      }
  } else {
    for (const p of map.provinces) {
      if (p.retired || !p.hexes.length) continue;
      const q = scr(p.center[0], p.center[1]);
      if (!q) continue;
      const x = q[0];
      const y = q[1] + 18;
      if (x < -40 || y < -40 || x > cssW + 40 || y > cssH + 40) continue;
      draw(x, y, layer.values[p.id]);
    }
  }
  ctx.restore();
}

function badgeText(layer: DataLayer, v: number): string {
  const def = layer.def;
  switch (def.type) {
    case 'number':
      return formatValue(def, v);
    case 'flag':
      return v ? '✓' : '';
    case 'category': {
      const c = def.categories.find((x) => x.id === v);
      return c ? initials(c.name) : '';
    }
    case 'tags':
      return def.categories
        .filter((c) => (v >>> 0) & (1 << c.id))
        .map((c) => initials(c.name))
        .join('·');
  }
}

function badgeColor(layer: DataLayer, v: number): [number, number, number] {
  const def = layer.def;
  if (def.type === 'category') return def.categories.find((x) => x.id === v)?.color ?? [200, 190, 170];
  if (def.type === 'tags') {
    const first = def.categories.find((c) => (v >>> 0) & (1 << c.id));
    return first?.color ?? [200, 190, 170];
  }
  if (def.type === 'flag') return def.categories[0]?.color ?? [196, 70, 50];
  return [246, 238, 216];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}
