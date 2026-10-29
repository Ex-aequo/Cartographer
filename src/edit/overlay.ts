import type { MapData } from '../model/types';
import { hexCenterX, hexCenterY } from '../model/hex';
import type { View } from '../render/MapRenderer';
import { TERRAIN_COLORS } from '../render/mapModes';
import type { EditSession, ToolSettings } from './session';

/** Brush outline, the river being drawn, and hexes painted in this stroke. */
export function drawEditOverlay(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  view: View,
  map: MapData,
  settings: ToolSettings,
  session: EditSession,
  pointer: [number, number] | null,
): void {
  const z = view.zoom;
  const sx = (x: number) => (x - view.cx) * z + cssW / 2;
  const sy = (y: number) => (y - view.cy) * z + cssH / 2;
  const s = session.stroke;

  // hexes painted or erased in this stroke (they update for real when the stroke ends)
  if (s && s.hexes.size && (settings.tool === 'paint' || settings.tool === 'erase-river')) {
    const c = settings.tool === 'paint' ? TERRAIN_COLORS[settings.terrain] : [196, 74, 60];
    ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.55)`;
    ctx.strokeStyle = `rgba(${Math.round(c[0] * 0.5)}, ${Math.round(c[1] * 0.5)}, ${Math.round(c[2] * 0.5)}, 0.8)`;
    ctx.lineWidth = 1;
    for (const h of s.hexes) {
      const row = Math.floor(h / map.grid.cols);
      const cx = sx(hexCenterX(h % map.grid.cols, row));
      const cy = sy(hexCenterY(row));
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const px = cx + Math.cos(a) * z;
        const py = cy + Math.sin(a) * z;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      if (z > 10) ctx.stroke();
    }
  }

  // the river being drawn
  if (s && settings.tool === 'river' && s.points.length > 1) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(236, 226, 201, 0.85)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    s.points.forEach(([x, y], k) => (k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(52, 104, 128, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // brush outline
  if (pointer) {
    const [px, py] = pointer;
    const r = settings.tool === 'river' ? 0 : settings.radius * z;
    ctx.lineWidth = 1.5;
    if (r > 2) {
      ctx.strokeStyle = 'rgba(20, 14, 9, 0.75)';
      ctx.beginPath();
      ctx.arc(sx(px), sy(py), r + 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(240, 230, 205, 0.95)';
      ctx.beginPath();
      ctx.arc(sx(px), sy(py), r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // centre mark
    ctx.strokeStyle = 'rgba(240, 230, 205, 0.95)';
    ctx.beginPath();
    ctx.moveTo(sx(px) - 5, sy(py));
    ctx.lineTo(sx(px) + 5, sy(py));
    ctx.moveTo(sx(px), sy(py) - 5);
    ctx.lineTo(sx(px), sy(py) + 5);
    ctx.stroke();
  }
}
