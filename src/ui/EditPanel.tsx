import { t, tn, num } from '../i18n';
import { TERRAIN_NAMES, type LabelEdit } from '../model/types';
import { TERRAIN_COLORS } from '../render/mapModes';
import { HEIGHT_TOOLS, PAINTABLE, TOOL_LABELS, type ToolId, type ToolSettings } from '../edit/session';

export const GROUPS: { name: string; tools: ToolId[] }[] = [
  { name: 'Land', tools: ['raise', 'lower', 'smooth', 'flatten', 'paint'] },
  { name: 'Water', tools: ['river', 'erase-river', 'lake', 'drain'] },
  { name: 'Borders', tools: ['assign', 'split', 'merge', 'region', 'realm'] },
  { name: 'Words', tools: ['label'] },
];

export const HINTS: Record<ToolId, string> = {
  raise: 'Drag to build land up. Hold still to keep building. Raised sea floor becomes new land.',
  lower: 'Drag to wear land down. Below sea level it floods.',
  smooth: 'Drag to soften rough ground.',
  flatten: 'Drag to level the ground to the height where you started.',
  paint: 'Drag to set the terrain of hexes, whatever their climate.',
  river: 'Draw from the source to the sea or another river. The land is cut so water runs downhill along your line.',
  'erase-river': 'Drag over a river to remove it from there up to its sources.',
  lake: 'Drag to sink the ground into a lake.',
  drain: 'Drag over water to turn it into low land.',
  assign: 'Start inside a province and drag outward: the hexes you cross join it.',
  split: 'Draw a line across a province, from border to border. The side with the town keeps the name; the other becomes a new province.',
  merge: 'Drag from a province into its neighbour: the neighbour joins the province you started in.',
  region: 'Start inside a region and drag across provinces: they join that region.',
  realm: 'Start inside a realm and drag across regions: they join that realm.',
  label: 'Drag a name to move it. Click a name to resize, bend, turn or hide it.',
  layer: 'Drag over hexes to set their value. Values set by hand stay when rules run again.',
};

const BRUSH_TOOLS: ToolId[] = ['raise', 'lower', 'smooth', 'flatten', 'paint', 'erase-river', 'lake', 'drain', 'assign', 'region', 'realm'];

interface Props {
  settings: ToolSettings;
  onSettings(s: ToolSettings): void;
  working: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  onUndo(): void;
  onRedo(): void;
  editedHexes: number;
  /** label tool */
  selectedLabel: string | null;
  selectedLabelName: string | null;
  labelEdit: LabelEdit | undefined;
  hiddenLabels: number;
  onAdjustLabel(patch: Partial<LabelEdit> | null): void;
  onAdjustLabelEnd(label: string): void;
  onShowAllLabels(): void;
}

export function EditPanel(p: Props) {
  const s = p.settings;
  const set = (patch: Partial<ToolSettings>) => p.onSettings({ ...s, ...patch });
  const hexes = s.radius / 1.732;
  return (
    <div className="panel__body edit">
      {GROUPS.map((g) => (
        <fieldset key={g.name} className="field">
          <legend>{t(g.name)}</legend>
          <div className="tools">
            {g.tools.map((tool) => (
              <button key={tool} type="button" className={`tool ${s.tool === tool ? 'is-on' : ''}`} aria-pressed={s.tool === tool} onClick={() => set({ tool: s.tool === tool ? null : tool })}>
                <ToolIcon tool={tool} />
                {t(TOOL_LABELS[tool])}
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      {s.tool ? <p className="hint">{t(HINTS[s.tool])} {t('Right-drag or hold Space to move the map.')}</p> : <p className="hint">{t('Pick a tool to start. Click a province with no tool to rename it. Every change can be undone.')}</p>}

      {s.tool && BRUSH_TOOLS.includes(s.tool) && (
        <label className="field">
          <span className="field__label">
            {t('Brush size')}
            <output>{hexes < 1.5 ? t('One hex') : t('{n} hexes across', { n: Math.round(hexes * 2) })}</output>
          </span>
          <input type="range" min={0.6} max={20} step={0.2} value={s.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
        </label>
      )}
      {s.tool && HEIGHT_TOOLS.includes(s.tool) && (
        <label className="field">
          <span className="field__label">
            {t('Strength')}
            <output>{t(s.strength < 0.35 ? 'Gentle' : s.strength < 0.75 ? 'Medium' : 'Strong')}</output>
          </span>
          <input type="range" min={0.1} max={1} step={0.05} value={s.strength} onChange={(e) => set({ strength: Number(e.target.value) })} />
        </label>
      )}
      {s.tool === 'paint' && (
        <fieldset className="field">
          <legend>{t('Terrain')}</legend>
          <div className="swatches">
            {PAINTABLE.map((tr) => (
              <button key={tr} type="button" className={`swatch ${s.terrain === tr ? 'is-on' : ''}`} aria-pressed={s.terrain === tr} onClick={() => set({ terrain: tr })}>
                <i style={{ background: `rgb(${TERRAIN_COLORS[tr].join(',')})` }} />
                {t(TERRAIN_NAMES[tr])}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {s.tool === 'label' && <LabelControls {...p} />}

      <div className="history">
        <button type="button" className="btn btn--ghost" onClick={p.onUndo} disabled={!p.canUndo || p.working} title="Ctrl+Z">
          {t('Undo')}{p.undoLabel ? `: ${t(p.undoLabel).toLowerCase()}` : ''}
        </button>
        <button type="button" className="btn btn--ghost" onClick={p.onRedo} disabled={!p.canRedo || p.working} title="Ctrl+Shift+Z">
          {t('Redo')}
        </button>
      </div>
      <p className="muted status" aria-live="polite">
        {p.working ? t('Updating the map…') : p.editedHexes ? t('{n} hexes edited by hand', { n: num(p.editedHexes) }) : t('No hand edits to the land yet')}
      </p>
    </div>
  );
}

function LabelControls(p: Props) {
  const e = p.labelEdit ?? {};
  const curved = p.selectedLabel ? !p.selectedLabel.startsWith('province:') : false;
  const end = (what: string) => () => p.onAdjustLabelEnd(what);
  return (
    <div className="label-controls">
      {p.selectedLabel ? (
        <>
          <p className="label-controls__name">{p.selectedLabelName}</p>
          <Slider label={t('Size')} value={e.scale ?? 1} min={0.4} max={2.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => p.onAdjustLabel({ scale: v })} onEnd={end(t('Resize label'))} />
          {curved && (
            <>
              <Slider label={t('Curve')} value={e.bend ?? 0} min={-0.4} max={0.4} step={0.01} format={(v) => t(Math.abs(v) < 0.01 ? 'As drawn' : v > 0 ? 'Arched' : 'Sagging')} onChange={(v) => p.onAdjustLabel({ bend: v })} onEnd={end(t('Bend label'))} />
              <Slider label={t('Angle')} value={((e.angle ?? 0) * 180) / Math.PI} min={-60} max={60} step={1} format={(v) => `${Math.round(v)}°`} onChange={(v) => p.onAdjustLabel({ angle: (v * Math.PI) / 180 })} onEnd={end(t('Turn label'))} />
            </>
          )}
          <div className="history">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                p.onAdjustLabel({ hidden: true });
                p.onAdjustLabelEnd(t('Hide label'));
              }}
            >
              {t('Hide')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                p.onAdjustLabel(null);
                p.onAdjustLabelEnd(t('Reset label'));
              }}
            >
              {t('Reset')}
            </button>
          </div>
        </>
      ) : (
        <p className="hint">{t('Click a name on the map to adjust it.')}</p>
      )}
      {p.hiddenLabels > 0 && (
        <button type="button" className="btn btn--ghost btn--wide" onClick={p.onShowAllLabels}>
          {tn('Show {n} hidden name', 'Show {n} hidden names', p.hiddenLabels)}
        </button>
      )}
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; format(v: number): string; onChange(v: number): void; onEnd(): void }) {
  return (
    <label className="field">
      <span className="field__label">
        {props.label}
        <output>{props.format(props.value)}</output>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onPointerUp={props.onEnd}
        onKeyUp={props.onEnd}
        onBlur={props.onEnd}
      />
    </label>
  );
}

/** Small engraved glyphs, one per tool. */
export function ToolIcon({ tool }: { tool: ToolId }) {
  const paths: Record<ToolId, string> = {
    raise: 'M2 13 L7 5 L10 9 L12 7 L16 13 Z M9 2 v3 M7.5 3.5 L9 2 L10.5 3.5',
    lower: 'M2 6 L7 12 L10 9 L12 11 L16 6 M9 13 v3 M7.5 14.5 L9 16 L10.5 14.5',
    smooth: 'M2 11 C5 7, 8 7, 9 9 S13 11, 16 8',
    flatten: 'M2 11 H16 M4 8 L6 11 M8 7 L10 11 M12 8 L14 11',
    paint: 'M4 14 C3 11 6 10 7 11 C8 12 7 15 4 14 Z M7 11 L14 3 L15.5 4.5 L9 12',
    river: 'M3 2 C8 5 4 9 9 11 S12 15 16 16',
    'erase-river': 'M3 2 C8 5 4 9 9 11 S12 15 16 16 M4 13 L9 18 M9 13 L4 18',
    lake: 'M3 10 C3 6 7 5 9 6 C12 4 16 6 15 10 C15 14 10 15 8 14 C5 15 3 13 3 10 Z',
    drain: 'M3 10 C3 6 7 5 9 6 C12 4 16 6 15 10 M9 9 v7 M7 14 L9 16 L11 14',
    assign: 'M5 2 L9 4.5 L9 9 L5 11.5 L1 9 L1 4.5 Z M11 9 L15 11.5 L15 16 L11 13.5 M9 9 L11 9',
    split: 'M3 3 C7 6 6 12 3 15 M15 3 C11 6 12 12 15 15 M9 1 V17',
    merge: 'M2 4 C6 4 8 9 9 9 C8 9 6 14 2 14 M16 4 C12 4 10 9 9 9 C10 9 12 14 16 14',
    region: 'M2 3 H16 V15 H2 Z M2 9 H9 V15 M9 3 V9',
    realm: 'M9 1 L15 4 V10 C15 14 9 17 9 17 C9 17 3 14 3 10 V4 Z',
    label: 'M3 14 L7 4 L11 14 M4.6 10 H9.4 M12 6 H16 M12 10 H15',
    layer: 'M2 6 L9 2 L16 6 L9 10 Z M2 9.5 L9 13.5 L16 9.5 M2 13 L9 17 L16 13',
  };
  return (
    <svg viewBox="0 0 18 18" className="tool__icon" aria-hidden>
      <path d={paths[tool]} />
    </svg>
  );
}
