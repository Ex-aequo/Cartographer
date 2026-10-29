import type { MapData } from '../model/types';
import { BIOME_NAMES, HexFlag, RELIEF_NAMES, TERRAIN_NAMES } from '../model/types';
import { toAxial } from '../model/hex';
import { DEPTH_METRES, ELEVATION_METRES } from '../gen/biomes';
import type { Pick } from './MapView';

interface Props {
  map: MapData;
  pick: Pick;
  onClose(): void;
  onSelectProvince(id: number): void;
}

export function Inspector({ map, pick, onClose, onSelectProvince }: Props) {
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
