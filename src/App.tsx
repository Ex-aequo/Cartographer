import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PARAMS, type GenParams } from './model/types';
import { useMapWorker, type LoadedMap } from './state/useMapWorker';
import { MapView, type MapViewHandle, type Pick } from './ui/MapView';
import { SidePanel, WorldPanel, type PanelTab } from './ui/WorldPanel';
import { EditPanel } from './ui/EditPanel';
import { useEditor } from './state/useEditor';
import { Inspector } from './ui/Inspector';
import { Legend, ModeSwitch, Veil, ZoomLadder } from './ui/Controls';
import { TopBar } from './ui/TopBar';
import { LEVELS } from './ui/zoomLevels';
import type { MapMode } from './render/mapModes';
import type { Quality } from './render/MapRenderer';
import { gzip, mapToJSON } from './model/serialize';
import { buildGameExport } from './model/exportGame';

export function App() {
  const { generate, open, rederive, busy } = useMapWorker();
  const [tab, setTab] = useState<PanelTab>('world');
  const [params, setParams] = useState<GenParams>(DEFAULT_PARAMS);
  const [loaded, setLoaded] = useState<LoadedMap | null>(null);
  const [mode, setMode] = useState<MapMode>('political');
  const [quality, setQuality] = useState<Quality>(() => {
    try {
      const q = localStorage.getItem('carto.quality');
      if (q === 'high' || q === 'balanced' || q === 'fast') return q;
    } catch {
      /* storage unavailable: use the default */
    }
    return 'high';
  });
  const changeQuality = (q: Quality) => {
    setQuality(q);
    try {
      localStorage.setItem('carto.quality', q);
    } catch {
      /* not persisted */
    }
  };
  const [pick, setPick] = useState<Pick | null>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const viewRef = useRef<MapViewHandle>(null);
  const onEditError = useCallback((m: string) => setError(m), []);
  const editor = useEditor(loaded, setLoaded, rederive, onEditError);
  const { setSettings, undo, redo } = editor;
  const changeTab = (t: PanelTab) => {
    setTab(t);
    if (t !== 'edit') setSettings((s) => ({ ...s, tool: null }));
  };

  // editing shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (e.key === '[' || e.key === ']') {
        setSettings((s) => ({ ...s, radius: Math.min(20, Math.max(0.6, s.radius * (e.key === ']' ? 1.25 : 0.8))) }));
      } else if (e.key === 'Escape') {
        setSettings((s) => (s.tool ? { ...s, tool: null } : s));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, setSettings]);
  // only list the categories that actually occur in this world
  const presentCodes = useMemo(() => {
    if (!loaded || (mode !== 'biome' && mode !== 'terrain')) return undefined;
    const arr = mode === 'biome' ? loaded.map.hex.biome : loaded.map.hex.terrain;
    return new Set(Array.from(new Set(arr)));
  }, [loaded, mode]);

  const draw = useCallback(
    async (p: GenParams) => {
      setError(null);
      try {
        const l = await generate(p);
        setPick(null);
        setLoaded(l);
      } catch (e) {
        setError(`The world could not be drawn: ${(e as Error).message}`);
      }
    },
    [generate],
  );

  // first world on start
  useEffect(() => {
    draw(DEFAULT_PARAMS);
  }, [draw]);

  const onOpen = async (file: File) => {
    setError(null);
    try {
      const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      const text = head[0] === 0x1f && head[1] === 0x8b ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await file.text();
      const l = await open(text);
      setPick(null);
      setParams(l.map.meta.params);
      setLoaded(l);
    } catch (e) {
      setError(`That file could not be opened. ${(e as Error).message}`);
    }
  };

  const fileBase = () => (loaded ? `${loaded.map.meta.params.seed}`.replace(/[^\w-]+/g, '_') : 'map');

  const onSave = async () => {
    if (!loaded) return;
    const blob = await gzip(mapToJSON(loaded.map));
    download(blob, `${fileBase()}.cartomap`);
  };
  const onExportData = () => {
    if (!loaded) return;
    const json = JSON.stringify(buildGameExport(loaded.map));
    download(new Blob([json], { type: 'application/json' }), `${fileBase()}-gamedata.json`);
  };
  const onExportImage = async () => {
    const b = await viewRef.current?.snapshot();
    if (b) download(b, `${fileBase()}.png`);
  };

  // test and automation hook
  useEffect(() => {
    (window as any).__carto = {
      loaded: () => loaded,
      view: () => viewRef.current?.getView(),
      flyTo: (z: number, x?: number, y?: number) => viewRef.current?.flyTo(z, x, y),
      jumpTo: (z: number, x?: number, y?: number) => viewRef.current?.jumpTo(z, x, y),
      setMode,
      setUniform: (n: string, v: number) => viewRef.current?.setUniform(n, v),
      select: (p: Pick | null) => setPick(p),
      generate: (p: Partial<GenParams>) => draw({ ...DEFAULT_PARAMS, ...p }),
      editor: () => editor,
      setTab: changeTab,
    };
  });

  return (
    <div className="app">
      <MapView ref={viewRef} editor={editor.bridge} toolActive={!!editor.settings.tool} quality={quality} loaded={loaded} mode={mode} selected={pick} onSelect={setPick} onZoom={setZoom} />
      <TopBar quality={quality} onQuality={changeQuality} name={loaded?.map.meta.params.seed ?? ''} hasMap={!!loaded} onOpen={onOpen} onSave={onSave} onExportData={onExportData} onExportImage={onExportImage} />
      <SidePanel tab={tab} onTab={changeTab}>
        {tab === 'world' ? (
          <WorldPanel params={params} onChange={setParams} onGenerate={draw} busy={!!busy} hasEdits={editor.hasEdits} />
        ) : (
          <EditPanel
            settings={editor.settings}
            onSettings={setSettings}
            working={editor.working}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            undoLabel={editor.undoLabel}
            redoLabel={editor.redoLabel}
            onUndo={undo}
            onRedo={redo}
            editedHexes={editor.editedHexes}
          />
        )}
      </SidePanel>
      {loaded && pick && (
        <Inspector
          map={loaded.map}
          pick={pick}
          onClose={() => setPick(null)}
          onSelectProvince={(id) => {
            const p = loaded.map.provinces[id];
            setPick({ province: id, hex: p.capitalHex });
            viewRef.current?.flyTo(Math.max(zoom, LEVELS[2].target), p.center[0], p.center[1]);
          }}
        />
      )}
      {loaded && (
        <>
          <ZoomLadder
            zoom={zoom}
            onLevel={(i) => {
              if (i === 0) viewRef.current?.fit();
              else viewRef.current?.flyTo(LEVELS[i].target);
            }}
            onStep={(f) => viewRef.current?.flyTo(zoom * f)}
          />
          <ModeSwitch mode={mode} onMode={setMode} />
          <Legend mode={mode} present={presentCodes} />
        </>
      )}
      {busy && <Veil step={busy.step} fraction={busy.fraction} />}
      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="icon-btn" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
