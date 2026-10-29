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
  const sx = (x: number) => (x - view.cx) * z + cssW / 2;
  const sy = (y: number) => (y - view.cy) * z + cssH / 2;
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
    const x0 = Math.max(0, Math.floor((view.cx - cssW / 2 / z) / 1.732) - 1);
    const x1 = Math.min(cols - 1, Math.ceil((view.cx + cssW / 2 / z) / 1.732) + 1);
    const y0 = Math.max(0, Math.floor((view.cy - cssH / 2 / z - 1) / 1.5) - 1);
    const y1 = Math.min(rows - 1, Math.ceil((view.cy + cssH / 2 / z) / 1.5) + 1);
    for (let row = y0; row <= y1; row++)
      for (let col = x0; col <= x1; col++) {
        const h = row * cols + col;
        if (!(map.hex.flags[h] & HexFlag.Land)) continue;
        draw(sx(hexCenterX(col, row)), sy(hexCenterY(row)), layer.values[h]);
      }
  } else {
    for (const p of map.provinces) {
      if (p.retired || !p.hexes.length) continue;
      const x = sx(p.center[0]);
      const y = sy(p.center[1]) + 18;
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
