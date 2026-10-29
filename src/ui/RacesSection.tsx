import { useRef, useState } from 'react';
import { TERRAIN_NAMES, type MapData, type Terrain } from '../model/types';
import { NAME_STYLES } from '../gen/names';
import { INK_ASSETS } from '../symbols/inkSet';
import { RACE_TERRAINS, kingdomCounts, newRace, presetById, raceReport, raceTemplate, readRaceTemplate, type CoastPref, type RaceBias, type RaceDef, type RaceSize } from '../model/races';
import { ColorInput, NumField, TextField, hex } from './fields';
import { t, tn } from '../i18n';

/** Display names for the name styles a race can use. */
export const STYLE_NAMES: Record<string, string> = {
  auto: 'World cultures',
  north: 'Northern',
  latin: 'Latin',
  wyld: 'Celtic',
  steppe: 'Steppe',
  dune: 'Desert',
  isle: 'Island',
  east: 'Eastern',
  dwarf: 'Dwarvish',
  elf: 'Elvish',
  auroch: 'Auroch',
  orc: 'Orcish',
  lizard: 'Lizardfolk',
};

export const SIZE_NAMES: Record<RaceSize, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
export const COAST_NAMES: Record<CoastPref, string> = { any: 'Coast or inland', coastal: 'By the sea', inland: 'Inland' };

interface Props {
  races: RaceDef[];
  realmCount: number;
  onChange(races: RaceDef[]): void;
  /** the world on screen, for the kingdom check */
  map: MapData | null;
  onFit(): void;
  working: boolean;
  onDownload(blob: Blob, name: string): void;
  notify(msg: string): void;
}

const summary = (r: RaceDef) =>
  r.biases
    .filter((b) => b.terrains.length)
    .map((b) => `${b.op === 'min' ? '≥' : '≤'} ${b.pct}% ${b.terrains.map((x) => t(TERRAIN_NAMES[x as Terrain])).join(' / ')}`)
    .join(' · ') || t('No terrain bias');

/** The Races part of the World tab: which peoples live in this world, and where. */
export function RacesSection(p: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = (id: string, patch: Partial<RaceDef>) => p.onChange(p.races.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const active = p.races.filter((r) => r.enabled);
  const counts = kingdomCounts(active, p.realmCount);
  const asked = active.reduce((a, r) => a + Math.max(1, r.count.mode === 'number' ? Math.round(r.count.value) : Math.round((r.count.value / 100) * p.realmCount)), 0);
  const report = p.map ? raceReport(p.map) : [];
  const drawnWith = JSON.stringify((p.map?.meta.params.races ?? []).filter((r) => r.enabled));
  const pending = p.map && drawnWith !== JSON.stringify(active);

  return (
    <fieldset className="field races">
      <legend>{t('Races')}</legend>
      <p className="hint">{t('Tick the peoples of this world. Each race founds its kingdoms on the land it favours and grows toward it.')}</p>
      <ul className="race-list">
        {p.races.map((r) => (
          <li key={r.id} className={r.enabled ? 'is-on' : ''}>
            <div className="race-row">
              <input type="checkbox" checked={r.enabled} onChange={(e) => set(r.id, { enabled: e.target.checked })} aria-label={t('{name} in this world', { name: r.name })} />
              <i className="dot" style={{ background: hex(r.color) }} />
              <button type="button" className="race-row__name" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span>{r.name}</span>
                <small>{summary(r)}</small>
              </button>
              {r.enabled && <span className="race-row__count">{tn('{n} kingdom', '{n} kingdoms', counts.get(r.id) ?? 0)}</span>}
            </div>
            {open === r.id && <RaceEditor race={r} onChange={(patch) => set(r.id, patch)} onRemove={() => (p.onChange(p.races.filter((x) => x.id !== r.id)), setOpen(null))} />}
          </li>
        ))}
      </ul>
      {asked > p.realmCount && <p className="warn">{t('The races ask for {a} kingdoms but the world has {b} realms; their counts are scaled down.', { a: asked, b: p.realmCount })}</p>}
      <div className="history">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            const r = newRace(p.races, t('New race'));
            p.onChange([...p.races, r]);
            setOpen(r.id);
          }}
        >
          {t('+ New race')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => p.onDownload(new Blob([raceTemplate(p.races)], { type: 'application/json' }), 'races.template.json')}>
          {t('Save races')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => file.current?.click()}>
          {t('Load races')}
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            p.onChange(readRaceTemplate(await f.text()));
          } catch {
            p.notify(t('That file is not a Cartographer race set.'));
          }
        }}
      />

      {report.length > 0 && (
        <div className="race-report">
          <span className="field__label">{t('Kingdoms in this world')}</span>
          {pending && <p className="muted small">{t('Race changes take effect when you draw the world.')}</p>}
          <ul>
            {report.map((f) => (
              <li key={f.realm} className={f.ok ? 'ok' : 'miss'}>
                <i className="dot" style={{ background: hex(f.race.color) }} />
                <span className="race-report__name">{p.map!.realms[f.realm].name}</span>
                <span className="race-report__res">
                  {f.results.map((r, k) => (
                    <span key={k} title={r.bias.terrains.map((x) => t(TERRAIN_NAMES[x as Terrain])).join(', ')}>
                      {Math.round(r.share * 100)}%{r.ok ? ' ✓' : ' ✗'}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--ghost btn--wide" disabled={p.working || report.every((f) => f.ok)} onClick={p.onFit} title={t('Trade border provinces so every race kingdom meets its targets; races allowed to change the land get their terrain painted where borders are not enough.')}>
            {report.every((f) => f.ok) ? t('Every kingdom meets its targets') : t('Fit borders ({n} short)', { n: report.filter((f) => !f.ok).length })}
          </button>
        </div>
      )}
    </fieldset>
  );
}

function RaceEditor({ race, onChange, onRemove }: { race: RaceDef; onChange(p: Partial<RaceDef>): void; onRemove(): void }) {
  const setBias = (k: number, patch: Partial<RaceBias>) => onChange({ biases: race.biases.map((b, i) => (i === k ? { ...b, ...patch } : b)) });
  return (
    <div className="race-edit">
      <div className="field__row">
        <label className="field">
          <span>{t('Name')}</span>
          <TextField value={race.name} onCommit={(v) => v && onChange({ name: v })} />
        </label>
        <label className="field field--color">
          <span>{t('Colour')}</span>
          <ColorInput color={race.color} onCommit={(c) => onChange({ color: c })} label={t('Colour of {name}', { name: race.name })} />
        </label>
      </div>

      <span className="field__label">{t('Homeland')}</span>
      {race.biases.map((b, k) => (
        <div key={k} className="bias">
          <div className="bias__head">
            <select value={b.op} onChange={(e) => setBias(k, { op: e.target.value as RaceBias['op'] })} aria-label={t('At least or at most')}>
              <option value="min">{t('At least')}</option>
              <option value="max">{t('At most')}</option>
            </select>
            <NumField value={b.pct} suffix="%" onCommit={(v) => setBias(k, { pct: Math.max(0, Math.min(100, Math.round(v))) })} aria-label={t('Percent of the kingdom')} />
            <span className="muted small">{t('of the kingdom is')}</span>
            <button type="button" className="icon-btn" aria-label={t('Remove this line')} onClick={() => onChange({ biases: race.biases.filter((_, i) => i !== k) })}>
              ×
            </button>
          </div>
          <div className="chips chips--tight">
            {RACE_TERRAINS.map((tr) => {
              const on = b.terrains.includes(tr);
              return (
                <button key={tr} type="button" className={`chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => setBias(k, { terrains: on ? b.terrains.filter((x) => x !== tr) : [...b.terrains, tr] })}>
                  {t(TERRAIN_NAMES[tr as Terrain])}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button type="button" className="btn btn--ghost btn--small" onClick={() => onChange({ biases: [...race.biases, { terrains: [], op: 'min', pct: 30 }] })}>
        {t('+ Add terrain line')}
      </button>

      <div className="field__row">
        <label className="field">
          <span>{t('Climate from')}</span>
          <NumField value={race.tempMin} suffix="°C" onCommit={(v) => onChange({ tempMin: Math.min(v, race.tempMax) })} />
        </label>
        <label className="field">
          <span>{t('to')}</span>
          <NumField value={race.tempMax} suffix="°C" onCommit={(v) => onChange({ tempMax: Math.max(v, race.tempMin) })} />
        </label>
      </div>
      <div className="field__row">
        <label className="field">
          <span>{t('Coast')}</span>
          <select value={race.coast} onChange={(e) => onChange({ coast: e.target.value as CoastPref })}>
            {(Object.keys(COAST_NAMES) as CoastPref[]).map((c) => (
              <option key={c} value={c}>
                {t(COAST_NAMES[c])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Kingdom size')}</span>
          <select value={race.size} onChange={(e) => onChange({ size: e.target.value as RaceSize })}>
            {(Object.keys(SIZE_NAMES) as RaceSize[]).map((c) => (
              <option key={c} value={c}>
                {t(SIZE_NAMES[c])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field__row">
        <label className="field">
          <span>{t('Kingdoms')}</span>
          <NumField value={race.count.value} suffix={race.count.mode === 'share' ? '%' : ''} onCommit={(v) => onChange({ count: { ...race.count, value: Math.max(1, Math.round(v)) } })} />
        </label>
        <label className="field">
          <span>{t('Counted as')}</span>
          <select value={race.count.mode} onChange={(e) => onChange({ count: { mode: e.target.value as 'number' | 'share', value: e.target.value === 'share' ? 20 : 2 } })}>
            <option value="number">{t('A number of kingdoms')}</option>
            <option value="share">{t('A share of all realms')}</option>
          </select>
        </label>
      </div>
      <div className="field__row">
        <label className="field">
          <span>{t('Names')}</span>
          <select value={race.names} onChange={(e) => onChange({ names: e.target.value })}>
            <option value="auto">{t(STYLE_NAMES.auto)}</option>
            {NAME_STYLES.map((s) => (
              <option key={s.key} value={s.key}>
                {t(STYLE_NAMES[s.key] ?? s.key)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('Town mark')}</span>
          <select value={race.townMark} onChange={(e) => onChange({ townMark: e.target.value })}>
            <option value="">{t('Standard keep')}</option>
            {INK_ASSETS.map((a) => (
              <option key={a.id} value={a.id}>
                {t(a.name)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={race.terraform} onChange={(e) => onChange({ terraform: e.target.checked })} />
        {t('Fit may change the land of these kingdoms when borders are not enough')}
      </label>
      <div className="history">
        {race.preset && presetById(race.preset) && (
          <button type="button" className="btn btn--ghost" onClick={() => onChange({ ...presetById(race.preset!)!, name: t(presetById(race.preset!)!.name), enabled: race.enabled })}>
            {t('Reset')}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--danger" onClick={onRemove}>
          {t('Remove race')}
        </button>
      </div>
    </div>
  );
}
