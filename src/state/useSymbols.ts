import { t } from '../i18n';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { MapData } from '../model/types';
import { DEFAULT_PLACE, addPlacement, pinToHex, placementAt, type PlaceOptions, type Placement } from '../model/symbols';
import type { LoadedMap } from './useMapWorker';

/** What the map view needs to place, pick and drag symbols. */
export interface SymbolBridge {
  /** the Symbols tab is open: clicks place or pick symbols */
  active(): boolean;
  /** asset being stamped, with its options, for the preview under the pointer */
  armed(): { asset: string; opts: PlaceOptions } | null;
  selected(): number | null;
  /** pointer down on the map; true if it grabbed a symbol to drag */
  down(wx: number, wy: number, zoom: number): boolean;
  move(wx: number, wy: number, shift: boolean): void;
  up(): void;
  /** a click (no drag) on the map */
  click(wx: number, wy: number, zoom: number, shift: boolean): void;
}

interface Editor {
  change(label: string, mutate: (m: MapData) => void, kind?: 'instant'): void;
  live(mutate: (m: MapData) => void): void;
  endLive(label: string): void;
}

export function useSymbols(loaded: LoadedMap | null, editor: Editor, open: boolean) {
  const [armedAsset, setArmed] = useState<string | null>(null);
  const [opts, setOpts] = useState<PlaceOptions>(DEFAULT_PLACE);
  const [selected, setSelected] = useState<number | null>(null);
  const state = useRef({ armedAsset, opts, selected, open, loaded, editor });
  state.current = { armedAsset, opts, selected, open, loaded, editor };
  const drag = useRef<{ id: number; dx: number; dy: number; moved: boolean } | null>(null);

  const find = (m: MapData, id: number | null): Placement | undefined => (id === null ? undefined : m.symbols?.placements.find((p) => p.id === id));

  const bridge: SymbolBridge = useMemo(
    () => ({
      active: () => state.current.open,
      armed: () => (state.current.armedAsset ? { asset: state.current.armedAsset, opts: state.current.opts } : null),
      selected: () => state.current.selected,
      down(wx, wy, zoom) {
        const s = state.current;
        if (!s.loaded || s.armedAsset) return false;
        const p = placementAt(s.loaded.map, wx, wy, zoom);
        if (!p) return false;
        setSelected(p.id);
        drag.current = { id: p.id, dx: p.x - wx, dy: p.y - wy, moved: false };
        return true;
      },
      move(wx, wy, shift) {
        const d = drag.current;
        if (!d) return;
        d.moved = true;
        state.current.editor.live((m) => {
          const p = find(m, d.id);
          if (!p) return;
          // pinned symbols (or Shift) hop from hex to hex; free ones glide
          if (p.hex >= 0 || shift) pinToHex(m, p, wx, wy);
          else {
            p.x = wx + d.dx;
            p.y = wy + d.dy;
          }
        });
      },
      up() {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) state.current.editor.endLive(t('Move symbol'));
      },
      click(wx, wy, zoom, shift) {
        const s = state.current;
        if (!s.loaded) return;
        if (s.armedAsset) {
          const asset = s.armedAsset;
          let id = -1;
          s.editor.change(
            t('Place symbol'),
            (m) => {
              id = addPlacement(m, asset, wx, wy, s.opts, shift).id;
            },
            'instant',
          );
          if (id >= 0) setSelected(id);
          return;
        }
        setSelected(placementAt(s.loaded.map, wx, wy, zoom)?.id ?? null);
      },
    }),
    [],
  );

  const selectedPlacement = loaded ? find(loaded.map, selected) : undefined;

  /** live edit of the selected symbol (sliders); `end` records it */
  const adjust = useCallback(
    (patch: Partial<Placement>) => {
      const id = state.current.selected;
      state.current.editor.live((m) => {
        const p = find(m, id);
        if (p) Object.assign(p, patch);
      });
    },
    [],
  );
  const endAdjust = useCallback((label: string) => state.current.editor.endLive(label), []);

  const remove = useCallback(() => {
    const id = state.current.selected;
    if (id === null) return;
    state.current.editor.change(
      t('Delete symbol'),
      (m) => {
        if (m.symbols) m.symbols.placements = m.symbols.placements.filter((p) => p.id !== id);
      },
      'instant',
    );
    setSelected(null);
  }, []);

  return { bridge, armed: armedAsset, setArmed, opts, setOpts, selected, setSelected, selectedPlacement, adjust, endAdjust, remove };
}
