import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { LoadedMap } from '../state/useMapWorker';
import { MapRenderer, ZOOM, hexFactor, type MapMode, type Quality, type View } from '../render/MapRenderer';
import { drawLabels } from '../render/LabelLayer';
import { hexAt } from '../model/hex';
import { ID_RES } from '../render/assets';

/** Lettering stays crisp whatever the map's render quality. */
const labelDpr = () => Math.min(window.devicePixelRatio || 1, 2);

export interface Pick {
  hex: number;
  province: number; // −1 for water
}

export interface MapViewHandle {
  flyTo(zoom: number, cx?: number, cy?: number): void;
  jumpTo(zoom: number, cx?: number, cy?: number): void;
  fit(): void;
  getView(): View;
  snapshot(): Promise<Blob | null>;
  setUniform(name: string, value: number): void;
}

interface Props {
  quality: Quality;
  loaded: LoadedMap | null;
  mode: MapMode;
  selected: Pick | null;
  onSelect(p: Pick | null): void;
  onZoom(zoom: number): void;
}

export const MapView = forwardRef<MapViewHandle, Props>(function MapView({ quality, loaded, mode, selected, onSelect, onZoom }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);
  const labelCanvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MapRenderer | null>(null);
  const view = useRef<View>({ cx: 0, cy: 0, zoom: 1 });
  const hover = useRef(-1);
  const size = useRef({ w: 1, h: 1 });
  const frame = useRef(0);
  const anim = useRef<{ from: View; to: View; t0: number; dur: number } | null>(null);
  const props = useRef({ loaded, mode, selected, onZoom });
  props.current = { loaded, mode, selected, onZoom };
  const lastZoomReported = useRef(-1);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const draw = useCallback(() => {
    const r = renderer.current;
    const l = props.current.loaded;
    if (!r || !l) return;
    if (anim.current) {
      const { from, to, t0, dur } = anim.current;
      const t = Math.min(1, (performance.now() - t0) / dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // zoom interpolates in log space so the motion feels even
      const z = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
      view.current = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, zoom: z };
      if (t >= 1) anim.current = null;
      else schedule();
    }
    r.render({ view: view.current, mode: props.current.mode, selectedProvince: props.current.selected?.province ?? -1, hoveredProvince: hover.current });
    const ctx = labelCanvas.current!.getContext('2d')!;
    drawLabels(ctx, size.current.w, size.current.h, labelDpr(), view.current, l.map, l.assets);
    if (Math.abs(view.current.zoom - lastZoomReported.current) > 1e-3) {
      lastZoomReported.current = view.current.zoom;
      props.current.onZoom(view.current.zoom);
    }
  }, []);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  const clampView = (v: View): View => {
    const l = props.current.loaded;
    if (!l) return v;
    const { width, height } = l.map.world;
    const fitZ = fitZoom();
    const zoom = Math.min(ZOOM.max, Math.max(fitZ * 0.7, v.zoom));
    const mx = size.current.w / 2 / zoom;
    const my = size.current.h / 2 / zoom;
    const cx = Math.min(Math.max(v.cx, Math.min(mx * 0.5, width / 2)), Math.max(width - mx * 0.5, width / 2));
    const cy = Math.min(Math.max(v.cy, Math.min(my * 0.5, height / 2)), Math.max(height - my * 0.5, height / 2));
    return { cx, cy, zoom };
  };

  const fitZoom = () => {
    const l = props.current.loaded;
    if (!l) return 1;
    return Math.min(size.current.w / l.map.world.width, size.current.h / l.map.world.height) * 0.94;
  };

  const flyTo = useCallback(
    (zoom: number, cx?: number, cy?: number) => {
      const to = clampView({ cx: cx ?? view.current.cx, cy: cy ?? view.current.cy, zoom });
      anim.current = { from: { ...view.current }, to, t0: performance.now(), dur: 650 };
      schedule();
    },
    [schedule],
  );

  useImperativeHandle(ref, () => ({
    flyTo,
    jumpTo(zoom: number, cx?: number, cy?: number) {
      anim.current = null;
      view.current = clampView({ cx: cx ?? view.current.cx, cy: cy ?? view.current.cy, zoom });
      schedule();
    },
    fit() {
      const l = props.current.loaded;
      if (!l) return;
      flyTo(fitZoom(), l.map.world.width / 2, l.map.world.height / 2);
    },
    getView: () => ({ ...view.current }),
    setUniform(name: string, value: number) {
      renderer.current?.setUniform(name, value);
      schedule();
    },
    async snapshot() {
      const r = renderer.current;
      if (!r || !props.current.loaded) return null;
      draw();
      const gl = glCanvas.current!;
      const lc = labelCanvas.current!;
      const out = document.createElement('canvas');
      out.width = lc.width;
      out.height = lc.height;
      const ctx = out.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(gl, 0, 0, out.width, out.height);
      ctx.drawImage(lc, 0, 0);
      return new Promise((res) => out.toBlob((b) => res(b), 'image/png'));
    },
  }));

  // renderer lifetime
  useEffect(() => {
    const r = new MapRenderer(glCanvas.current!);
    renderer.current = r;
    const ro = new ResizeObserver(() => {
      const el = wrap.current!;
      size.current = { w: el.clientWidth, h: el.clientHeight };
      r.resize(size.current.w, size.current.h);
      labelCanvas.current!.width = Math.round(size.current.w * labelDpr());
      labelCanvas.current!.height = Math.round(size.current.h * labelDpr());
      view.current = clampView(view.current);
      draw();
    });
    ro.observe(wrap.current!);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
      r.dispose();
      renderer.current = null;
    };
  }, [draw]);

  // new map → upload and frame it
  useEffect(() => {
    if (!loaded || !renderer.current) return;
    renderer.current.setMap(loaded.map, loaded.assets);
    hover.current = -1;
    view.current = { cx: loaded.map.world.width / 2, cy: loaded.map.world.height / 2, zoom: fitZoom() };
    // fonts arrive asynchronously; redraw lettering once they are ready
    document.fonts?.ready.then(() => schedule());
    draw();
  }, [loaded, draw, schedule]);

  useEffect(() => schedule(), [mode, selected, schedule]);

  useEffect(() => {
    const r = renderer.current;
    if (!r) return;
    r.setQuality(quality);
    schedule();
  }, [quality, schedule]);

  // ------------------------------------------------------------ input ---
  useEffect(() => {
    const el = wrap.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt: { x: number; y: number } | null = null;
    let moved = 0;
    let pinch: { d: number; zoom: number } | null = null;

    const worldAt = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      const v = view.current;
      return { wx: v.cx + (x - r.left - size.current.w / 2) / v.zoom, wy: v.cy + (y - r.top - size.current.h / 2) / v.zoom };
    };
    const zoomAround = (factor: number, x: number, y: number) => {
      const { wx, wy } = worldAt(x, y);
      const v = view.current;
      const nz = clampView({ ...v, zoom: v.zoom * factor }).zoom;
      const f = nz / v.zoom;
      view.current = clampView({ cx: wx - (wx - v.cx) / f, cy: wy - (wy - v.cy) / f, zoom: nz });
      anim.current = null;
      schedule();
    };
    const pickAt = (x: number, y: number): Pick | null => {
      const l = props.current.loaded;
      if (!l) return null;
      const { wx, wy } = worldAt(x, y);
      const hex = hexAt(l.map.grid, wx, wy);
      if (hex < 0) return null;
      const i = Math.floor(wx * ID_RES);
      const j = Math.floor(wy * ID_RES);
      let province = -1;
      if (hexFactor(view.current.zoom) > 0.5) province = l.map.hex.province[hex]; // borders follow hex edges here
      else if (i >= 0 && j >= 0 && i < l.assets.idW && j < l.assets.idH) province = l.assets.provinceIds[j * l.assets.idW + i] - 1;
      return { hex, province };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAround(Math.exp(-dy * 0.0016), e.clientX, e.clientY);
    };
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        downAt = { x: e.clientX, y: e.clientY };
        moved = 0;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.current.zoom };
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        // hover
        const p = pickAt(e.clientX, e.clientY);
        const h = p?.province ?? -1;
        if (h !== hover.current) {
          hover.current = h;
          schedule();
        }
        return;
      }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAround((pinch.zoom * (d / pinch.d)) / view.current.zoom, (a.x + b.x) / 2, (a.y + b.y) / 2);
        moved += 10;
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      const v = view.current;
      view.current = clampView({ ...v, cx: v.cx - dx / v.zoom, cy: v.cy - dy / v.zoom });
      anim.current = null;
      el.style.cursor = 'grabbing';
      schedule();
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      el.style.cursor = '';
      if (pointers.size === 0 && downAt && moved < 5) onSelectRef.current(pickAt(e.clientX, e.clientY));
      if (pointers.size === 0) downAt = null;
    };
    const onLeave = () => {
      if (hover.current !== -1) {
        hover.current = -1;
        schedule();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      const v = view.current;
      const step = 120 / v.zoom;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (e.key === '+' || e.key === '=') zoomAround(1.35, cx, cy);
      else if (e.key === '-' || e.key === '_') zoomAround(1 / 1.35, cx, cy);
      else if (e.key === 'ArrowLeft') view.current = clampView({ ...v, cx: v.cx - step });
      else if (e.key === 'ArrowRight') view.current = clampView({ ...v, cx: v.cx + step });
      else if (e.key === 'ArrowUp') view.current = clampView({ ...v, cy: v.cy - step });
      else if (e.key === 'ArrowDown') view.current = clampView({ ...v, cy: v.cy + step });
      else if (e.key === 'Escape') onSelectRef.current(null);
      else return;
      schedule();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('keydown', onKey);
    };
  }, [schedule]);

  return (
    <div ref={wrap} className="mapview" aria-label="Map. Drag to pan, scroll to zoom, click a province to inspect it." role="application">
      <canvas ref={glCanvas} className="mapview__gl" />
      <canvas ref={labelCanvas} className="mapview__labels" />
    </div>
  );
});
