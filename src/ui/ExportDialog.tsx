import { useEffect, useRef, useState } from 'react';
import type { MapData } from '../model/types';
import type { RenderAssets } from '../render/assets';
import type { MapMode } from '../render/mapModes';
import { modeDef } from '../render/mapModes';
import type { DataLayer } from '../model/layers';
import { LOOKS, WIDTHS, highResSize, renderHighRes, sharpnessFor, type LookKey } from '../export/highres';
import { runExport, type ExportPart } from '../export/request';
import { zip } from '../util/zip';

export type DialogPart = 'image' | ExportPart;

const PARTS: { key: DialogPart; name: string; files: string }[] = [
  { key: 'image', name: 'Map image', files: 'map.png' },
  { key: 'provinces', name: 'Province map', files: 'provinces.png, definition.csv (one colour per province and sea zone)' },
  { key: 'heightmap', name: 'Heightmaps', files: 'heightmap.png (16-bit), heightmap_8bit.png' },
  { key: 'terrain', name: 'Terrain, water and river masks', files: 'terrain.png, water.png, rivers.png, masks/*.png' },
  { key: 'tables', name: 'Tables', files: 'csv/hexes, provinces, regions, realms, sea_zones; layers/*.csv' },
  { key: 'gamedata', name: 'Game data', files: 'gamedata.json' },
];

interface Props {
  map: MapData;
  assets: RenderAssets;
  mode: MapMode;
  modeLabel: string;
  layer: { colors: Uint8Array; badges: DataLayer | null } | null;
  initial: DialogPart[];
  fileBase: string;
  onClose(): void;
  onDownload(blob: Blob, name: string): void;
}

export function ExportDialog(p: Props) {
  const [parts, setParts] = useState<Set<DialogPart>>(new Set(p.initial));
  const [look, setLook] = useState<LookKey>('world');
  const [width, setWidth] = useState(8192);
  const [provWidth, setProvWidth] = useState(4096);
  const [smooth, setSmooth] = useState(false);
  const [rasterWidth, setRasterWidth] = useState(2048);
  const [busy, setBusy] = useState<{ label: string; f: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, p]);

  const toggle = (k: DialogPart) => setParts((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const img = highResSize(p.map, width);
  const sharp = sharpnessFor(p.map, width, look);
  const provH = Math.round((provWidth * p.map.world.height) / p.map.world.width);
  const rasH = Math.round((rasterWidth * p.map.world.height) / p.map.world.width);

  const go = async () => {
    setError(null);
    const list = PARTS.filter((x) => parts.has(x.key)).map((x) => x.key);
    if (!list.length) return;
    const files: { name: string; data: Uint8Array }[] = [];
    const workerParts = list.filter((k): k is ExportPart => k !== 'image');
    const share = list.includes('image') ? (workerParts.length ? 0.6 : 1) : 0;
    try {
      if (list.includes('image')) {
        setBusy({ label: 'Painting the map', f: 0 });
        const blob = await renderHighRes(p.map, p.assets, { width, look, mode: p.mode, layer: p.layer }, (label, f) => setBusy({ label, f: f * share }));
        files.push({ name: 'map.png', data: new Uint8Array(await blob.arrayBuffer()) });
      }
      if (workerParts.length) {
        const got = await runExport({ map: p.map, parts: workerParts, provinceWidth: provWidth, smooth, rasterWidth }, (label, f) => setBusy({ label, f: share + f * (1 - share) }));
        files.push(...got);
      }
      setBusy({ label: 'Packing', f: 1 });
      if (files.length === 1) {
        const f = files[0];
        p.onDownload(new Blob([f.data as BlobPart], { type: f.name.endsWith('.png') ? 'image/png' : f.name.endsWith('.json') ? 'application/json' : 'text/csv' }), `${p.fileBase}-${f.name}`);
      } else {
        files.push({ name: 'README.txt', data: new TextEncoder().encode(readme(p.map, list, { width, look, provWidth, smooth, rasterWidth, mode: p.modeLabel })) });
        p.onDownload(new Blob([zip(files) as BlobPart], { type: 'application/zip' }), `${p.fileBase}-export.zip`);
      }
      p.onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && p.onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header className="panel__head">
          <h2 id="export-title">Export</h2>
          <button className="icon-btn" onClick={p.onClose} aria-label="Close" disabled={!!busy}>
            ×
          </button>
        </header>
        <div className="dialog__body">
          <p className="muted">Choose what to export. One part downloads as a single file; several come together in a zip with a README.</p>
          {PARTS.map((x, i) => (
            <div key={x.key} className={`export-part ${parts.has(x.key) ? 'is-on' : ''}`}>
              <label className="check">
                <input ref={i === 0 ? first : undefined} type="checkbox" checked={parts.has(x.key)} onChange={() => toggle(x.key)} />
                <span>
                  <strong>{x.name}</strong>
                  <small>{x.files}</small>
                </span>
              </label>
              {x.key === 'image' && parts.has('image') && (
                <div className="export-opts">
                  <label className="field">
                    <span>Style</span>
                    <select value={look} onChange={(e) => setLook(e.target.value as LookKey)}>
                      {LOOKS.map((l) => (
                        <option key={l.key} value={l.key}>
                          {l.name} — {l.hint}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Size</span>
                    <select value={width} onChange={(e) => setWidth(Number(e.target.value))}>
                      {WIDTHS.map((w) => (
                        <option key={w} value={w}>
                          {w.toLocaleString()} × {highResSize(p.map, w).height.toLocaleString()} px
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted small">
                    Map mode: {p.modeLabel}. {sharp < 1 ? `At this size the ${LOOKS.find((l) => l.key === look)!.name.toLowerCase()} is softer than on screen; pick a larger size for full detail.` : `${sharp.toFixed(1)}× the detail of your screen.`}
                    {img.width * img.height > 120e6 ? ' Very large: this needs a lot of memory and may take a minute.' : ''}
                  </p>
                </div>
              )}
              {x.key === 'provinces' && parts.has('provinces') && (
                <div className="export-opts">
                  <label className="field">
                    <span>Size</span>
                    <select value={provWidth} onChange={(e) => setProvWidth(Number(e.target.value))}>
                      {[2048, 4096, 8192].map((w) => (
                        <option key={w} value={w}>
                          {w.toLocaleString()} × {Math.round((w * p.map.world.height) / p.map.world.width).toLocaleString()} px
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Borders</span>
                    <select value={smooth ? 'smooth' : 'hex'} onChange={(e) => setSmooth(e.target.value === 'smooth')}>
                      <option value="hex">Along hex edges (exact game data)</option>
                      <option value="smooth">As drawn on the map (curved)</option>
                    </select>
                  </label>
                  <p className="muted small">
                    {provWidth.toLocaleString()} × {provH.toLocaleString()} px. Sea and lakes are split into sea zones with their own colours.
                  </p>
                </div>
              )}
            </div>
          ))}
          {(parts.has('heightmap') || parts.has('terrain')) && (
            <label className="field export-raster">
              <span>Heightmap and mask size</span>
              <select value={rasterWidth} onChange={(e) => setRasterWidth(Number(e.target.value))}>
                {[1024, 2048, 4096, 8192].map((w) => (
                  <option key={w} value={w}>
                    {w.toLocaleString()} × {Math.round((w * p.map.world.height) / p.map.world.width).toLocaleString()} px
                  </option>
                ))}
              </select>
              <small className="muted">
                {rasterWidth.toLocaleString()} × {rasH.toLocaleString()} px
              </small>
            </label>
          )}
          {error && (
            <p className="dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="dialog__foot">
          {busy ? (
            <div className="dialog__progress" role="status" aria-live="polite">
              <span>{busy.label}…</span>
              <div className="veil__bar">
                <span style={{ transform: `scaleX(${Math.max(0.03, busy.f)})` }} />
              </div>
            </div>
          ) : (
            <>
              <button className="btn btn--ghost" onClick={p.onClose}>
                Cancel
              </button>
              <button className="btn btn--seal" onClick={go} disabled={!parts.size}>
                {parts.size > 1 ? `Export ${parts.size} parts` : 'Export'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function readme(map: MapData, parts: DialogPart[], o: { width: number; look: string; provWidth: number; smooth: boolean; rasterWidth: number; mode: string }): string {
  const lines = [
    `Cartographer export — ${map.meta.name} (seed ${map.meta.params.seed})`,
    `Grid ${map.grid.cols} × ${map.grid.rows} hexes, pointy-top, odd rows shifted right. World ${map.world.width.toFixed(2)} × ${map.world.height.toFixed(2)} units (1 unit = hex radius).`,
    `All images cover the whole world; pixel (x, y) is world point ((x + 0.5) / s, (y + 0.5) / s) with s = image width / ${map.world.width.toFixed(4)}.`,
    '',
  ];
  if (parts.includes('image')) lines.push(`map.png — ${o.width} px wide, ${o.look} style, ${o.mode} map mode.`);
  if (parts.includes('provinces'))
    lines.push(
      `provinces.png — ${o.provWidth} px wide, ${o.smooth ? 'curved borders as drawn' : 'borders along hex edges'}. Each land province and sea zone has its own colour.`,
      `definition.csv — province;red;green;blue;name;type;x;y. Land provinces keep their game-data ids; sea zones and lakes are numbered from 100000.`,
    );
  if (parts.includes('heightmap'))
    lines.push(
      `heightmap.png — 16-bit greyscale: 0 deepest sea, 32768 sea level, 65535 highest peak (${o.rasterWidth} px wide).`,
      'heightmap_8bit.png — 8-bit: sea 0–95, sea level 96, land 96–255.',
    );
  if (parts.includes('terrain'))
    lines.push(
      'terrain.png — terrain type colours (see terrainTypes in gamedata.json for codes).',
      'masks/<terrain>.png — white where that terrain is. Exactly one mask is white at every pixel.',
      'water.png — white over sea and lakes, following the drawn coastline. rivers.png — river lines, wider downstream.',
    );
  if (parts.includes('tables')) lines.push('csv/*.csv — hexes, provinces, regions, realms, sea zones (and pinned symbols); layers/*.csv — one table per custom data layer.');
  if (parts.includes('gamedata')) lines.push('gamedata.json — everything above as one JSON document (schema cartographer-game-data, see docs/DATA_FORMAT.md).');
  return lines.join('\n') + '\n';
}

export const modeLabelOf = (m: MapMode, layers: DataLayer[]) => (m.startsWith('layer:') ? (layers.find((l) => `layer:${l.def.id}` === m)?.def.name ?? 'Layer') : modeDef(m).label);
