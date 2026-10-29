import { useState } from 'react';
import type { GenParams, Template } from '../model/types';
import { randomSeedWord } from '../util/rng';

const SIZES = [
  { label: 'Small', cols: 200, rows: 126 },
  { label: 'Medium', cols: 300, rows: 190 },
  { label: 'Large', cols: 420, rows: 264 },
];

const SHAPES: { value: Template; label: string }[] = [
  { value: 'continents', label: 'Continents' },
  { value: 'pangaea', label: 'One great landmass' },
  { value: 'archipelago', label: 'Archipelago' },
  { value: 'inland-sea', label: 'Inland sea' },
];

const CLIMATES = [
  { label: 'Cold north, warm south', north: -14, south: 31 },
  { label: 'Arctic to temperate', north: -26, south: 18 },
  { label: 'Temperate to tropical', north: 2, south: 34 },
  { label: 'Warm south, cold north', north: 31, south: -14 },
];

interface Props {
  params: GenParams;
  onChange(p: GenParams): void;
  onGenerate(p: GenParams): void;
  busy: boolean;
}

export function WorldPanel({ params, onChange, onGenerate, busy }: Props) {
  const [open, setOpen] = useState(true);
  const set = <K extends keyof GenParams>(k: K, v: GenParams[K]) => onChange({ ...params, [k]: v });
  const sizeIdx = SIZES.findIndex((s) => s.cols === params.cols);
  const climateIdx = CLIMATES.findIndex((c) => c.north === params.tempNorth && c.south === params.tempSouth);

  return (
    <section className={`panel panel--world ${open ? '' : 'panel--closed'}`} aria-label="New world">
      <header className="panel__head">
        <h2>New world</h2>
        <button className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Collapse panel' : 'Expand panel'}>
          {open ? '−' : '+'}
        </button>
      </header>
      {open && (
        <form
          className="panel__body"
          onSubmit={(e) => {
            e.preventDefault();
            onGenerate(params);
          }}
        >
          <label className="field">
            <span>Seed</span>
            <div className="field__row">
              <input value={params.seed} onChange={(e) => set('seed', e.target.value)} spellCheck={false} />
              <button type="button" className="btn btn--ghost" onClick={() => set('seed', randomSeedWord())} title="New random seed">
                Reroll
              </button>
            </div>
          </label>

          <fieldset className="field">
            <legend>Size</legend>
            <div className="seg">
              {SIZES.map((s, i) => (
                <button type="button" key={s.label} className={i === sizeIdx ? 'is-on' : ''} onClick={() => onChange({ ...params, cols: s.cols, rows: s.rows })}>
                  {s.label}
                  <small>{Math.round((s.cols * s.rows) / 1000)}k hexes</small>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>Shape of the land</span>
            <select value={params.template} onChange={(e) => set('template', e.target.value as Template)}>
              {SHAPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <Slider label="Land" value={params.landFraction} min={0.2} max={0.65} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('landFraction', v)} />
          <Slider label="Mountains" value={params.mountains} min={0} max={1} step={0.05} format={(v) => (v < 0.3 ? 'Gentle' : v < 0.7 ? 'Rugged' : 'Towering')} onChange={(v) => set('mountains', v)} />
          <Slider label="Valleys" value={params.erosion} min={0} max={1} step={0.05} format={(v) => (v < 0.2 ? 'Raw' : v < 0.7 ? 'Weathered' : 'Deeply carved')} onChange={(v) => set('erosion', v)} />
          <Slider label="Rainfall" value={params.rainfall} min={0.5} max={1.5} step={0.05} format={(v) => (v < 0.8 ? 'Arid' : v < 1.2 ? 'Moderate' : 'Wet')} onChange={(v) => set('rainfall', v)} />

          <label className="field">
            <span>Climate</span>
            <select
              value={climateIdx}
              onChange={(e) => {
                const c = CLIMATES[Number(e.target.value)];
                onChange({ ...params, tempNorth: c.north, tempSouth: c.south });
              }}
            >
              {climateIdx < 0 && <option value={-1}>Custom</option>}
              {CLIMATES.map((c, i) => (
                <option key={c.label} value={i}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          <Slider label="Province size" value={params.provinceSize} min={12} max={80} step={1} format={(v) => `${v} hexes`} onChange={(v) => set('provinceSize', v)} />
          <Slider label="Realms" value={params.realmCount} min={3} max={80} step={1} format={(v) => String(v)} onChange={(v) => set('realmCount', v)} />

          <button type="submit" className="btn btn--seal" disabled={busy}>
            {busy ? 'Drawing…' : 'Draw this world'}
          </button>
        </form>
      )}
    </section>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; format(v: number): string; onChange(v: number): void }) {
  return (
    <label className="field">
      <span className="field__label">
        {props.label}
        <output>{props.format(props.value)}</output>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  );
}
