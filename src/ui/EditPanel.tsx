import { TERRAIN_NAMES } from '../model/types';
import { TERRAIN_COLORS } from '../render/mapModes';
import { HEIGHT_TOOLS, PAINTABLE, TOOL_LABELS, type ToolId, type ToolSettings } from '../edit/session';

const GROUPS: { name: string; tools: ToolId[] }[] = [
  { name: 'Land', tools: ['raise', 'lower', 'smooth', 'flatten', 'paint'] },
  { name: 'Water', tools: ['river', 'erase-river', 'lake', 'drain'] },
];

const HINTS: Record<ToolId, string> = {
  raise: 'Drag to build land up. Hold still to keep building. Raised sea floor becomes new land.',
  lower: 'Drag to wear land down. Below sea level it floods.',
  smooth: 'Drag to soften rough ground.',
  flatten: 'Drag to level the ground to the height where you started.',
  paint: 'Drag to set the terrain of hexes, whatever their climate.',
  river: 'Draw from the source to the sea or another river. The land is cut so water runs downhill along your line.',
  'erase-river': 'Drag over a river to remove it from there up to its sources.',
  lake: 'Drag to sink the ground into a lake.',
  drain: 'Drag over water to turn it into low land.',
};

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
}

export function EditPanel(p: Props) {
  const s = p.settings;
  const set = (patch: Partial<ToolSettings>) => p.onSettings({ ...s, ...patch });
  const hexes = s.radius / 1.732;
  return (
    <div className="panel__body edit">
      {GROUPS.map((g) => (
        <fieldset key={g.name} className="field">
          <legend>{g.name}</legend>
          <div className="tools">
            {g.tools.map((t) => (
              <button key={t} type="button" className={`tool ${s.tool === t ? 'is-on' : ''}`} aria-pressed={s.tool === t} onClick={() => set({ tool: s.tool === t ? null : t })}>
                <ToolIcon tool={t} />
                {TOOL_LABELS[t]}
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      {s.tool ? <p className="hint">{HINTS[s.tool]} Right-drag or hold Space to move the map.</p> : <p className="hint">Pick a tool to start. Every change can be undone.</p>}

      {s.tool && s.tool !== 'river' && (
        <label className="field">
          <span className="field__label">
            Brush size
            <output>{hexes < 1.5 ? 'One hex' : `${Math.round(hexes * 2)} hexes across`}</output>
          </span>
          <input type="range" min={0.6} max={20} step={0.2} value={s.radius} onChange={(e) => set({ radius: Number(e.target.value) })} />
        </label>
      )}
      {s.tool && HEIGHT_TOOLS.includes(s.tool) && (
        <label className="field">
          <span className="field__label">
            Strength
            <output>{s.strength < 0.35 ? 'Gentle' : s.strength < 0.75 ? 'Medium' : 'Strong'}</output>
          </span>
          <input type="range" min={0.1} max={1} step={0.05} value={s.strength} onChange={(e) => set({ strength: Number(e.target.value) })} />
        </label>
      )}
      {s.tool === 'paint' && (
        <fieldset className="field">
          <legend>Terrain</legend>
          <div className="swatches">
            {PAINTABLE.map((t) => (
              <button key={t} type="button" className={`swatch ${s.terrain === t ? 'is-on' : ''}`} aria-pressed={s.terrain === t} onClick={() => set({ terrain: t })}>
                <i style={{ background: `rgb(${TERRAIN_COLORS[t].join(',')})` }} />
                {TERRAIN_NAMES[t]}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="history">
        <button type="button" className="btn btn--ghost" onClick={p.onUndo} disabled={!p.canUndo || p.working} title="Ctrl+Z">
          Undo{p.undoLabel ? `: ${p.undoLabel.toLowerCase()}` : ''}
        </button>
        <button type="button" className="btn btn--ghost" onClick={p.onRedo} disabled={!p.canRedo || p.working} title="Ctrl+Shift+Z">
          Redo
        </button>
      </div>
      <p className="muted status" aria-live="polite">
        {p.working ? 'Updating the map…' : p.editedHexes ? `${p.editedHexes.toLocaleString()} hexes edited by hand` : 'No hand edits yet'}
      </p>
    </div>
  );
}

/** Small engraved glyphs, one per tool. */
function ToolIcon({ tool }: { tool: ToolId }) {
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
  };
  return (
    <svg viewBox="0 0 18 18" className="tool__icon" aria-hidden>
      <path d={paths[tool]} />
    </svg>
  );
}
