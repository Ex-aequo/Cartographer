import { t, tn, num } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { BIOME_NAMES, Biome, TERRAIN_NAMES, Terrain, type MapData } from '../model/types';
import {
  CONDITION_NAMES,
  FORMULA_NAMES,
  TYPE_NAMES,
  createLayer,
  newLayerDef,
  readTemplate,
  runRules,
  swatch,
  templateOf,
  type Aggregate,
  type Condition,
  type ConditionField,
  type DataLayer,
  type FormulaField,
  type LayerDef,
  type LayerScope,
  type LayerType,
  type Rule,
} from '../model/layers';
import type { ToolSettings } from '../edit/session';
import { ToolIcon } from './EditPanel';
import { ColorInput, NumField, TextField, hex } from './fields';

type Change = (label: string, mutate: (map: MapData) => void, kind?: 'instant') => void;

interface Props {
  map: MapData;
  revision: number;
  activeId: string | null;
  onActive(id: string | null): void;
  /** the active layer is the map mode */
  shown: boolean;
  onShow(id: string | null): void;
  settings: ToolSettings;
  onSettings(s: ToolSettings): void;
  change: Change;
  working: boolean;
  canUndo: boolean;
  undoLabel?: string;
  onUndo(): void;
  onDownload(blob: Blob, name: string): void;
  onExportCsv(): void;
  notify(msg: string): void;
}

const LAND_TERRAINS = (Object.keys(TERRAIN_NAMES).map(Number) as Terrain[]).filter((t) => t > Terrain.Lake);
const LAND_BIOMES = (Object.keys(BIOME_NAMES).map(Number) as Biome[]).filter((b) => b > Biome.Lake);

export const AGG_NAMES: Record<Aggregate, string> = {
  sum: 'Total of',
  average: 'Average of',
  max: 'Highest',
  min: 'Lowest',
  mode: 'Most common',
  any: 'Any hex has',
};

const NUM_DEFAULTS: Partial<Record<ConditionField, [number, number]>> = {
  elevation: [0.3, 1],
  temperature: [-5, 25],
  rainfall: [0.5, 1],
  settlementDistance: [0, 2],
};


/** The Data tab: custom game layers, their rules, and the value brush. */
export function DataPanel(p: Props) {
  const layers = p.map.layers ?? [];
  const active = layers.find((l) => l.def.id === p.activeId) ?? null;
  const [creating, setCreating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // keep a valid layer active
  useEffect(() => {
    if (!active && layers.length) p.onActive(layers[0].def.id);
    if (!layers.length && p.activeId) p.onActive(null);
  });

  /** One undoable change to the active layer; rules run again afterwards. */
  const edit = (label: string, fn: (def: LayerDef, layer: DataLayer, map: MapData) => void, rerun = true) => {
    if (!active) return;
    const id = active.def.id;
    p.change(
      label,
      (m) => {
        const l = m.layers.find((x) => x.def.id === id);
        if (!l) return;
        fn(l.def, l, m);
        if (rerun) runRules(m, l);
      },
      'instant',
    );
  };

  const loadTemplate = async (file: File) => {
    try {
      const defs = readTemplate(await file.text());
      p.change(
        t('Load {name}', { name: file.name }),
        (m) => {
          for (const d of defs) {
            const def: LayerDef = JSON.parse(JSON.stringify(d));
            const ids = new Set(m.layers.map((l) => l.def.id));
            const base = def.id;
            for (let k = 2; ids.has(def.id); k++) def.id = `${base}-${k}`;
            const l = createLayer(m, def);
            m.layers.push(l);
            runRules(m, l);
          }
        },
        'instant',
      );
      p.notify(tn('Loaded {n} layer from {name}.', 'Loaded {n} layers from {name}.', defs.length, { name: file.name }));
    } catch (e) {
      p.notify(t('That template could not be loaded. {msg}', { msg: (e as Error).message }));
    }
  };

  return (
    <div className="panel__body data">
      <fieldset className="field">
        <legend>{t('Layers')}</legend>
        {layers.length === 0 && <p className="hint">{t('Data layers hold game information per hex or per province: resources, fertility, danger, holy sites. Rules fill them from the land; you can paint over the rules by hand.')}</p>}
        <ul className="layer-list">
          {layers.map((l) => {
            const on = l.def.id === p.activeId;
            const shown = on && p.shown;
            return (
              <li key={l.def.id} className={on ? 'is-on' : ''}>
                <button type="button" className="layer-list__name" onClick={() => p.onActive(l.def.id)} aria-pressed={on}>
                  {l.def.name}
                  <small>
                    {t(TYPE_NAMES[l.def.type])} · {t(l.def.scope === 'hex' ? 'per hex' : 'per province')}
                  </small>
                </button>
                <button type="button" className={`eye ${shown ? 'is-on' : ''}`} onClick={() => (p.onActive(l.def.id), p.onShow(shown ? null : l.def.id))} aria-pressed={shown} title={t(shown ? 'Back to the map' : 'Show on the map')}>
                  <svg viewBox="0 0 18 18" aria-hidden>
                    <path d="M1.5 9 C4 4.5 14 4.5 16.5 9 C14 13.5 4 13.5 1.5 9 Z" />
                    <circle cx="9" cy="9" r="2.4" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
        {creating ? (
          <NewLayer
            onCancel={() => setCreating(false)}
            onCreate={(name, type, scope) => {
              setCreating(false);
              let newId = '';
              p.change(
                t('New layer'),
                (m) => {
                  const def = newLayerDef(
                    m.layers.map((l) => l.def),
                    type,
                    scope,
                    name,
                  );
                  newId = def.id;
                  const l = createLayer(m, def);
                  m.layers.push(l);
                  runRules(m, l);
                },
                'instant',
              );
              if (newId) {
                p.onActive(newId);
                p.onShow(newId);
              }
            }}
          />
        ) : (
          <div className="history">
            <button type="button" className="btn btn--ghost" onClick={() => setCreating(true)} disabled={p.working}>
              {t('New layer')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()} title={t('Add the layers from a template file')}>
              {t('Load template')}
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) loadTemplate(f);
          }}
        />
        {layers.length > 0 && (
          <div className="history">
            <button type="button" className="btn btn--ghost" onClick={() => p.onDownload(new Blob([templateOf(layers.map((l) => l.def))], { type: 'application/json' }), 'layers.template.json')} title={t("The layer definitions and rules, without this map's values, to reuse on other maps")}>
              {t('Save template')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={p.onExportCsv} title={t('One table per layer, zipped')}>
              {t('CSV tables')}
            </button>
          </div>
        )}
      </fieldset>

      {active && (
        <>
          <PaintControls layer={active} settings={p.settings} onSettings={p.onSettings} />
          <LayerEditor key={active.def.id} layer={active} layers={layers} edit={edit} change={p.change} onDeleted={() => (p.onShow(null), p.onActive(null))} />
        </>
      )}
      <div className="history">
        <button type="button" className="btn btn--ghost" onClick={p.onUndo} disabled={!p.canUndo || p.working} title="Ctrl+Z">
          {t('Undo')}{p.undoLabel ? `: ${t(p.undoLabel).toLowerCase()}` : ''}
        </button>
      </div>
    </div>
  );
}

function NewLayer({ onCreate, onCancel }: { onCreate(name: string, type: LayerType, scope: LayerScope): void; onCancel(): void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<LayerType>('category');
  const [scope, setScope] = useState<LayerScope>('hex');
  return (
    <form
      className="new-layer"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(name.trim(), type, scope);
      }}
    >
      <label className="field">
        <span>{t('Name')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Leave empty for a worked example')} autoFocus />
      </label>
      <div className="field__row">
        <label className="field">
          <span>{t('Holds')}</span>
          <select value={type} onChange={(e) => setType(e.target.value as LayerType)}>
            {(Object.keys(TYPE_NAMES) as LayerType[]).map((ty) => (
              <option key={ty} value={ty}>
                {t(TYPE_NAMES[ty])}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('One value per')}</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as LayerScope)}>
            <option value="hex">{t('Hex')}</option>
            <option value="province">{t('Province')}</option>
          </select>
        </label>
      </div>
      <div className="history">
        <button type="submit" className="btn btn--seal">
          {t('Create')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- the brush

function PaintControls({ layer, settings, onSettings }: { layer: DataLayer; settings: ToolSettings; onSettings(s: ToolSettings): void }) {
  const def = layer.def;
  const on = settings.tool === 'layer' && settings.layer === def.id;
  const set = (patch: Partial<ToolSettings>) => onSettings({ ...settings, tool: 'layer', layer: def.id, ...patch });
  const v = on ? (settings.layerValue ?? defaultBrush(def)) : defaultBrush(def);
  const hexes = settings.radius / 1.732;
  return (
    <fieldset className="field paint">
      <legend>{t('Paint by hand')}</legend>
      <button type="button" className={`tool tool--wide ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => (on ? onSettings({ ...settings, tool: null }) : set({ layerValue: v }))}>
        <ToolIcon tool="layer" />
        {on ? t('Painting — click to stop') : t('Paint {name}', { name: def.name })}
      </button>
      {on && (
        <>
          <div className="swatches">
            {(def.type === 'category' || def.type === 'tags') &&
              def.categories.map((c) => (
                <button key={c.id} type="button" className={`swatch ${v === c.id ? 'is-on' : ''}`} aria-pressed={v === c.id} onClick={() => set({ layerValue: c.id })}>
                  <i style={{ background: hex(c.color) }} />
                  {c.name}
                </button>
              ))}
            {def.type === 'category' && (
              <button type="button" className={`swatch ${v === -1 ? 'is-on' : ''}`} aria-pressed={v === -1} onClick={() => set({ layerValue: -1 })}>
                <i className="swatch__none" />
                {t('None')}
              </button>
            )}
            {def.type === 'flag' &&
              [1, 0].map((f) => (
                <button key={f} type="button" className={`swatch ${v === f ? 'is-on' : ''}`} aria-pressed={v === f} onClick={() => set({ layerValue: f })}>
                  <i style={{ background: f ? hex(def.categories[0]?.color ?? [196, 70, 50]) : 'transparent' }} />
                  {t(f ? 'Yes' : 'No')}
                </button>
              ))}
            <button type="button" className={`swatch ${Number.isNaN(v) ? 'is-on' : ''}`} aria-pressed={Number.isNaN(v)} onClick={() => set({ layerValue: NaN })} title={t('Hexes you paint go back to whatever the rules say')}>
              <i className="swatch__rules" />
              {t('Let rules decide')}
            </button>
          </div>
          {def.type === 'number' && !Number.isNaN(v) && (
            <label className="field">
              <span className="field__label">
                {t('Value')}
                <output>{v.toFixed(def.decimals)}</output>
              </span>
              <input type="range" min={def.min} max={def.max} step={10 ** -def.decimals} value={v} onChange={(e) => set({ layerValue: Number(e.target.value) })} />
            </label>
          )}
          {def.type === 'tags' && (
            <div className="segmented">
              {(['add', 'remove'] as const).map((m) => (
                <button key={m} type="button" className={(settings.tagMode ?? 'add') === m ? 'is-on' : ''} onClick={() => set({ tagMode: m })}>
                  {t(m === 'add' ? 'Add tag' : 'Remove tag')}
                </button>
              ))}
            </div>
          )}
          <label className="field">
            <span className="field__label">
              {t('Brush size')}
              <output>{hexes < 1.5 ? t('One hex') : t('{n} hexes across', { n: Math.round(hexes * 2) })}</output>
            </span>
            <input type="range" min={0.6} max={20} step={0.2} value={settings.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
          </label>
          <p className="hint">{t(def.scope === 'province' ? 'Painting sets the value of every province you touch.' : 'Drag over hexes.')} {t('Values you paint stay when the rules run again.')} {t('Right-drag or hold Space to move the map.')} {t('In 3D, right-drag turns and tilts it; middle-drag or Space moves it.')}</p>
        </>
      )}
    </fieldset>
  );
}

function defaultBrush(def: LayerDef): number {
  if (def.type === 'number') return Math.round(((def.min + def.max) / 2) * 10 ** def.decimals) / 10 ** def.decimals;
  if (def.type === 'flag') return 1;
  return def.categories[0]?.id ?? (def.type === 'category' ? -1 : 0);
}

// ---------------------------------------------------------- layer editor

type Edit = (label: string, fn: (def: LayerDef, layer: DataLayer, map: MapData) => void, rerun?: boolean) => void;

function LayerEditor({ layer, layers, edit, change, onDeleted }: { layer: DataLayer; layers: DataLayer[]; edit: Edit; change: Change; onDeleted(): void }) {
  const def = layer.def;
  const hand = countLocked(layer);
  const hexLayers = layers.filter((l) => l.def.scope === 'hex' && l.def.id !== def.id);
  return (
    <>
      <fieldset className="field">
        <legend>{t('Layer')}</legend>
        <label className="field">
          <span>{t('Name')}</span>
          <TextField value={def.name} onCommit={(v) => v && v !== def.name && edit(t('Rename layer'), (d) => void (d.name = v), false)} />
        </label>
        <p className="muted small">
          {t(def.scope === 'hex' ? '{type}, one value per hex.' : '{type}, one value per province.', { type: t(TYPE_NAMES[def.type]) })} {t('Exported as')} <code>{def.id}</code>.
        </p>

        {(def.type === 'category' || def.type === 'tags') && <Categories def={def} edit={edit} />}
        {def.type === 'flag' && (
          <label className="field field--inline">
            <span>{t('Colour for “yes”')}</span>
            <ColorInput color={def.categories[0]?.color ?? [196, 70, 50]} onCommit={(c) => edit(t('Recolour layer'), (d) => void (d.categories = [{ id: 0, name: t('Yes'), color: c }]), false)} />
          </label>
        )}
        {def.type === 'number' && (
          <>
            {!def.rollUp && <div className="field__row">
              <label className="field">
                <span>{t('Lowest')}</span>
                <NumField value={def.min} onCommit={(v) => edit(t('Change range'), (d) => void (d.min = Math.min(v, d.max)))} />
              </label>
              <label className="field">
                <span>{t('Highest')}</span>
                <NumField value={def.max} onCommit={(v) => edit(t('Change range'), (d) => void (d.max = Math.max(v, d.min)))} />
              </label>
              <label className="field">
                <span>{t('Decimals')}</span>
                <select value={def.decimals} onChange={(e) => edit(t('Change decimals'), (d) => void (d.decimals = Number(e.target.value)))}>
                  {[0, 1, 2].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
            </div>}
            <div className="field__row">
              <label className="field field--inline">
                <span>{t('Low colour')}</span>
                <ColorInput color={def.colorLow} onCommit={(c) => edit(t('Recolour layer'), (d) => void (d.colorLow = c), false)} />
              </label>
              <label className="field field--inline">
                <span>{t('High colour')}</span>
                <ColorInput color={def.colorHigh} onCommit={(c) => edit(t('Recolour layer'), (d) => void (d.colorHigh = c), false)} />
              </label>
            </div>
          </>
        )}
        <label className="check">
          <input type="checkbox" checked={def.showIcons} onChange={(e) => edit(t('Show values on map'), (d) => void (d.showIcons = e.target.checked), false)} />
          {t('Letter the values on the map when zoomed in')}
        </label>
      </fieldset>

      <fieldset className="field">
        <legend>{t('How it is filled')}</legend>
        {def.scope === 'province' && (
          <label className="field">
            <span>{t('Values come from')}</span>
            <select
              value={def.rollUp?.source ?? ''}
              onChange={(e) =>
                edit(t('Change source'), (d) => {
                  d.rollUp = e.target.value ? { source: e.target.value, how: d.rollUp?.how ?? (d.type === 'number' ? 'sum' : d.type === 'flag' ? 'any' : 'mode') } : undefined;
                })
              }
            >
              <option value="">{t('Rules, tested at each province’s town')}</option>
              {hexLayers.map((l) => (
                <option key={l.def.id} value={l.def.id}>
                  {t('The hexes of the layer “{name}”', { name: l.def.name })}
                </option>
              ))}
            </select>
          </label>
        )}
        {def.rollUp ? (
          <label className="field">
            <span>{t('Combine the hexes as')}</span>
            <select value={def.rollUp.how} onChange={(e) => edit(t('Change roll-up'), (d) => void (d.rollUp = { ...d.rollUp!, how: e.target.value as Aggregate }))}>
              {(Object.keys(AGG_NAMES) as Aggregate[]).map((a) => (
                <option key={a} value={a}>
                  {t(AGG_NAMES[a])} {layers.find((l) => l.def.id === def.rollUp!.source)?.def.name ?? ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Rules def={def} edit={edit} />
        )}
        {!def.rollUp && (
          <label className="check">
            <input type="checkbox" checked={def.autoRun} onChange={(e) => edit(t('Change auto-run'), (d) => void (d.autoRun = e.target.checked), false)} />
            {t('Run the rules again after every edit to the land')}
          </label>
        )}
        <div className="history">
          {!def.rollUp && (
            <button type="button" className="btn btn--ghost" onClick={() => edit(t('Run rules'), () => {})}>
              {t('Run rules now')}
            </button>
          )}
          <button type="button" className="btn btn--ghost" disabled={!hand} onClick={() => edit(t('Forget painted values'), (_d, l) => l.locked.fill(0))} title={t('Give every hand-painted value back to the rules')}>
            {hand ? t('Forget {n} painted', { n: num(hand) }) : t('Forget painted')}
          </button>
        </div>
      </fieldset>

      <button
        type="button"
        className="btn btn--ghost btn--wide btn--danger"
        onClick={() => {
          change(
            t('Delete {name}', { name: def.name }),
            (m) => {
              m.layers = m.layers.filter((l) => l.def.id !== def.id);
              for (const l of m.layers) if (l.def.rollUp?.source === def.id) l.def.rollUp = undefined;
            },
            'instant',
          );
          onDeleted();
        }}
      >
        {t('Delete layer “{name}”', { name: def.name })}
      </button>
    </>
  );
}

function countLocked(l: DataLayer): number {
  let n = 0;
  for (let i = 0; i < l.locked.length; i++) n += l.locked[i];
  return n;
}

function Categories({ def, edit }: { def: LayerDef; edit: Edit }) {
  const max = def.type === 'tags' ? 32 : 64;
  return (
    <div className="cats">
      <span className="field__label">{t(def.type === 'tags' ? 'Tags' : 'Categories')}</span>
      {def.categories.map((c) => (
        <div key={c.id} className="cats__row">
          <ColorInput color={c.color} onCommit={(col) => edit(t('Recolour'), (d) => void (d.categories.find((x) => x.id === c.id)!.color = col), false)} label={t('Colour of {name}', { name: c.name })} />
          <TextField value={c.name} onCommit={(v) => v && edit(t('Rename'), (d) => void (d.categories.find((x) => x.id === c.id)!.name = v), false)} />
          <button
            type="button"
            className="icon-btn"
            aria-label={t('Remove {name}', { name: c.name })}
            onClick={() =>
              edit(t('Remove {name}', { name: c.name }), (d, l) => {
                d.categories = d.categories.filter((x) => x.id !== c.id);
                d.rules = d.rules.filter((r) => r.formula || r.value !== c.id);
                for (let i = 0; i < l.values.length; i++) {
                  if (d.type === 'tags') l.values[i] = (l.values[i] & ~(1 << c.id)) >>> 0;
                  else if (l.values[i] === c.id) {
                    l.values[i] = d.defaultValue;
                    l.locked[i] = 0;
                  }
                }
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={def.categories.length >= max}
        onClick={() =>
          edit(t('Add category'),
            (d) => {
              const id = d.categories.reduce((m, c) => Math.max(m, c.id + 1), 0);
              if (id >= max) return;
              d.categories.push({ id, name: t(d.type === 'tags' ? 'Tag {n}' : 'Category {n}', { n: id + 1 }), color: swatch(id) });
            },
            false,
          )
        }
      >
        {t(def.type === 'tags' ? '+ Add tag' : '+ Add category')}
      </button>
    </div>
  );
}

// ----------------------------------------------------------------- rules

function Rules({ def, edit }: { def: LayerDef; edit: Edit }) {
  const upd = (label: string, idx: number, fn: (r: Rule) => void) => edit(label, (d) => fn(d.rules[idx]));
  return (
    <div className="rules">
      {def.rules.length === 0 && <p className="hint">{t(def.scope === 'hex' ? 'No rules yet: every hex starts empty. Add a rule to fill the layer from the land.' : 'No rules yet: every province starts empty. Add a rule to fill the layer from the land.')}</p>}
      {def.rules.length > 1 && <p className="muted small">{t(def.type === 'tags' ? 'Rules apply top to bottom; a later rule overrides an earlier one (tags add up).' : 'Rules apply top to bottom; a later rule overrides an earlier one.')}</p>}
      {def.rules.map((r, i) => (
        <div key={r.id} className="rule">
          <div className="rule__head">
            <strong>{t('Rule {n}', { n: i + 1 })}</strong>
            <span>
              {i > 0 && (
                <button type="button" className="icon-btn" aria-label={t('Move up')} onClick={() => edit(t('Reorder rules'), (d) => void d.rules.splice(i - 1, 0, d.rules.splice(i, 1)[0]))}>
                  ↑
                </button>
              )}
              <button type="button" className="icon-btn" aria-label={t('Remove rule {n}', { n: i + 1 })} onClick={() => edit(t('Remove rule'), (d) => void d.rules.splice(i, 1))}>
                ×
              </button>
            </span>
          </div>
          <span className="rule__word">{t('When')}</span>
          {r.when.length === 0 && <span className="muted small"> {t('any land')}</span>}
          {r.when.map((c, k) => (
            <ConditionRow key={k} cond={c} onChange={(nc) => upd(t('Change condition'), i, (rr) => void (rr.when[k] = nc))} onRemove={() => upd(t('Remove condition'), i, (rr) => void rr.when.splice(k, 1))} />
          ))}
          <button type="button" className="btn btn--ghost btn--small" onClick={() => upd(t('Add condition'), i, (rr) => void rr.when.push({ field: 'terrain', codes: [Terrain.Plains] }))}>
            {t('+ and…')}
          </button>
          <label className="field field--inline">
            <span className="rule__word">{t('with a chance of')}</span>
            <NumField value={Math.round(r.chance * 1000) / 10} suffix="%" onCommit={(v) => upd(t('Change chance'), i, (rr) => void (rr.chance = Math.min(1, Math.max(0, v / 100))))} />
          </label>
          <div className="rule__then">
            <span className="rule__word">{t(def.type === 'tags' ? 'add the tag' : 'set to')}</span>
            <RuleValue def={def} rule={r} onChange={(patch) => upd(t('Change rule value'), i, (rr) => Object.assign(rr, patch))} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() =>
          edit(t('Add rule'), (d) => {
            const id = `r${d.rules.reduce((m, r) => Math.max(m, Number(r.id.slice(1)) || 0), 0) + 1}`;
            d.rules.push({ id, when: [{ field: 'terrain', codes: [Terrain.Plains] }], chance: 1, value: d.type === 'number' ? d.max : d.type === 'flag' ? 1 : (d.categories[0]?.id ?? 0) });
          })
        }
      >
        {t('+ Add rule')}
      </button>
    </div>
  );
}

function ConditionRow({ cond, onChange, onRemove }: { cond: Condition; onChange(c: Condition): void; onRemove(): void }) {
  const f = cond.field;
  const setField = (nf: ConditionField) => {
    if (nf === 'terrain') onChange({ field: nf, codes: [Terrain.Plains] });
    else if (nf === 'biome') onChange({ field: nf, codes: [Biome.Grassland] });
    else if (nf === 'coastal' || nf === 'river' || nf === 'lake') onChange({ field: nf, is: true });
    else onChange({ field: nf, min: NUM_DEFAULTS[nf]![0], max: NUM_DEFAULTS[nf]![1] });
  };
  return (
    <div className="cond">
      <div className="cond__head">
        <select value={f} onChange={(e) => setField(e.target.value as ConditionField)} aria-label={t('Condition')}>
          {(Object.keys(CONDITION_NAMES) as ConditionField[]).map((k) => (
            <option key={k} value={k}>
              {t(CONDITION_NAMES[k])}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" aria-label={t('Remove condition')} onClick={onRemove}>
          ×
        </button>
      </div>
      {(f === 'terrain' || f === 'biome') && (
        <div className="chips">
          {(f === 'terrain' ? LAND_TERRAINS : LAND_BIOMES).map((code) => {
            const on = (cond.codes ?? []).includes(code);
            return (
              <button
                key={code}
                type="button"
                className={`chip ${on ? 'is-on' : ''}`}
                aria-pressed={on}
                onClick={() => onChange({ ...cond, codes: on ? cond.codes!.filter((c) => c !== code) : [...(cond.codes ?? []), code] })}
              >
                {t(f === 'terrain' ? TERRAIN_NAMES[code as Terrain] : BIOME_NAMES[code as Biome])}
              </button>
            );
          })}
        </div>
      )}
      {(f === 'coastal' || f === 'river' || f === 'lake') && (
        <select value={cond.is === false ? 'no' : 'yes'} onChange={(e) => onChange({ ...cond, is: e.target.value === 'yes' })} aria-label={t('Must be')}>
          <option value="yes">{t('Yes')}</option>
          <option value="no">{t('No')}</option>
        </select>
      )}
      {NUM_DEFAULTS[f] && (
        <div className="field__row">
          <NumField value={cond.min ?? 0} onCommit={(v) => onChange({ ...cond, min: v })} aria-label={t('From')} />
          <span className="muted">{t('to')}</span>
          <NumField value={cond.max ?? 0} onCommit={(v) => onChange({ ...cond, max: v })} aria-label={t('To')} />
        </div>
      )}
    </div>
  );
}

function RuleValue({ def, rule, onChange }: { def: LayerDef; rule: Rule; onChange(p: Partial<Rule>): void }) {
  if (def.type === 'category' || def.type === 'tags')
    return (
      <select value={rule.value} onChange={(e) => onChange({ value: Number(e.target.value) })} aria-label={t('Value')}>
        {def.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        {def.type === 'category' && <option value={-1}>{t('Nothing')}</option>}
      </select>
    );
  if (def.type === 'flag')
    return (
      <select value={rule.value ? 1 : 0} onChange={(e) => onChange({ value: Number(e.target.value) })} aria-label={t('Value')}>
        <option value={1}>{t('Yes')}</option>
        <option value={0}>{t('No')}</option>
      </select>
    );
  const fx = rule.formula;
  return (
    <div className="formula">
      <select value={fx ? fx.field : ''} onChange={(e) => onChange({ formula: e.target.value ? { field: e.target.value as FormulaField, scale: fx?.scale ?? 10, offset: fx?.offset ?? 0 } : undefined })} aria-label={t('Value from')}>
        <option value="">{t('a fixed number')}</option>
        {(Object.keys(FORMULA_NAMES) as FormulaField[]).map((k) => (
          <option key={k} value={k}>
            {t(FORMULA_NAMES[k])} ×…
          </option>
        ))}
      </select>
      {fx ? (
        <div className="field__row">
          <span className="muted">×</span>
          <NumField value={fx.scale} onCommit={(v) => onChange({ formula: { ...fx, scale: v } })} aria-label={t('Multiply by')} />
          <span className="muted">+</span>
          <NumField value={fx.offset} onCommit={(v) => onChange({ formula: { ...fx, offset: v } })} aria-label={t('Then add')} />
        </div>
      ) : (
        <NumField value={rule.value} onCommit={(v) => onChange({ value: v })} aria-label={t('Value')} />
      )}
    </div>
  );
}

