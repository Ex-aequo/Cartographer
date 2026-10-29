import { useEffect, useRef, useState } from 'react';
import type { MapData } from '../model/types';
import { REALM_TITLES, newRealmFrom, newRegionFrom } from '../edit/political';
import { BIOME_NAMES, HexFlag, RELIEF_NAMES, TERRAIN_NAMES } from '../model/types';
import { toAxial } from '../model/hex';
import { DEPTH_METRES, ELEVATION_METRES } from '../gen/biomes';
import type { Pick } from './MapView';

interface Props {
  map: MapData;
  pick: Pick;
  onClose(): void;
  onSelectProvince(id: number): void;
  /** set while the Edit tab is open: names, titles and colours become editable */
  onChange?: (label: string, mutate: (map: MapData) => void) => void;
}

export function Inspector({ map, pick, onClose, onSelectProvince, onChange }: Props) {
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
    <aside className="panel panel--inspector" aria-label="Inspector">
      <header className="panel__head">
        <h2>{prov ? prov.name : (f & HexFlag.Lake ? 'Lake' : 'Open water')}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close inspector">
          ×
        </button>
      </header>
      <div className="panel__body">
        {realm && region && prov && (
          <div className="heraldry">
            <span className="shield" style={{ background: rgb }} aria-hidden />
            <div>
              <p className="heraldry__realm">
                {realm.title} of {realm.name}
              </p>
              <p className="muted">
                Region of {region.name}, {map.cultures[realm.culture]?.name} culture
              </p>
            </div>
          </div>
        )}

        {onChange && prov && region && realm && <EditNames map={map} provinceId={prov.id} onChange={onChange} />}

        {prov && (
          <dl className="facts">
            <dt>Terrain</dt>
            <dd>{TERRAIN_NAMES[prov.terrain]}</dd>
            <dt>Size</dt>
            <dd>{prov.hexes.length} hexes</dd>
            <dt>Coast</dt>
            <dd>{prov.coastal ? 'Has a coastline' : 'Landlocked'}</dd>
            <dt>Capital</dt>
            <dd>{realm && realm.capitalProvince === prov.id ? `Seat of ${realm.name}` : region && region.capitalProvince === prov.id ? `Seat of ${region.name}` : 'Provincial town'}</dd>
          </dl>
        )}

        {prov && prov.neighbors.length > 0 && (
          <div className="chips">
            <h3>Borders</h3>
            {prov.neighbors.map((n) => (
              <button key={n} className="chip" onClick={() => onSelectProvince(n)}>
                {map.provinces[n].name}
              </button>
            ))}
            {prov.seaNeighbors.length > 0 && <h3>Across the water</h3>}
            {prov.seaNeighbors.map((n) => (
              <button key={n} className="chip chip--sea" onClick={() => onSelectProvince(n)}>
                {map.provinces[n].name}
              </button>
            ))}
          </div>
        )}

        <h3>
          Hex {col}, {row}
        </h3>
        <dl className="facts facts--hex">
          <dt>Axial</dt>
          <dd>
            q {q}, r {r}
          </dd>
          <dt>{e >= 0 ? 'Elevation' : 'Depth'}</dt>
          <dd>{e >= 0 ? `${Math.round(e * ELEVATION_METRES).toLocaleString()} m` : `${Math.round(-e * DEPTH_METRES).toLocaleString()} m`}</dd>
          <dt>Temperature</dt>
          <dd>{map.hex.temperature[i].toFixed(1)} °C</dd>
          <dt>Rainfall</dt>
          <dd>{Math.round(map.hex.moisture[i] * 100)}%</dd>
          <dt>Biome</dt>
          <dd>{BIOME_NAMES[map.hex.biome[i] as 0]}</dd>
          <dt>Relief</dt>
          <dd>{RELIEF_NAMES[map.hex.relief[i] as 0]}</dd>
          <dt>Terrain</dt>
          <dd>{TERRAIN_NAMES[map.hex.terrain[i] as 0]}</dd>
          {f & HexFlag.River ? (
            <>
              <dt>River</dt>
              <dd>{map.rivers.find((rv) => rv.hexes.includes(i))?.name ?? 'Yes'}</dd>
            </>
          ) : null}
        </dl>
      </div>
    </aside>
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
      <NameField label="Province" value={prov.name} onCommit={(v) => onChange('Rename province', (m) => (m.provinces[prov.id].name = v))} />
      <NameField label="Region" value={region.name} onCommit={(v) => onChange('Rename region', (m) => (m.regions[region.id].name = v))} />
      <NameField label="Realm" value={realm.name} onCommit={(v) => onChange('Rename realm', (m) => (m.realms[realm.id].name = v))} />
      <div className="names__row">
        <label className="field">
          <span>Title</span>
          <select value={realm.title} onChange={(e) => onChange('Change title', (m) => (m.realms[realm.id].title = e.target.value))}>
            {titles.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <ColorField color={realm.color} onCommit={(c) => onChange('Recolour realm', (m) => (m.realms[realm.id].color = c))} />
      </div>
      <div className="names__actions">
        <button type="button" className="btn btn--ghost" disabled={region.provinces.length < 2} onClick={() => onChange(`New region from ${prov.name}`, (m) => newRegionFrom(m, prov.id))}>
          Make {prov.name} a new region
        </button>
        <button type="button" className="btn btn--ghost" disabled={realm.regions.length < 2} onClick={() => onChange(`Independence for ${region.name}`, (m) => newRealmFrom(m, region.id))}>
          Make {region.name} an independent realm
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
      <span>Colour</span>
      <input ref={ref} type="color" />
    </label>
  );
}
