import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PARAMS, type GenParams, type MapData } from './model/types';
import { useMapWorker, type LoadedMap } from './state/useMapWorker';
import { MapView, type MapViewHandle, type Pick } from './ui/MapView';
import { SidePanel, WorldPanel, type PanelTab } from './ui/WorldPanel';
import { EditPanel } from './ui/EditPanel';
import { DataPanel } from './ui/DataPanel';
import { SymbolsPanel } from './ui/SymbolsPanel';
import { useSymbols } from './state/useSymbols';
import { layerColors, layerCsv } from './model/layers';
import { zip } from './util/zip';
import { saveFile } from './platform';
import { ExportDialog, modeLabelOf, type DialogPart } from './ui/ExportDialog';
import { useEditor } from './state/useEditor';
import { Inspector } from './ui/Inspector';
import { Legend, ModeSwitch, Veil, ZoomLadder } from './ui/Controls';
import { TopBar } from './ui/TopBar';
import { LEVELS } from './ui/zoomLevels';
import { layerIdOf, type MapMode } from './render/mapModes';
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
  const [exporting, setExporting] = useState<DialogPart[] | null>(null);
  useEffect(() => {
    const on = (e: Event) => setError((e as CustomEvent<string>).detail);
    window.addEventListener('carto-error', on);
    return () => window.removeEventListener('carto-error', on);
  }, []);
  const viewRef = useRef<MapViewHandle>(null);
  const onEditError = useCallback((m: string) => setError(m), []);
  const editor = useEditor(loaded, setLoaded, rederive, onEditError);
  const { setSettings, undo, redo } = editor;
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  const sym = useSymbols(loaded, editor, tab === 'symbols');
  const changeTab = (t: PanelTab) => {
    setTab(t);
    if (t !== tab) {
      setSettings((s) => ({ ...s, tool: null }));
      sym.setArmed(null);
      sym.setSelected(null);
    }
  };

  // the custom layer shown as the map mode, if any
  const shownLayerId = layerIdOf(mode);
  const layers = loaded?.map.layers ?? [];
  const shownLayer = layers.find((l) => l.def.id === shownLayerId) ?? null;
  // a layer deleted (or undone away) while shown: back to the political map
  useEffect(() => {
    if (shownLayerId && loaded && !shownLayer) setMode('political');
  }, [shownLayerId, shownLayer, loaded]);
  const shownColors = useMemo(
    () => (loaded && shownLayer ? layerColors(loaded.map, shownLayer) : null),
    // values change in place: the editor revision says when
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, shownLayer, editor.revision],
  );

  const symRef = useRef(sym);
  symRef.current = sym;
  // editing shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Delete still removes a selected symbol while a slider or menu of its panel has focus
      const typing = target?.closest('textarea, input:not([type=range]):not([type=checkbox]):not([type=color])');
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && symRef.current.selected !== null) {
        e.preventDefault();
        symRef.current.remove();
        return;
      }
      if (target?.closest('input, select, textarea')) return;
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
        symRef.current.setArmed(null);
        symRef.current.setSelected(null);
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
  const onExportCsv = () => {
    if (!loaded || !loaded.map.layers.length) {
      setError('This map has no data layers yet. Add one in the Data tab.');
      return;
    }
    const files = loaded.map.layers.map((l) => ({ name: `${l.def.id}.csv`, data: layerCsv(loaded.map, l) }));
    download(new Blob([zip(files)], { type: 'application/zip' }), `${fileBase()}-layers.zip`);
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
      setActiveLayer,
      openExport: (parts: DialogPart[]) => setExporting(parts),
    };
  });

  return (
    <div className="app">
      <MapView ref={viewRef} editor={editor.bridge} toolActive={!!editor.settings.tool || (tab === 'symbols' && !!sym.armed)} revision={editor.revision} quality={quality} loaded={loaded} mode={mode} layerColors={shownColors} badgeLayer={shownLayer?.def.showIcons ? shownLayer : null} symbols={sym.bridge} selected={pick} onSelect={setPick} onZoom={setZoom} />
      <TopBar quality={quality} onQuality={changeQuality} name={loaded?.map.meta.params.seed ?? ''} hasMap={!!loaded} onOpen={onOpen} onSave={onSave}
        exports={[
          { label: 'Game data', hint: 'Hexes, provinces, realms and layers as JSON', run: onExportData },
          { label: 'Data layers', hint: 'One CSV table per layer, zipped', run: onExportCsv, disabled: !layers.length },
          { label: 'Image of this view', hint: 'PNG at screen resolution', run: onExportImage },
          { label: 'High-resolution image…', hint: 'The whole world, up to 16,384 px wide', run: () => setExporting(['image']) },
          { label: 'Export set…', hint: 'Image, province map, heightmaps, masks, tables', run: () => setExporting(['image', 'provinces', 'heightmap', 'terrain', 'tables', 'gamedata']) },
        ]}
      />
      <SidePanel tab={tab} onTab={changeTab}>
        {tab === 'world' ? (
          <WorldPanel params={params} onChange={setParams} onGenerate={draw} busy={!!busy} hasEdits={editor.hasEdits} />
        ) : tab === 'symbols' ? (
          loaded && (
            <SymbolsPanel
              map={loaded.map}
              revision={editor.revision}
              change={editor.change}
              armed={sym.armed}
              onArm={sym.setArmed}
              opts={sym.opts}
              onOpts={sym.setOpts}
              selected={sym.selectedPlacement}
              onAdjust={sym.adjust}
              onAdjustEnd={sym.endAdjust}
              onDelete={sym.remove}
              onDeselect={() => sym.setSelected(null)}
              onDownload={download}
              notify={setError}
            />
          )
        ) : tab === 'data' ? (
          loaded && (
            <DataPanel
              map={loaded.map}
              revision={editor.revision}
              activeId={activeLayer}
              onActive={setActiveLayer}
              shown={!!activeLayer && shownLayerId === activeLayer}
              onShow={(id) => setMode(id ? `layer:${id}` : 'political')}
              settings={editor.settings}
              onSettings={setSettings}
              change={editor.change}
              working={editor.working}
              canUndo={editor.canUndo}
              undoLabel={editor.undoLabel}
              onUndo={undo}
              onDownload={download}
              onExportCsv={onExportCsv}
              notify={setError}
            />
          )
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
            selectedLabel={editor.selectedLabel}
            selectedLabelName={labelName(loaded?.map, editor.selectedLabel)}
            labelEdit={editor.selectedLabel ? loaded?.map.labels?.[editor.selectedLabel] : undefined}
            hiddenLabels={Object.values(loaded?.map.labels ?? {}).filter((e) => e.hidden).length}
            onAdjustLabel={editor.adjustLabel}
            onAdjustLabelEnd={editor.endAdjustLabel}
            onShowAllLabels={() =>
              editor.change(
                'Show hidden names',
                (m) => {
                  for (const e of Object.values(m.labels ?? {})) delete e.hidden;
                },
                'instant',
              )
            }
          />
        )}
      </SidePanel>
      {loaded && pick && (
        <Inspector
          map={loaded.map}
          pick={pick}
          onClose={() => setPick(null)}
          onChange={tab === 'edit' ? editor.change : undefined}
          onLayerChange={tab === 'edit' || tab === 'data' ? editor.change : undefined}
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
          <ModeSwitch mode={mode} onMode={setMode} layers={layers.map((l) => ({ id: l.def.id, name: l.def.name }))} />
          <Legend mode={mode} present={presentCodes} layer={shownLayer} />
        </>
      )}
      {loaded && exporting && (
        <ExportDialog
          map={loaded.map}
          assets={loaded.assets}
          mode={mode}
          modeLabel={modeLabelOf(mode, layers)}
          layer={shownLayer && shownColors ? { colors: shownColors, badges: shownLayer.def.showIcons ? shownLayer : null } : null}
          initial={exporting}
          fileBase={fileBase()}
          onClose={() => setExporting(null)}
          onDownload={download}
        />
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

function labelName(map: MapData | undefined, key: string | null): string | null {
  if (!map || !key) return null;
  const [kind, id] = key.split(':');
  const n = Number(id);
  if (kind === 'realm') return `${map.realms[n]?.title} of ${map.realms[n]?.name}`;
  if (kind === 'region') return `Region of ${map.regions[n]?.name}`;
  return map.provinces[n]?.name ?? null;
}

function download(blob: Blob, name: string) {
  saveFile(blob, name).catch((e) => window.dispatchEvent(new CustomEvent('carto-error', { detail: `The file could not be saved: ${(e as Error).message}` })));
}
