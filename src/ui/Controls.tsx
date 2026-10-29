import { t } from '../i18n';
import { MODES, categoriesFor, isLayerMode, modeDef, rampFor, type MapMode } from '../render/mapModes';
import { formatValue, numberRange, type DataLayer } from '../model/layers';
import { LEVELS, levelIndexFor } from './zoomLevels';

export function ZoomLadder({ zoom, onLevel, onStep }: { zoom: number; onLevel(i: number): void; onStep(f: number): void }) {
  const active = levelIndexFor(zoom);
  return (
    <nav className="ladder" aria-label={t('Zoom level')}>
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
