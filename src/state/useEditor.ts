import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Terrain, type LabelEdit, type MapData } from '../model/types';
import { EditSession, type ChangeToken, type StepRecord, type ToolSettings } from '../edit/session';
import type { RenderAssets } from '../render/assets';
import type { LoadedMap } from './useMapWorker';
import type { EditBridge } from '../ui/MapView';

type Rebuild = (map: MapData, reuse: RenderAssets) => Promise<LoadedMap>;

/**
 * Owns the edit session: tool settings, the undo history, and the rebuild
 * that follows every stroke, change, undo and redo. One rebuild runs at a
 * time; strokes wait for it. Label placement needs no rebuild and is instant.
 */
export function useEditor(loaded: LoadedMap | null, setLoaded: (l: LoadedMap) => void, rebuild: Rebuild, notify: (msg: string) => void) {
  const session = useRef(new EditSession()).current;
  const [settings, setSettings] = useState<ToolSettings>({ tool: null, radius: 4, strength: 0.6, terrain: Terrain.Forest });
  const [working, setWorking] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  /** bumps whenever the map changed without a rebuild (labels), so the view redraws */
  const [revision, refresh] = useReducer((x: number) => x + 1, 0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const selectedRef = useRef(selectedLabel);
  selectedRef.current = selectedLabel;
  const workingRef = useRef(false);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  // a different world (new or opened) starts a fresh history
  useEffect(() => {
    if (loaded?.fresh) {
      session.reset();
      setSelectedLabel(null);
      refresh();
    }
  }, [loaded, session]);

  const run = useCallback(
    async (after: (l: LoadedMap) => void) => {
      const cur = loadedRef.current;
      if (!cur) return;
      workingRef.current = true;
      setWorking(true);
      try {
        const l = await rebuild(cur.map, cur.assets);
        after(l);
        setLoaded(l);
      } catch (e) {
        notify(`The map could not be updated: ${(e as Error).message}`);
      } finally {
        workingRef.current = false;
        setWorking(false);
        refresh();
      }
    },
    [rebuild, setLoaded, notify],
  );

  /** Puts a finished step on the history, rebuilding first unless it only moved labels. */
  const complete = useCallback(
    (rec: StepRecord | null) => {
      if (session.message) {
        notify(session.message);
        session.message = null;
      }
      const cur = loadedRef.current;
      if (!rec || !cur) {
        refresh();
        return;
      }
      if (rec.kind === 'instant') {
        session.commit(rec, cur.map);
        refresh();
        return;
      }
      run((l) => session.commit(rec, l.map));
    },
    [run, session, notify],
  );

  const finish = useCallback(() => complete(session.end()), [complete, session]);

  /** One undoable change from a panel (rename, recolour, new region …). */
  const change = useCallback(
    (label: string, mutate: (map: MapData) => void, kind?: 'instant') => {
      const cur = loadedRef.current;
      if (!cur || workingRef.current || session.stroke) return;
      complete(session.change(cur.map, label, () => mutate(cur.map), kind));
    },
    [complete, session],
  );

  // live label adjustments (sliders): change the map now, record once at the end
  const labelToken = useRef<ChangeToken | null>(null);
  const adjustLabel = useCallback(
    (patch: Partial<LabelEdit> | null) => {
      const cur = loadedRef.current;
      const key = selectedRef.current;
      if (!cur || !key) return;
      if (!labelToken.current) labelToken.current = session.startChange(cur.map);
      const labels = (cur.map.labels ??= {});
      if (patch === null) delete labels[key];
      else labels[key] = { ...(labels[key] ?? {}), ...patch };
      refresh();
    },
    [session],
  );
  const endAdjustLabel = useCallback(
    (label: string) => {
      const cur = loadedRef.current;
      const t = labelToken.current;
      labelToken.current = null;
      if (!cur || !t) return;
      complete(session.finishChange(cur.map, t, label, 'instant'));
    },
    [complete, session],
  );

  // live changes from drags and sliders (symbols): change now, record once at the end
  const liveToken = useRef<ChangeToken | null>(null);
  const live = useCallback(
    (mutate: (map: MapData) => void) => {
      const cur = loadedRef.current;
      if (!cur) return;
      if (!liveToken.current) liveToken.current = session.startChange(cur.map);
      mutate(cur.map);
      refresh();
    },
    [session],
  );
  const endLive = useCallback(
    (label: string) => {
      const cur = loadedRef.current;
      const t = liveToken.current;
      liveToken.current = null;
      if (!cur || !t) return;
      complete(session.finishChange(cur.map, t, label, 'instant'));
    },
    [complete, session],
  );

  const replay = useCallback(
    (dir: 'undo' | 'redo') => {
      const cur = loadedRef.current;
      if (!cur || workingRef.current || session.stroke) return;
      const rec = dir === 'undo' ? session.undo(cur.map) : session.redo(cur.map);
      if (!rec) return;
      if (rec.kind === 'instant') refresh();
      else run(() => {});
    },
    [run, session],
  );
  const undo = useCallback(() => replay('undo'), [replay]);
  const redo = useCallback(() => replay('redo'), [replay]);

  const bridge: EditBridge = useMemo(
    () => ({
      settings: () => (settingsRef.current.tool ? settingsRef.current : null),
      session,
      ready: () => !workingRef.current,
      finish,
      selectedLabel: () => selectedRef.current,
      selectLabel: (k: string | null) => setSelectedLabel(k),
    }),
    [session, finish],
  );

  const editedHexes = useMemo(() => {
    const t = loaded?.map.edits?.touched;
    if (!t) return 0;
    let n = 0;
    for (let i = 0; i < t.length; i++) if (t[i]) n++;
    return n;
  }, [loaded]);

  return {
    settings,
    setSettings,
    working,
    bridge,
    undo,
    redo,
    change,
    adjustLabel,
    endAdjustLabel,
    live,
    endLive,
    selectedLabel,
    setSelectedLabel,
    revision,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    undoLabel: session.undoStack[session.undoStack.length - 1]?.label,
    redoLabel: session.redoStack[session.redoStack.length - 1]?.label,
    editedHexes,
    hasEdits: editedHexes > 0 || session.canUndo,
  };
}
