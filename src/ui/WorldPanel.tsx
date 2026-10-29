import { useState } from 'react';
import type React from 'react';
import type { GenParams, MapData, Template } from '../model/types';
import { RacesSection } from './RacesSection';
import { racesOrPresets } from '../model/races';
import { randomSeedWord } from '../util/rng';
import { LANGS, setLang, t, useLang, type Lang } from '../i18n';

export const SIZES = [
  { label: 'Small', cols: 200, rows: 126 },
  { label: 'Medium', cols: 300, rows: 190 },
  { label: 'Large', cols: 420, rows: 264 },
];

export const SHAPES: { value: Template; label: string }[] = [
  { value: 'continents', label: 'Continents' },
  { value: 'pangaea', label: 'One great landmass' },
  { value: 'archipelago', label: 'Archipelago' },
  { value: 'inland-sea', label: 'Inland sea' },
];

export const CLIMATES = [
  { label: 'Cold north, warm south', north: -14, south: 31 },
  { label: 'Arctic to temperate', north: -26, south: 18 },
  { label: 'Temperate to tropical', north: 2, south: 34 },
  { label: 'Warm south, cold north', north: 31, south: -14 },
];

export type PanelTab = 'world' | 'edit' | 'data' | 'symbols';

export const TABS: { key: PanelTab; label: string }[] = [
  { key: 'world', label: 'New world' },
  { key: 'edit', label: 'Edit' },
  { key: 'data', label: 'Data' },
  { key: 'symbols', label: 'Symbols' },
];

interface PanelProps {
  tab: PanelTab;
  onTab(t: PanelTab): void;
  children: React.ReactNode;
}

/** The left panel: drawing a new world, editing this one, or its game data. */
export function SidePanel({ tab, onTab, children }: PanelProps) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`panel panel--world ${open ? '' : 'panel--closed'}`} aria-label={t(TABS.find((x) => x.key === tab)?.label ?? '')}>
      <header className="panel__head">
        <div className="tabs" role="tablist">
          {TABS.map((x) => (
            <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'is-on' : ''} onClick={() => (onTab(x.key), setOpen(true))}>
              {t(x.label)}
            </button>
          ))}
        </div>
        <LanguagePicker />
        <button className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? t('Collapse panel') : t('Expand panel')}>
          {open ? '−' : '+'}
        </button>
      </header>
      {open && children}
    </section>
  );
}

interface Props {
  params: GenParams;
  onChange(p: GenParams): void;
  onGenerate(p: GenParams): void;
  busy: boolean;
  /** this world has hand edits that drawing a new one would throw away */
  hasEdits: boolean;
  map: MapData | null;
  onFit(): void;
  working: boolean;
  onDownload(blob: Blob, name: string): void;
  notify(msg: string): void;
}

export function WorldPanel({ params, onChange, onGenerate, busy, hasEdits, map, onFit, working, onDownload, notify }: Props) {
  const set = <K extends keyof GenParams>(k: K, v: GenParams[K]) => onChange({ ...params, [k]: v });
  const sizeIdx = SIZES.findIndex((s) => s.cols === params.cols);
  const climateIdx = CLIMATES.findIndex((c) => c.north === params.tempNorth && c.south === params.tempSouth);

  return (
        <form
          className="panel__body"
          onSubmit={(e) => {
            e.preventDefault();
            onGenerate(params);
          }}
        >
          <label className="field">
            <span>{t('Seed')}</span>
            <div className="field__row">
              <input value={params.seed} onChange={(e) => set('seed', e.target.value)} spellCheck={false} />
              <button type="button" className="btn btn--ghost" onClick={() => set('seed', randomSeedWord())} title={t('New random seed')}>
                {t('Reroll')}
              </button>
            </div>
          </label>

          <fieldset className="field">
            <legend>{t('Size')}</legend>
            <div className="seg">
              {SIZES.map((s, i) => (
                <button type="button" key={s.label} className={i === sizeIdx ? 'is-on' : ''} onClick={() => onChange({ ...params, cols: s.cols, rows: s.rows })}>
                  {t(s.label)}
                  <small>{t('{n}k hexes', { n: Math.round((s.cols * s.rows) / 1000) })}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>{t('Shape of the land')}</span>
            <select value={params.template} onChange={(e) => set('template', e.target.value as Template)}>
              {SHAPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.label)}
                </option>
              ))}
            </select>
          </label>

          <Slider label={t('Land')} value={params.landFraction} min={0.2} max={0.65} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('landFraction', v)} />
          <Slider label={t('Mountains')} value={params.mountains} min={0} max={1} step={0.05} format={(v) => t(v < 0.3 ? 'Gentle' : v < 0.7 ? 'Rugged' : 'Towering')} onChange={(v) => set('mountains', v)} />
          <Slider label={t('Valleys')} value={params.erosion} min={0} max={1} step={0.05} format={(v) => t(v < 0.2 ? 'Raw' : v < 0.7 ? 'Weathered' : 'Deeply carved')} onChange={(v) => set('erosion', v)} />
          <Slider label={t('Rainfall')} value={params.rainfall} min={0.5} max={1.5} step={0.05} format={(v) => t(v < 0.8 ? 'Arid' : v < 1.2 ? 'Moderate' : 'Wet')} onChange={(v) => set('rainfall', v)} />

          <label className="field">
            <span>{t('Climate')}</span>
            <select
              value={climateIdx}
              onChange={(e) => {
                const c = CLIMATES[Number(e.target.value)];
                onChange({ ...params, tempNorth: c.north, tempSouth: c.south });
              }}
            >
              {climateIdx < 0 && <option value={-1}>{t('Custom')}</option>}
              {CLIMATES.map((c, i) => (
                <option key={c.label} value={i}>
                  {t(c.label)}
                </option>
              ))}
            </select>
          </label>

          <Slider label={t('Province size')} value={params.provinceSize} min={12} max={80} step={1} format={(v) => t('{n} hexes', { n: v })} onChange={(v) => set('provinceSize', v)} />
          <Slider label={t('Realms')} value={params.realmCount} min={3} max={80} step={1} format={(v) => String(v)} onChange={(v) => set('realmCount', v)} />

          <RacesSection races={racesOrPresets(params.races)} realmCount={params.realmCount} onChange={(races) => set('races', races)} map={map} onFit={onFit} working={working} onDownload={onDownload} notify={notify} />

          {hasEdits && <p className="warn">{t('Drawing a new world replaces this one, including your edits. Save first to keep them.')}</p>}
          <button type="submit" className="btn btn--seal btn--sticky" disabled={busy}>
            {t(busy ? 'Drawing…' : hasEdits ? 'Discard edits and draw' : 'Draw this world')}
          </button>
        </form>
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

/** Language choice, shown as flags in the panel header. */
function LanguagePicker() {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const pick = (l: Lang) => {
    setLang(l);
    setOpen(false);
  };
  return (
    <div className="lang" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button type="button" className="lang__btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={t('Language')} title={t('Language')}>
        <Flag lang={lang} />
      </button>
      {open && (
        <div className="lang__menu" role="menu">
          {LANGS.map((l) => (
            <button key={l.key} type="button" role="menuitemradio" aria-checked={l.key === lang} className={l.key === lang ? 'is-on' : ''} onClick={() => pick(l.key)}>
              <Flag lang={l.key} />
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Flag({ lang }: { lang: Lang }) {
  if (lang === 'pt')
    return (
      <svg className="flag" viewBox="0 0 30 20" aria-hidden>
        <rect width="12" height="20" fill="#046a38" />
        <rect x="12" width="18" height="20" fill="#da291c" />
        <circle cx="12" cy="10" r="4.6" fill="none" stroke="#ffe900" strokeWidth="1.3" />
        <path d="M10 7.2h4v4.2a2 2 0 0 1-4 0z" fill="#fff" stroke="#da291c" strokeWidth="0.7" />
        <circle cx="12" cy="9.6" r="0.7" fill="#002d72" />
      </svg>
    );
  return (
    <svg className="flag" viewBox="0 0 60 40" aria-hidden>
      <clipPath id="uk-clip">
        <path d="M0 0h60v40H0z" />
      </clipPath>
      <g clipPath="url(#uk-clip)">
        <path d="M0 0h60v40H0z" fill="#012169" />
        <path d="M0 0l60 40M60 0L0 40" stroke="#fff" strokeWidth="8" />
        <path d="M0 0l60 40M60 0L0 40" stroke="#c8102e" strokeWidth="3" />
        <path d="M30 0v40M0 20h60" stroke="#fff" strokeWidth="12" />
        <path d="M30 0v40M0 20h60" stroke="#c8102e" strokeWidth="7" />
      </g>
    </svg>
  );
}
