import { MODES, categoriesFor, modeDef, rampFor, type MapMode } from '../render/mapModes';
import { LEVELS, levelIndexFor } from './zoomLevels';

export function ZoomLadder({ zoom, onLevel, onStep }: { zoom: number; onLevel(i: number): void; onStep(f: number): void }) {
  const active = levelIndexFor(zoom);
  return (
    <nav className="ladder" aria-label="Zoom level">
      <button className="ladder__step" onClick={() => onStep(1.5)} aria-label="Zoom in">
        +
      </button>
      <ol>
        {LEVELS.slice()
          .reverse()
          .map((l) => {
            const i = LEVELS.indexOf(l);
            return (
              <li key={l.key}>
                <button className={i === active ? 'is-on' : ''} onClick={() => onLevel(i)} title={l.hint} aria-current={i === active ? 'true' : undefined}>
                  <span className="ladder__tick" aria-hidden />
                  {l.name}
                </button>
              </li>
            );
          })}
      </ol>
      <button className="ladder__step" onClick={() => onStep(1 / 1.5)} aria-label="Zoom out">
        −
      </button>
    </nav>
  );
}

export function ModeSwitch({ mode, onMode }: { mode: MapMode; onMode(m: MapMode): void }) {
  const art = MODES.filter((m) => m.kind === 'art');
  const data = MODES.filter((m) => m.kind === 'data');
  const btn = (m: (typeof MODES)[number]) => (
    <button key={m.key} role="radio" aria-checked={mode === m.key} className={mode === m.key ? 'is-on' : ''} onClick={() => onMode(m.key)}>
      {m.label}
    </button>
  );
  return (
    <div className="modes" role="radiogroup" aria-label="Map mode">
      {art.map(btn)}
      <span className="modes__sep" aria-hidden />
      {data.map(btn)}
    </div>
  );
}

export function Legend({ mode, present }: { mode: MapMode; present?: Set<number> }) {
  const ramp = rampFor(mode);
  const cats = categoriesFor(mode);
  if (!ramp && !cats) return null;
  if (ramp) {
    const lo = ramp.stops[0];
    const hi = ramp.stops[ramp.stops.length - 1];
    const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
    const gradient = ramp.stops.map((v, i) => `rgb(${ramp.colors[i].join(',')}) ${pct(v)}%`).join(', ');
    return (
      <div className="legend" aria-label={`${modeDef(mode).label} legend`}>
        <div className="legend__bar" style={{ background: `linear-gradient(to right, ${gradient})` }} />
        <div className="legend__ticks">
          {ramp.ticks.map((t) => (
            <span key={t.label} style={{ left: `${pct(t.at)}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
    );
  }
  const shown = cats!.filter((c) => !present || present.has(c.code));
  return (
    <div className="legend legend--cats" aria-label={`${modeDef(mode).label} legend`}>
      {shown.map((c) => (
        <span key={c.code} className="legend__cat">
          <i style={{ background: `rgb(${c.color.join(',')})` }} />
          {c.name}
        </span>
      ))}
    </div>
  );
}

export function Veil({ step, fraction }: { step: string; fraction: number }) {
  return (
    <div className="veil" role="status" aria-live="polite">
      <div className="veil__card">
        <p className="veil__step">{step}</p>
        <div className="veil__bar">
          <span style={{ transform: `scaleX(${Math.max(0.04, fraction)})` }} />
        </div>
      </div>
    </div>
  );
}
