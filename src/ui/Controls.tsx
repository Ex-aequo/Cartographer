import { t } from '../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_CAMERA, MAX_TILT, wrapAngle, type Camera3D } from '../render/camera';
import { MODES, categoriesFor, isLayerMode, modeDef, rampFor, type MapMode } from '../render/mapModes';
import { formatValue, numberRange, type DataLayer } from '../model/layers';
import { LEVELS, levelIndexFor } from './zoomLevels';

export function ZoomLadder({ zoom, onLevel, onStep, top }: { zoom: number; onLevel(i: number): void; onStep(f: number): void; top?: ReactNode }) {
  const active = levelIndexFor(zoom);
  return (
    <nav className="ladder" aria-label={t('Zoom level')}>
      {top}
      <button className="ladder__step" onClick={() => onStep(1.5)} aria-label={t('Zoom in')}>
        +
      </button>
      <ol>
        {LEVELS.slice()
          .reverse()
          .map((l) => {
            const i = LEVELS.indexOf(l);
            return (
              <li key={l.key}>
                <button className={i === active ? 'is-on' : ''} onClick={() => onLevel(i)} title={t(l.hint)} aria-current={i === active ? 'true' : undefined}>
                  <span className="ladder__tick" aria-hidden />
                  {t(l.name)}
                </button>
              </li>
            );
          })}
      </ol>
      <button className="ladder__step" onClick={() => onStep(1 / 1.5)} aria-label={t('Zoom out')}>
        −
      </button>
    </nav>
  );
}

export function ModeSwitch({ mode, onMode, layers, hasRaces }: { mode: MapMode; onMode(m: MapMode): void; layers: { id: string; name: string }[]; hasRaces: boolean }) {
  const art = MODES.filter((m) => m.kind === 'art');
  const data = MODES.filter((m) => m.kind === 'data' && (m.key !== 'races' || hasRaces));
  const btn = (m: (typeof MODES)[number]) => (
    <button key={m.key} role="radio" aria-checked={mode === m.key} className={mode === m.key ? 'is-on' : ''} onClick={() => onMode(m.key)}>
      {isLayerMode(m.key) ? m.label : t(m.label)}
    </button>
  );
  return (
    <div className="modes" role="radiogroup" aria-label={t('Map mode')}>
      {art.map(btn)}
      <span className="modes__sep" aria-hidden />
      {data.map(btn)}
      {layers.length > 0 && <span className="modes__sep" aria-hidden />}
      {layers.map((l) => btn({ key: `layer:${l.id}`, label: l.name, kind: 'data', shader: 3 }))}
    </div>
  );
}

export function Legend({ mode, present, layer, races }: { mode: MapMode; present?: Set<number>; layer?: DataLayer | null; races?: { name: string; color: [number, number, number] }[] }) {
  if (isLayerMode(mode)) return layer ? <LayerLegend layer={layer} /> : null;
  if (mode === 'races')
    return (
      <div className="legend legend--cats" aria-label={t('{name} legend', { name: t('Races') })}>
        {(races ?? []).map((r) => (
          <span key={r.name} className="legend__cat">
            <i style={{ background: `rgb(${r.color.join(',')})` }} />
            {r.name}
          </span>
        ))}
        <span className="legend__cat">
          <i style={{ background: 'rgba(205,196,176,.45)' }} />
          {t('Unaligned')}
        </span>
      </div>
    );
  const ramp = rampFor(mode);
  const cats = categoriesFor(mode);
  if (!ramp && !cats) return null;
  if (ramp) {
    const lo = ramp.stops[0];
    const hi = ramp.stops[ramp.stops.length - 1];
    const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
    const gradient = ramp.stops.map((v, i) => `rgb(${ramp.colors[i].join(',')}) ${pct(v)}%`).join(', ');
    return (
      <div className="legend" aria-label={t('{name} legend', { name: t(modeDef(mode).label) })}>
        <div className="legend__bar" style={{ background: `linear-gradient(to right, ${gradient})` }} />
        <div className="legend__ticks">
          {ramp.ticks.map((tk) => (
            <span key={tk.label} style={{ left: `${pct(tk.at)}%` }}>
              {t(tk.label)}
            </span>
          ))}
        </div>
      </div>
    );
  }
  const shown = cats!.filter((c) => !present || present.has(c.code));
  return (
    <div className="legend legend--cats" aria-label={t('{name} legend', { name: t(modeDef(mode).label) })}>
      {shown.map((c) => (
        <span key={c.code} className="legend__cat">
          <i style={{ background: `rgb(${c.color.join(',')})` }} />
          {t(c.name)}
        </span>
      ))}
    </div>
  );
}

function LayerLegend({ layer }: { layer: DataLayer }) {
  const def = layer.def;
  const css = (c: [number, number, number]) => `rgb(${c.map(Math.round).join(',')})`;
  if (def.type === 'number') {
    const [lo, hi] = numberRange(layer);
    return (
      <div className="legend" aria-label={t('{name} legend', { name: def.name })}>
        <p className="legend__title">{def.name}</p>
        <div className="legend__bar" style={{ background: `linear-gradient(to right, ${css(def.colorLow)}, ${css(def.colorHigh)})` }} />
        <div className="legend__ticks">
          <span style={{ left: '0%' }}>{formatValue(def, lo)}</span>
          <span style={{ left: '100%' }}>{formatValue(def, hi)}</span>
        </div>
      </div>
    );
  }
  const items = def.type === 'flag' ? [{ id: 1, name: t('Yes'), color: def.categories[0]?.color ?? ([196, 70, 50] as [number, number, number]) }] : def.categories;
  return (
    <div className="legend legend--cats" aria-label={t('{name} legend', { name: def.name })}>
      <p className="legend__title">{def.name}</p>
      {items.map((c) => (
        <span key={c.id} className="legend__cat">
          <i style={{ background: css(c.color) }} />
          {c.name}
        </span>
      ))}
      {items.length === 0 && <span className="legend__cat">{t('No categories yet')}</span>}
    </div>
  );
}

export function Veil({ step, fraction }: { step: string; fraction: number }) {
  return (
    <div className="veil" role="status" aria-live="polite">
      <div className="veil__card">
        <p className="veil__step">{t(step)}</p>
        <div className="veil__bar">
          <span style={{ transform: `scaleX(${Math.max(0.04, fraction)})` }} />
        </div>
      </div>
    </div>
  );
}

/** A tiny broadcast so the compass follows the camera without re-rendering the whole app. */
export function cameraBus() {
  let last: Camera3D = { ...DEFAULT_CAMERA };
  const subs = new Set<(c: Camera3D) => void>();
  return {
    emit(c: Camera3D) {
      last = c;
      subs.forEach((f) => f(c));
    },
    subscribe(f: (c: Camera3D) => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
    get: () => last,
  };
}
export type CameraBus = ReturnType<typeof cameraBus>;

const deg = (r: number) => Math.round((r * 180) / Math.PI);

/**
 * The 3D switch, with a compass you can drag to turn the map (a click turns
 * it back to north) and sliders for the tilt and the height of the land.
 */
export function View3D({ bus, onChange }: { bus: CameraBus; onChange(patch: Partial<Camera3D>, animate: boolean): void }) {
  const [cam, setCam] = useState(bus.get());
  useEffect(() => bus.subscribe(setCam), [bus]);
  const ring = useRef<HTMLDivElement>(null);
  const drag = useRef<{ a0: number; rot0: number; moved: boolean } | null>(null);
  const angleOf = (e: React.PointerEvent) => {
    const r = ring.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  return (
    <div className={`view3d ${cam.on ? 'is-on' : ''}`}>
      {cam.on && (
        <div className="view3d__sliders">
          <label>
            <span>
              {t('Tilt')} <b>{deg(cam.tilt)}°</b>
            </span>
            <input type="range" min={0} max={deg(MAX_TILT)} step={1} value={deg(cam.tilt)} onChange={(e) => onChange({ tilt: (Number(e.target.value) * Math.PI) / 180 }, false)} />
          </label>
          <label>
            <span>
              {t('Relief')} <b>{Math.round(cam.height * 100)}%</b>
            </span>
            <input type="range" min={0} max={200} step={5} value={Math.round(cam.height * 100)} onChange={(e) => onChange({ height: Number(e.target.value) / 100 }, false)} />
          </label>
        </div>
      )}
      <div className="view3d__row">
        {cam.on && (
          <div
            ref={ring}
            className="compass"
            role="slider"
            aria-label={t('Map rotation')}
            aria-valuemin={-180}
            aria-valuemax={180}
            aria-valuenow={deg(cam.rot)}
            tabIndex={0}
            title={t('Drag to turn the map, click to face north')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') onChange({ rot: wrapAngle(cam.rot - 0.2) }, false);
              else if (e.key === 'ArrowRight') onChange({ rot: wrapAngle(cam.rot + 0.2) }, false);
              else if (e.key === 'Enter' || e.key === ' ') onChange({ rot: 0 }, true);
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { a0: angleOf(e), rot0: cam.rot, moved: false };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const da = wrapAngle(angleOf(e) - d.a0);
              if (Math.abs(da) > 0.04) d.moved = true;
              if (d.moved) onChange({ rot: wrapAngle(d.rot0 - da) }, false);
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (d && !d.moved) onChange({ rot: 0 }, true);
            }}
          >
            <svg viewBox="-30 -30 60 60" aria-hidden>
              <circle r="27" className="compass__ring" />
              {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
                <line key={k} className="compass__tick" x1="0" y1="-27" x2="0" y2={k % 2 ? -24 : -21} transform={`rotate(${k * 45})`} />
              ))}
              <g transform={`rotate(${-deg(cam.rot)})`}>
                <path className="compass__north" d="M0 -20 L5 0 L0 -3 L-5 0 Z" />
                <path className="compass__south" d="M0 20 L5 0 L0 3 L-5 0 Z" />
                <text className="compass__n" y="-21.5" textAnchor="middle" dominantBaseline="auto">
                  N
                </text>
              </g>
            </svg>
          </div>
        )}
        <button className={`view3d__toggle ${cam.on ? 'is-on' : ''}`} aria-pressed={cam.on} onClick={() => onChange({ on: !cam.on }, true)} title={cam.on ? t('Back to the flat map') : t('Tilt the map and raise the land')}>
          3D
        </button>
      </div>
    </div>
  );
}
