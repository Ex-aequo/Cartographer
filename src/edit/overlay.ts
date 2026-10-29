import { projector } from '../render/camera';
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
  // everything is drawn on the ground, through the same camera as the map
  const proj = projector(view, cssW, cssH, map.height);
  const P = (x: number, y: number): [number, number] => {
    const r = proj.pt(x, y, proj.ground(x, y));
    return r ? [r[0], r[1]] : [-1e5, -1e5];
  };
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
      const wx = hexCenterX(h % map.grid.cols, row);
      const wy = hexCenterY(row);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        const [px, py] = P(wx + Math.cos(a), wy + Math.sin(a));
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
    s.points.forEach(([x, y], k) => {
      const [a, b] = P(x, y);
      if (k) ctx.lineTo(a, b);
      else ctx.moveTo(a, b);
    });
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
      const [a, b] = P(s.points[0][0], s.points[0][1]);
      ctx.arc(a, b, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // brush outline
  if (pointer && settings.tool !== 'label') {
    const [px, py] = pointer;
    const wr = settings.tool === 'river' || settings.tool === 'split' || settings.tool === 'merge' ? 0 : settings.radius;
    const [cx, cy] = P(px, py);
    ctx.lineWidth = 1.5;
    if (wr * z > 2) {
      // the brush circle lies on the land, so it follows hills and the tilt
      const ring = (grow: number) => {
        ctx.beginPath();
        for (let k = 0; k <= 48; k++) {
          const a = (k / 48) * Math.PI * 2;
          const [a0, b0] = P(px + Math.cos(a) * wr, py + Math.sin(a) * wr);
          const [qx, qy] = grow ? [a0 + (a0 - cx) * (grow / Math.max(1, Math.hypot(a0 - cx, b0 - cy))), b0 + (b0 - cy) * (grow / Math.max(1, Math.hypot(a0 - cx, b0 - cy)))] : [a0, b0];
          if (k === 0) ctx.moveTo(qx, qy);
          else ctx.lineTo(qx, qy);
        }
        ctx.stroke();
      };
      ctx.strokeStyle = 'rgba(20, 14, 9, 0.75)';
      ring(1);
      ctx.strokeStyle = 'rgba(240, 230, 205, 0.95)';
      ring(0);
    }
    // centre mark
    ctx.strokeStyle = 'rgba(240, 230, 205, 0.95)';
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();
  }
}
