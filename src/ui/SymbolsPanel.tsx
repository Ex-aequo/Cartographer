import { t, tn, num } from '../i18n';
import { useMemo, useRef, useState } from 'react';
import type { MapData } from '../model/types';
import {
  ImportError,
  LEVEL_NAMES,
  allAssets,
  allSets,
  assetFromFile,
  ensureSymbols,
  newAssetId,
  pinToHex,
  readSetFile,
  removeAsset,
  setFile,
  usageOf,
  type Level,
  type PlaceOptions,
  type Placement,
  type SettlementMode,
  type SymbolAsset,
} from '../model/symbols';
import { ColorInput, TextField } from './fields';

type Change = (label: string, mutate: (map: MapData) => void, kind?: 'instant') => void;

interface Props {
  map: MapData;
  revision: number;
  change: Change;
  armed: string | null;
  onArm(id: string | null): void;
  opts: PlaceOptions;
  onOpts(o: PlaceOptions): void;
  selected: Placement | undefined;
  onAdjust(patch: Partial<Placement>): void;
  onAdjustEnd(label: string): void;
  onDelete(): void;
  onDeselect(): void;
  onDownload(blob: Blob, name: string): void;
  notify(msg: string): void;
}

/** Built-in symbols and sets have English names in the data; show them translated. */
const nameOf = (a: { id: string; name: string }) => (a.id.startsWith('ink') ? t(a.name) : a.name);

const thumb = (a: SymbolAsset) => (a.kind === 'svg' ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(a.data) : a.data);

/** The Symbols tab: a library of pictures, placing them, and town marks. */
export function SymbolsPanel(p: Props) {
  const sets = allSets(p.map);
  const assets = allAssets(p.map);
  const [setFilter, setSetFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const setInput = useRef<HTMLInputElement>(null);
  const ownSets = p.map.symbols?.sets ?? [];
  const [importSet, setImportSet] = useState<string>('mine');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => (setFilter === 'all' || a.set === setFilter) && (!q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.length, setFilter, query, p.revision]);
  const pickedAsset = assets.find((a) => a.id === (p.armed ?? picked));

  const importFiles = async (list: FileList | File[]) => {
    const all = Array.from(list).filter((f) => /\.(svg|png)$/i.test(f.name) || f.type === 'image/svg+xml' || f.type === 'image/png');
    const skipped = Array.from(list).length - all.length;
    if (!all.length) {
      p.notify(t('Only SVG and PNG files can be added as symbols.'));
      return;
    }
    const ok: { name: string; bytes: Uint8Array }[] = [];
    const problems: string[] = [];
    for (const f of all) ok.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    const target = ownSets.some((s) => s.id === importSet) ? importSet : 'mine';
    let added = 0;
    let firstId: string | null = null;
    p.change(
      all.length === 1 ? t('Add {name}', { name: all[0].name }) : t('Add {n} symbols', { n: all.length }),
      (m) => {
        const s = ensureSymbols(m);
        if (!s.sets.some((x) => x.id === target)) s.sets.push({ id: target, name: t('My symbols') });
        for (const f of ok) {
          try {
            const a = assetFromFile(f.name, f.bytes, target, newAssetId(m));
            s.assets.push(a);
            firstId ??= a.id;
            added++;
          } catch (e) {
            problems.push(e instanceof ImportError ? e.message : t('{file} could not be read.', { file: f.name }));
          }
        }
      },
      'instant',
    );
    const notes: string[] = [];
    if (added) notes.push(tn('Added {n} symbol.', 'Added {n} symbols.', added));
    if (skipped) notes.push(tn('{n} file was not SVG or PNG and was skipped.', '{n} files were not SVG or PNG and were skipped.', skipped));
    notes.push(...problems.slice(0, 3));
    if (problems.length > 3) notes.push(t('…and {n} more could not be added.', { n: problems.length - 3 }));
    if (problems.length || skipped) p.notify(notes.join(' '));
    if (firstId) {
      setSetFilter(target);
      setPicked(firstId);
    }
  };

  const loadSet = async (file: File) => {
    try {
      const text = await file.text();
      let n = 0;
      p.change(
        t('Load {name}', { name: file.name }),
        (m) => {
          const { set, assets: list } = readSetFile(text, () => newAssetId(m));
          const s = ensureSymbols(m);
          s.sets.push(set);
          s.assets.push(...list);
          n = list.length;
        },
        'instant',
      );
      p.notify(tn('Loaded {n} symbol from {name}.', 'Loaded {n} symbols from {name}.', n, { name: file.name }));
    } catch (e) {
      p.notify(e instanceof ImportError ? e.message : t('That set could not be loaded. {msg}', { msg: (e as Error).message }));
    }
  };

  const arm = (id: string) => {
    setPicked(id);
    p.onDeselect();
    p.onArm(p.armed === id ? null : id);
  };

  return (
    <div
      className={`panel__body symbols ${dropping ? 'is-dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
      }}
    >
      <fieldset className="field">
        <legend>{t('Library')}</legend>
        <div className="field__row">
          <select value={setFilter} onChange={(e) => setSetFilter(e.target.value)} aria-label={t('Symbol set')}>
            <option value="all">{t('All sets')}</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {nameOf(s)}
              </option>
            ))}
          </select>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Find by name or tag')} aria-label={t('Find symbols')} />
        </div>
        <div className="sym-grid" role="listbox" aria-label="Symbols">
          {shown.map((a) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={p.armed === a.id}
              className={`sym ${p.armed === a.id ? 'is-armed' : ''} ${picked === a.id && p.armed !== a.id ? 'is-picked' : ''}`}
              title={`${nameOf(a)}${a.tags.length ? ` — ${a.tags.map((x) => (a.id.startsWith('ink:') ? t(x) : x)).join(', ')}` : ''}`}
              onClick={() => arm(a.id)}
            >
              <img src={thumb(a)} alt="" draggable={false} />
              <span>{nameOf(a)}</span>
            </button>
          ))}
          {shown.length === 0 && <p className="hint">{t('No symbols match.')}</p>}
        </div>
        <p className="hint">{t(p.armed ? 'Click the map to place it. Hold Shift to snap it to a hex and pin it there. Click the symbol again to stop.' : 'Click a symbol, then click the map to place it. With none chosen, click a placed symbol to select it; drag to move it.')}</p>
        <div className="history">
          <button type="button" className="btn btn--ghost" onClick={() => files.current?.click()} title={t('SVG or PNG, up to 2 MB each. You can also drop files on this panel.')}>
            {t('Add pictures…')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => folder.current?.click()}>
            {t('Add a folder…')}
          </button>
        </div>
        {ownSets.length > 1 && (
          <label className="field field--inline">
            <span>{t('Add new pictures to')}</span>
            <select value={importSet} onChange={(e) => setImportSet(e.target.value)}>
              {ownSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <input ref={files} type="file" accept=".svg,.png,image/svg+xml,image/png" multiple hidden onChange={(e) => (e.target.files && importFiles(e.target.files), (e.target.value = ''))} />
        <input
          ref={folder}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => (e.target.files && importFiles(e.target.files), (e.target.value = ''))}
        />
        <input ref={setInput} type="file" accept=".json,application/json" hidden onChange={(e) => (e.target.files?.[0] && loadSet(e.target.files[0]), (e.target.value = ''))} />
        <div className="history">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              const id = `set${Date.now().toString(36)}`;
              p.change(t('New symbol set'), (m) => void ensureSymbols(m).sets.push({ id, name: t('Set {n}', { n: (m.symbols?.sets.length ?? 0) + 1 }) }), 'instant');
              setSetFilter(id);
              setImportSet(id);
            }}
          >
            {t('New set')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setInput.current?.click()}>
            {t('Load set')}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={setFilter === 'all'}
            title={t(setFilter === 'all' ? 'Choose a set above to save it' : 'Save this set as a file to use on other maps')}
            onClick={() => {
              const name = sets.find((s) => s.id === setFilter)?.name ?? 'symbols';
              p.onDownload(new Blob([setFile(p.map, setFilter)], { type: 'application/json' }), `${name.replace(/[^\w-]+/g, '_')}.symbols.json`);
            }}
          >
            {t('Save set')}
          </button>
        </div>
        {ownSets.some((s) => s.id === setFilter) && (
          <label className="field">
            <span>{t('Set name')}</span>
            <TextField value={ownSets.find((s) => s.id === setFilter)!.name} onCommit={(v) => v && p.change(t('Rename set'), (m) => void (m.symbols!.sets.find((s) => s.id === setFilter)!.name = v), 'instant')} />
          </label>
        )}
      </fieldset>

      {pickedAsset && !pickedAsset.id.startsWith('ink:') && !p.selected && <AssetEditor map={p.map} asset={pickedAsset} change={p.change} onRemoved={() => (p.onArm(null), setPicked(null))} />}

      {p.armed && !p.selected && (
        <fieldset className="field">
          <legend>{t('New symbols')}</legend>
          <PlacementControls value={p.opts} onChange={(patch) => p.onOpts({ ...p.opts, ...patch })} onEnd={() => {}} />
        </fieldset>
      )}

      {p.selected && (
        <fieldset className="field">
          <legend>{t('Selected symbol')}</legend>
          <p className="muted small">
            {(() => {
              const a = assets.find((x) => x.id === p.selected!.asset);
              return a ? nameOf(a) : t('Missing picture');
            })()}{' '}
            · {p.selected.hex >= 0 ? t('pinned to hex {col}, {row}', { col: p.selected.hex % p.map.grid.cols, row: Math.floor(p.selected.hex / p.map.grid.cols) }) : t('floating')}
          </p>
          <PlacementControls value={p.selected} onChange={p.onAdjust} onEnd={p.onAdjustEnd} />
          <label className="check">
            <input
              type="checkbox"
              checked={p.selected.hex >= 0}
              onChange={(e) =>
                p.change(
                  t(e.target.checked ? 'Pin symbol' : 'Unpin symbol'),
                  (m) => {
                    const pl = m.symbols?.placements.find((x) => x.id === p.selected!.id);
                    if (!pl) return;
                    if (e.target.checked) pinToHex(m, pl, pl.x, pl.y);
                    else pl.hex = -1;
                  },
                  'instant',
                )
              }
            />
            {t('Pinned to its hex (part of the game data)')}
          </label>
          <div className="history">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                p.change(t('Bring to front'),
                  (m) => {
                    const s = m.symbols!;
                    const i = s.placements.findIndex((x) => x.id === p.selected!.id);
                    if (i >= 0) s.placements.push(...s.placements.splice(i, 1));
                  },
                  'instant',
                )
              }
            >
              {t('To front')}
            </button>
            <button type="button" className="btn btn--ghost btn--danger" onClick={p.onDelete} title={t('Delete or Backspace')}>
              {t('Delete')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={p.onDeselect}>
              {t('Done')}
            </button>
          </div>
        </fieldset>
      )}

      <TownMarks map={p.map} assets={assets} sets={sets} change={p.change} />
      {dropping && <div className="drop-hint">Drop SVG or PNG files to add them</div>}
    </div>
  );
}

function AssetEditor({ map, asset, change, onRemoved }: { map: MapData; asset: SymbolAsset; change: Change; onRemoved(): void }) {
  const uses = usageOf(map, asset.id);
  const own = map.symbols?.sets ?? [];
  const upd = (label: string, fn: (a: SymbolAsset) => void) => change(label, (m) => {
    const a = m.symbols?.assets.find((x) => x.id === asset.id);
    if (a) fn(a);
  }, 'instant');
  return (
    <fieldset className="field">
      <legend>{t('Picture')}</legend>
      <label className="field">
        <span>{t('Name')}</span>
        <TextField value={asset.name} onCommit={(v) => v && v !== asset.name && upd(t('Rename symbol'), (a) => void (a.name = v))} />
      </label>
      <label className="field">
        <span>{t('Tags, separated by commas')}</span>
        <TextField
          value={asset.tags.join(', ')}
          onCommit={(v) =>
            upd(t('Tag symbol'), (a) => {
              a.tags = v
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
            })
          }
        />
      </label>
      {own.length > 1 && (
        <label className="field">
          <span>{t('Set')}</span>
          <select value={asset.set} onChange={(e) => upd(t('Move symbol'), (a) => void (a.set = e.target.value))}>
            {own.map((s) => (
              <option key={s.id} value={s.id}>
                {nameOf(s)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted small">
        {asset.kind.toUpperCase()}, {Math.round(asset.w)} × {Math.round(asset.h)} · {tn('placed {n} time', 'placed {n} times', uses)}
      </p>
      <button
        type="button"
        className="btn btn--ghost btn--wide btn--danger"
        onClick={() => {
          change(t('Remove {name}', { name: asset.name }), (m) => void removeAsset(m, asset.id), 'instant');
          onRemoved();
        }}
      >
        {uses ? t('Remove from library and the map ({n})', { n: num(uses) }) : t('Remove from library')}
      </button>
    </fieldset>
  );
}

function PlacementControls({ value, onChange, onEnd }: { value: PlaceOptions; onChange(p: Partial<PlaceOptions>): void; onEnd(label: string): void }) {
  return (
    <>
      <Slider label={t('Size')} value={value.size} min={0.6} max={24} step={0.1} format={(v) => t('{n} hexes', { n: num(Math.round((v / 1.732) * 10) / 10) })} onChange={(v) => onChange({ size: v })} onEnd={() => onEnd(t('Resize symbol'))} log />
      <Slider label={t('Turn')} value={value.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => onChange({ rotation: v })} onEnd={() => onEnd(t('Turn symbol'))} />
      <Slider label={t('Opacity')} value={value.opacity} min={0.1} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onChange({ opacity: v })} onEnd={() => onEnd(t('Fade symbol'))} />
      <div className="sym-opts">
        <label className="check check--tight">
          <input
            type="checkbox"
            checked={value.flip}
            onChange={(e) => {
              onChange({ flip: e.target.checked });
              onEnd(t('Mirror symbol'));
            }}
          />
          {t('Mirror')}
        </label>
        <label className="check check--tight" title="Redraw in the map's brown ink and parchment">
          <input
            type="checkbox"
            checked={value.ink}
            onChange={(e) => {
              onChange({ ink: e.target.checked });
              onEnd(t('Ink look'));
            }}
          />
          {t('Ink look')}
        </label>
        <label className="check check--tight">
          <input
            type="checkbox"
            checked={!!value.tint}
            onChange={(e) => {
              onChange({ tint: e.target.checked ? [178, 64, 52] : null });
              onEnd(t('Tint symbol'));
            }}
          />
          {t('Tint')}
        </label>
        {value.tint && (
          <ColorInput
            color={value.tint}
            onCommit={(c) => {
              onChange({ tint: c });
              onEnd(t('Tint symbol'));
            }}
            label={t('Tint colour')}
          />
        )}
      </div>
      <div className="field__row levels">
        <label className="field">
          <span>{t('Shown from')}</span>
          <select
            value={value.minLevel}
            onChange={(e) => {
              const v = Number(e.target.value) as Level;
              onChange({ minLevel: v, maxLevel: Math.max(v, value.maxLevel) as Level });
              onEnd(t('Zoom range'));
            }}
          >
            {LEVEL_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {t(n)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('to')}</span>
          <select
            value={value.maxLevel}
            onChange={(e) => {
              const v = Number(e.target.value) as Level;
              onChange({ maxLevel: v, minLevel: Math.min(v, value.minLevel) as Level });
              onEnd(t('Zoom range'));
            }}
          >
            {LEVEL_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {t(n)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; format(v: number): string; onChange(v: number): void; onEnd(): void; log?: boolean }) {
  // a log scale for sizes: fine control for small symbols, reach for big ones
  const to = (v: number) => (props.log ? Math.log(v) : v);
  const from = (t: number) => (props.log ? Math.exp(t) : t);
  return (
    <label className="field">
      <span className="field__label">
        {props.label}
        <output>{props.format(props.value)}</output>
      </span>
      <input
        type="range"
        min={to(props.min)}
        max={to(props.max)}
        step={props.log ? 0.01 : props.step}
        value={to(props.value)}
        onChange={(e) => props.onChange(Math.round(from(Number(e.target.value)) * 100) / 100)}
        onPointerUp={props.onEnd}
        onKeyUp={props.onEnd}
      />
    </label>
  );
}

export const MODE_NAMES: Record<SettlementMode, string> = {
  keep: 'The standard keep',
  size: 'By importance',
  realm: 'By realm',
  culture: 'By culture',
};

function TownMarks({ map, assets, sets, change }: { map: MapData; assets: SymbolAsset[]; sets: { id: string; name: string }[]; change: Change }) {
  const st = map.symbols?.settlements;
  const mode = st?.mode ?? 'keep';
  const set = (label: string, fn: (s: NonNullable<typeof st>) => void) => change(label, (m) => fn(ensureSymbols(m).settlements), 'instant');
  const picker = (value: string | undefined, onPick: (v: string | undefined) => void, label: string) => (
    <select value={value ?? ''} onChange={(e) => onPick(e.target.value || undefined)} aria-label={label}>
      <option value="">{t('Standard keep')}</option>
      {sets.map((s) => (
        <optgroup key={s.id} label={nameOf(s)}>
          {assets
            .filter((a) => a.set === s.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {nameOf(a)}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
  return (
    <fieldset className="field">
      <legend>{t('Town marks')}</legend>
      <label className="field">
        <span>{t('Mark each province’s town with')}</span>
        <select value={mode} onChange={(e) => set(t('Town marks'), (s) => void (s.mode = e.target.value as SettlementMode))}>
          {(Object.keys(MODE_NAMES) as SettlementMode[]).map((k) => (
            <option key={k} value={k}>
              {t(MODE_NAMES[k])}
            </option>
          ))}
        </select>
      </label>
      {mode === 'size' && st && (
        <div className="town-rows">
          {(
            [
              ['capital', 'Realm capitals'],
              ['seat', 'Region seats'],
              ['town', 'Other towns'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="field">
              <span>{t(label)}</span>
              {picker(st.size[k], (v) => set(t('Town marks'), (s) => void (v ? (s.size[k] = v) : delete s.size[k])), label)}
            </label>
          ))}
        </div>
      )}
      {mode === 'realm' && st && (
        <div className="town-rows town-rows--scroll">
          {map.realms
            .filter((r) => !r.retired)
            .map((r) => (
              <label key={r.id} className="field">
                <span>
                  <i className="dot" style={{ background: `rgb(${r.color.join(',')})` }} />
                  {r.name}
                </span>
                {picker(st.realm[r.id], (v) => set(t('Town marks'), (s) => void (v ? (s.realm[r.id] = v) : delete s.realm[r.id])), r.name)}
              </label>
            ))}
        </div>
      )}
      {mode === 'culture' && st && (
        <div className="town-rows town-rows--scroll">
          {map.cultures
            .filter((c) => map.realms.some((r) => !r.retired && r.culture === c.id))
            .map((c) => (
              <label key={c.id} className="field">
                <span>{c.name}</span>
                {picker(st.culture[c.id], (v) => set(t('Town marks'), (s) => void (v ? (s.culture[c.id] = v) : delete s.culture[c.id])), c.name)}
              </label>
            ))}
        </div>
      )}
      {mode !== 'keep' && st && (
        <>
          <label className="field">
            <span className="field__label">
              {t('Mark size')}
              <output>{Math.round(st.scale * 100)}%</output>
            </span>
            <input type="range" min={0.5} max={3} step={0.05} defaultValue={st.scale} onPointerUp={(e) => set(t('Town mark size'), (s) => void (s.scale = Number((e.target as HTMLInputElement).value)))} onKeyUp={(e) => set(t('Town mark size'), (s) => void (s.scale = Number((e.target as HTMLInputElement).value)))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={st.ink} onChange={(e) => set(t('Town mark ink'), (s) => void (s.ink = e.target.checked))} />
            {t('Ink look for town marks')}
          </label>
        </>
      )}
    </fieldset>
  );
}
