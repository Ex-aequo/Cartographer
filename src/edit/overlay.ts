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
  if (s && s.hexes.size) {
    const t = settings.tool;
    let c: number[] = [196, 74, 60];
    if (t === 'paint') c = TERRAIN_COLORS[settings.terrain];
    else if (t === 'assign') c = map.realms[map.regions[map.provinces[s.target].region].realm].color;
    else if (t === 'region') c = map.realms[map.regions[s.target].realm].color;
    else if (t === 'realm') c = map.realms[s.target].color;
    else if (t === 'layer') {
      const l = map.layers.find((x) => x.def.id === settings.layer);
      const v = settings.layerValue ?? 0;
      if (l && Number.isNaN(v)) c = [140, 130, 120];
      else if (l && (l.def.type === 'category' || l.def.type === 'tags')) c = l.def.categories.find((k) => k.id === v)?.color ?? c;
      else if (l && l.def.type === 'number') {
        const t2 = l.def.max > l.def.min ? Math.min(1, Math.max(0, (v - l.def.min) / (l.def.max - l.def.min))) : 0;
        c = [0, 1, 2].map((q) => l.def.colorLow[q] + (l.def.colorHigh[q] - l.def.colorLow[q]) * t2);
      }
    }
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
  if (s && (settings.tool === 'river' || settings.tool === 'split' || settings.tool === 'merge') && s.points.length > 1) {
    const ink = settings.tool === 'river' ? 'rgba(52, 104, 128, 0.95)' : settings.tool === 'split' ? 'rgba(150, 40, 32, 0.95)' : 'rgba(40, 30, 20, 0.95)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(236, 226, 201, 0.85)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    s.points.forEach(([x, y], k) => (k ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.stroke();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2.5;
    if (settings.tool === 'split') ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (settings.tool === 'merge') {
      // a dot where the drag started: the province that stays
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(sx(s.points[0][0]), sy(s.points[0][1]), 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // brush outline
  if (pointer && settings.tool !== 'label') {
    const [px, py] = pointer;
    const r = settings.tool === 'river' || settings.tool === 'split' || settings.tool === 'merge' ? 0 : settings.radius * z;
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
