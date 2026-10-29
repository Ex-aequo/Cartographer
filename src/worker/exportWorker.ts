/// <reference lib="webworker" />
import type { MapData } from '../model/types';
import { encodePng } from '../export/png';
import { heightmaps, provinceMap, riverMask, tables, terrainMaps } from '../export/maps';
import { layerCsv } from '../model/layers';
import { buildGameExport } from '../model/exportGame';
import type { ExportPart, ExportRequest, ExportResponse } from '../export/request';

/** Builds the engine maps and tables of an export set, off the main thread. */

const post = (m: ExportResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, map, parts, provinceWidth, smooth, rasterWidth } = e.data;
  try {
    const files: { name: string; data: Uint8Array }[] = [];
    const want = (p: ExportPart) => parts.includes(p);
    const steps = parts.length;
    let done = 0;
    const progress = (label: string, f = 0) => post({ id, type: 'progress', label, fraction: (done + f) / steps });
    const enc = new TextEncoder();
    if (want('provinces')) {
      progress('Drawing the province map');
      const pm = provinceMap(map as MapData, provinceWidth, smooth, (f) => progress('Drawing the province map', f * 0.85));
      progress('Compressing the province map', 0.9);
      files.push({ name: 'provinces.png', data: await encodePng(pm.image) }, { name: 'definition.csv', data: enc.encode(pm.definition) });
      done++;
    }
    if (want('heightmap')) {
      progress('Writing heightmaps');
      const { h16, h8 } = heightmaps(map, rasterWidth);
      files.push({ name: 'heightmap.png', data: await encodePng(h16) }, { name: 'heightmap_8bit.png', data: await encodePng(h8) });
      done++;
    }
    if (want('terrain')) {
      progress('Writing terrain masks');
      const t = terrainMaps(map, rasterWidth);
      files.push({ name: 'terrain.png', data: await encodePng(t.index) }, { name: 'water.png', data: await encodePng(t.water) });
      for (const mk of t.masks) files.push({ name: `masks/${mk.name}.png`, data: await encodePng(mk.image) });
      files.push({ name: 'rivers.png', data: await encodePng(riverMask(map, rasterWidth)) });
      done++;
    }
    if (want('tables')) {
      progress('Writing tables');
      for (const [name, text] of Object.entries(tables(map))) files.push({ name: `csv/${name}`, data: enc.encode(text) });
      for (const l of map.layers ?? []) files.push({ name: `layers/${l.def.id}.csv`, data: enc.encode(layerCsv(map, l)) });
      done++;
    }
    if (want('gamedata')) {
      progress('Writing game data');
      files.push({ name: 'gamedata.json', data: enc.encode(JSON.stringify(buildGameExport(map))) });
      done++;
    }
    post({ id, type: 'done', files }, files.map((f) => f.data.buffer as ArrayBuffer));
  } catch (err) {
    post({ id, type: 'error', message: (err as Error).message });
  }
};
