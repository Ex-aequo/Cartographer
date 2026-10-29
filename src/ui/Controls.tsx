import type { MapMode } from '../render/MapRenderer';
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
  const modes: { key: MapMode; label: string }[] = [
    { key: 'political', label: 'Political' },
    { key: 'terrain', label: 'Terrain' },
  ];
  return (
    <div className="modes" role="radiogroup" aria-label="Map mode">
      {modes.map((m) => (
        <button key={m.key} role="radio" aria-checked={mode === m.key} className={mode === m.key ? 'is-on' : ''} onClick={() => onMode(m.key)}>
          {m.label}
        </button>
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
