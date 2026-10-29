import { t, num } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { MapData } from '../model/types';
import { REALM_TITLES, newRealmFrom, newRegionFrom } from '../edit/political';
import { BIOME_NAMES, HexFlag, RELIEF_NAMES, TERRAIN_NAMES } from '../model/types';
import { toAxial } from '../model/hex';
import { DEPTH_METRES, ELEVATION_METRES } from '../gen/biomes';
import type { Pick } from './MapView';
import { formatValue, runRules, type DataLayer } from '../model/layers';

interface Props {
  map: MapData;
  pick: Pick;
  onClose(): void;
  onSelectProvince(id: number): void;
  /** set while the Edit tab is open: names, titles and colours become editable */
  onChange?: (label: string, mutate: (map: MapData) => void) => void;
  /** set while the Edit or Data tab is open: layer values become editable */
  onLayerChange?: (label: string, mutate: (map: MapData) => void, kind?: 'instant') => void;
}

export function Inspector({ map, pick, onClose, onSelectProvince, onChange, onLayerChange }: Props) {
  const prov = pick.province >= 0 ? map.provinces[pick.province] : null;
  const region = prov ? map.regions[prov.region] : null;
  const realm = region ? map.realms[region.realm] : null;
  const i = pick.hex;
  const col = i % map.grid.cols;
  const row = Math.floor(i / map.grid.cols);
  const [q, r] = toAxial(col, row);
  const e = map.hex.elevation[i];
  const f = map.hex.flags[i];
  const rgb = realm ? `rgb(${realm.color.join(',')})` : undefined;

  return (
    <aside className="panel panel--inspector" aria-label={t('Inspector')}>
      <header className="panel__head">
        <h2>{prov ? prov.name : t(f & HexFlag.Lake ? 'Lake' : 'Open water')}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={t('Close inspector')}>
          ×
        </button>
      </header>
      <div className="panel__body">
        {realm && region && prov && (
          <div className="heraldry">
            <span className="shield" style={{ background: rgb }} aria-hidden />
            <div>
              <p className="heraldry__realm">
                {t('{title} of {name}', { title: t(realm.title), name: realm.name })}
              </p>
              <p className="muted">
                {t('Region of {region}, {culture} culture', { region: region.name, culture: map.cultures[realm.culture]?.name ?? '' })}
              </p>
            </div>
          </div>
        )}

        {onChange && prov && region && realm && <EditNames map={map} provinceId={prov.id} onChange={onChange} />}

        {prov && (
          <dl className="facts">
            <dt>{t('Terrain')}</dt>
            <dd>{t(TERRAIN_NAMES[prov.terrain])}</dd>
            <dt>{t('Size')}</dt>
            <dd>{t('{n} hexes', { n: num(prov.hexes.length) })}</dd>
            <dt>{t('Coast')}</dt>
            <dd>{t(prov.coastal ? 'Has a coastline' : 'Landlocked')}</dd>
            <dt>{t('Capital')}</dt>
            <dd>{realm && realm.capitalProvince === prov.id ? t('Seat of {name}', { name: realm.name }) : region && region.capitalProvince === prov.id ? t('Seat of {name}', { name: region.name }) : t('Provincial town')}</dd>
          </dl>
        )}

        {prov && prov.neighbors.length > 0 && (
          <div className="chips">
            <h3>{t('Borders')}</h3>
            {prov.neighbors.map((n) => (
              <button key={n} className="chip" onClick={() => onSelectProvince(n)}>
                {map.provinces[n].name}
              </button>
            ))}
            {prov.seaNeighbors.length > 0 && <h3>{t('Across the water')}</h3>}
            {prov.seaNeighbors.map((n) => (
              <button key={n} className="chip chip--sea" onClick={() => onSelectProvince(n)}>
                {map.provinces[n].name}
              </button>
            ))}
          </div>
        )}

        <h3>{t('Hex {col}, {row}', { col, row })}</h3>
        <dl className="facts facts--hex">
          <dt>{t('Axial')}</dt>
          <dd>
            q {q}, r {r}
          </dd>
          <dt>{t(e >= 0 ? 'Elevation' : 'Depth')}</dt>
          <dd>{e >= 0 ? `${num(Math.round(e * ELEVATION_METRES))} m` : `${num(Math.round(-e * DEPTH_METRES))} m`}</dd>
          <dt>{t('Temperature')}</dt>
          <dd>{num(Math.round(map.hex.temperature[i] * 10) / 10)} °C</dd>
          <dt>{t('Rainfall')}</dt>
          <dd>{Math.round(map.hex.moisture[i] * 100)}%</dd>
          <dt>{t('Biome')}</dt>
          <dd>{t(BIOME_NAMES[map.hex.biome[i] as 0])}</dd>
          <dt>{t('Relief')}</dt>
          <dd>{t(RELIEF_NAMES[map.hex.relief[i] as 0])}</dd>
          <dt>{t('Terrain')}</dt>
          <dd>{t(TERRAIN_NAMES[map.hex.terrain[i] as 0])}</dd>
          {f & HexFlag.River ? (
            <>
              <dt>{t('River')}</dt>
              <dd>{map.rivers.find((rv) => rv.hexes.includes(i))?.name ?? t('Yes')}</dd>
            </>
          ) : null}
        </dl>

        {(map.layers ?? []).length > 0 && (
          <>
            <h3>{t('Game data')}</h3>
            <dl className="facts facts--data">
              {map.layers.map((l) => {
                const idx = l.def.scope === 'hex' ? i : pick.province;
                if (idx < 0 || (l.def.scope === 'hex' && !(f & HexFlag.Land))) return null;
                return <LayerValue key={l.def.id} layer={l} idx={idx} onChange={onLayerChange} />;
              })}
            </dl>
          </>
        )}
      </div>
    </aside>
  );
}

function LayerValue({ layer, idx, onChange }: { layer: DataLayer; idx: number; onChange?: Props['onLayerChange'] }) {
  const def = layer.def;
  const v = layer.values[idx];
  const locked = layer.locked[idx] === 1;
  const set = (nv: number | null) =>
    onChange?.(
      t('Set {name}', { name: def.name }),
      (m) => {
        const l = m.layers.find((x) => x.def.id === def.id);
        if (!l) return;
        if (nv === null) {
          l.locked[idx] = 0;
          runRules(m, l);
        } else {
          l.values[idx] = nv;
          l.locked[idx] = 1;
        }
      },
      'instant',
    );
  const label = (
    <dt title={t(def.scope === 'province' ? 'Per province' : 'Per hex')}>
      {def.name}
      {def.scope === 'province' && <small> ({t('province')})</small>}
    </dt>
  );
  const fromRollUp = def.scope === 'province' && !!def.rollUp && !locked;
  if (!onChange)
    return (
      <>
        {label}
        <dd>
          {t(formatValue(def, v))}
          {locked && <span className="painted" title={t('Set by hand')}> ✎</span>}
        </dd>
      </>
    );
  let control: React.ReactNode;
  switch (def.type) {
    case 'category':
      control = (
        <select value={v} onChange={(e) => set(Number(e.target.value))} aria-label={def.name}>
          <option value={-1}>—</option>
          {def.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
      break;
    case 'flag':
      control = (
        <label className="check check--tight">
          <input type="checkbox" checked={v !== 0} onChange={(e) => set(e.target.checked ? 1 : 0)} aria-label={def.name} />
          {t(v ? 'Yes' : 'No')}
        </label>
      );
      break;
    case 'tags':
      control = (
        <span className="chips chips--tight">
          {def.categories.map((c) => {
            const on = ((v >>> 0) & (1 << c.id)) !== 0;
            return (
              <button key={c.id} type="button" className={`chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => set(on ? (v & ~(1 << c.id)) >>> 0 : ((v | (1 << c.id)) >>> 0))}>
                {c.name}
              </button>
            );
          })}
        </span>
      );
      break;
    default:
      control = <NumberValue value={v} decimals={def.decimals} min={def.rollUp ? -Infinity : def.min} max={def.rollUp ? Infinity : def.max} onCommit={(nv) => set(nv)} label={def.name} />;
  }
  return (
    <>
      {label}
      <dd className="layer-value">
        {control}
        {locked ? (
          <button type="button" className="icon-btn" title={t('Set by hand. Click to let the rules decide again.')} aria-label={t('Let the rules decide {name}', { name: def.name })} onClick={() => set(null)}>
            ↺
          </button>
        ) : fromRollUp ? (
          <span className="muted small" title={t("Worked out from the province's hexes")}>
            Σ
          </span>
        ) : null}
      </dd>
    </>
  );
}

function NumberValue({ value, decimals, min, max, onCommit, label }: { value: number; decimals: number; min: number; max: number; onCommit(v: number): void; label: string }) {
  const [draft, setDraft] = useState(value.toFixed(decimals));
  useEffect(() => setDraft(value.toFixed(decimals)), [value, decimals]);
  return (
    <input
      className="num-input"
      inputMode="decimal"
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Number(draft.replace(',', '.'));
        if (Number.isFinite(n) && n.toFixed(decimals) !== value.toFixed(decimals)) onCommit(Math.min(max, Math.max(min, Math.round(n * 10 ** decimals) / 10 ** decimals)));
        else setDraft(value.toFixed(decimals));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const toHex = (c: [number, number, number]) => `#${c.map(hex2).join('')}`;
const fromHex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Names, title, colour, and making new regions and realms (Edit tab only). */
function EditNames({ map, provinceId, onChange }: { map: MapData; provinceId: number; onChange: (label: string, mutate: (m: MapData) => void) => void }) {
  const prov = map.provinces[provinceId];
  const region = map.regions[prov.region];
  const realm = map.realms[region.realm];
  const titles = REALM_TITLES.includes(realm.title) ? REALM_TITLES : [realm.title, ...REALM_TITLES];
  return (
    <div className="names">
      <NameField label={t('Province')} value={prov.name} onCommit={(v) => onChange(t('Rename province'), (m) => (m.provinces[prov.id].name = v))} />
      <NameField label={t('Region')} value={region.name} onCommit={(v) => onChange(t('Rename region'), (m) => (m.regions[region.id].name = v))} />
      <NameField label={t('Realm')} value={realm.name} onCommit={(v) => onChange(t('Rename realm'), (m) => (m.realms[realm.id].name = v))} />
      <div className="names__row">
        <label className="field">
          <span>{t('Title')}</span>
          <select value={realm.title} onChange={(e) => onChange(t('Change title'), (m) => (m.realms[realm.id].title = e.target.value))}>
            {titles.map((x) => (
              <option key={x} value={x}>
                {t(x)}
              </option>
            ))}
          </select>
        </label>
        <ColorField color={realm.color} onCommit={(c) => onChange(t('Recolour realm'), (m) => (m.realms[realm.id].color = c))} />
      </div>
      <div className="names__actions">
        <button type="button" className="btn btn--ghost" disabled={region.provinces.length < 2} onClick={() => onChange(t('New region from {name}', { name: prov.name }), (m) => newRegionFrom(m, prov.id))}>
          {t('Make {name} a new region', { name: prov.name })}
        </button>
        <button type="button" className="btn btn--ghost" disabled={realm.regions.length < 2} onClick={() => onChange(t('Independence for {name}', { name: region.name }), (m) => newRealmFrom(m, region.id))}>
          {t('Make {name} an independent realm', { name: region.name })}
        </button>
      </div>
    </div>
  );
}

function NameField({ label, value, onCommit }: { label: string; value: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
    else setDraft(value);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={draft}
        maxLength={40}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

/** Commits when the colour picker closes (the native "change" event), not while dragging. */
function ColorField({ color, onCommit }: { color: [number, number, number]; onCommit(c: [number, number, number]): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const cb = useRef(onCommit);
  cb.current = onCommit;
  useEffect(() => {
    const el = ref.current!;
    el.value = toHex(color);
    const done = () => {
      const c = fromHex(el.value);
      if (toHex(c) !== toHex(color)) cb.current(c);
    };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [color]);
  return (
    <label className="field names__color">
      <span>{t('Colour')}</span>
      <input ref={ref} type="color" />
    </label>
  );
}
