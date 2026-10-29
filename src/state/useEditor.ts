import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Terrain, type MapData } from '../model/types';
import { EditSession, type ToolSettings } from '../edit/session';
import type { RenderAssets } from '../render/assets';
import type { LoadedMap } from './useMapWorker';
import type { EditBridge } from '../ui/MapView';

type Rebuild = (map: MapData, reuse: RenderAssets) => Promise<LoadedMap>;

/**
 * Owns the edit session: tool settings, the undo history, and the rebuild
 * that follows every stroke, undo and redo. One rebuild runs at a time;
 * strokes wait for it.
 */
export function useEditor(loaded: LoadedMap | null, setLoaded: (l: LoadedMap) => void, rebuild: Rebuild, onError: (msg: string) => void) {
  const session = useRef(new EditSession()).current;
  const [settings, setSettings] = useState<ToolSettings>({ tool: null, radius: 4, strength: 0.6, terrain: Terrain.Forest });
  const [working, setWorking] = useState(false);
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const workingRef = useRef(false);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  // a different world (new or opened) starts a fresh history
  useEffect(() => {
    if (loaded?.fresh) {
      session.reset();
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
        onError(`The map could not be updated: ${(e as Error).message}`);
      } finally {
        workingRef.current = false;
        setWorking(false);
        refresh();
      }
    },
    [rebuild, setLoaded, onError],
  );

  const finish = useCallback(() => {
    const rec = session.end();
    if (!rec) {
      refresh();
      return;
    }
    run((l) => session.commit(rec, l.map));
  }, [run, session]);

  const undo = useCallback(() => {
    const cur = loadedRef.current;
    if (!cur || workingRef.current || session.stroke) return;
    if (session.undo(cur.map)) run(() => {});
  }, [run, session]);

  const redo = useCallback(() => {
    const cur = loadedRef.current;
    if (!cur || workingRef.current || session.stroke) return;
    if (session.redo(cur.map)) run(() => {});
  }, [run, session]);

  const bridge: EditBridge = useMemo(
    () => ({
      settings: () => (settingsRef.current.tool ? settingsRef.current : null),
      session,
      ready: () => !workingRef.current,
      finish,
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
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    undoLabel: session.undoStack[session.undoStack.length - 1]?.label,
    redoLabel: session.redoStack[session.redoStack.length - 1]?.label,
    editedHexes,
    hasEdits: editedHexes > 0 || session.canUndo,
  };
}
