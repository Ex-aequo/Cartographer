/// <reference lib="webworker" />
import { generateMap } from '../gen/generate';
import { buildRenderAssets, transferablesOf } from '../render/assets';
import { mapFromJSON } from '../model/serialize';
import { rederive } from '../gen/rederive';
import type { GenParams, MapData } from '../model/types';

export type WorkerRequest =
  | { type: 'generate'; id: number; params: GenParams }
  | { type: 'open'; id: number; json: string }
  | { type: 'rederive'; id: number; map: MapData; reuse: { warp: Float32Array; warpW: number; warpH: number } };

export type WorkerResponse =
  | { type: 'progress'; id: number; step: string; fraction: number }
  | { type: 'done'; id: number; map: MapData; assets: ReturnType<typeof buildRenderAssets>; ms: number }
  | { type: 'error'; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const t0 = performance.now();
  const progress = (step: string, fraction: number) => ctx.postMessage({ type: 'progress', id: req.id, step, fraction } satisfies WorkerResponse);
  try {
    const map = req.type === 'generate' ? generateMap(req.params, progress) : req.type === 'open' ? mapFromJSON(req.json) : rederive(req.map);
    const assets = buildRenderAssets(map, req.type === 'rederive' ? () => {} : progress, req.type === 'rederive' ? req.reuse : undefined);
    const transfer = [...transferablesOf(assets), ...mapBuffers(map)];
    ctx.postMessage({ type: 'done', id: req.id, map, assets, ms: Math.round(performance.now() - t0) } satisfies WorkerResponse, transfer);
  } catch (err) {
    ctx.postMessage({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) } satisfies WorkerResponse);
  }
};

function mapBuffers(map: MapData): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView) => out.add(a.buffer as ArrayBuffer);
  Object.values(map.hex).forEach(add);
  add(map.height.data);
  add(map.baseTemp.data);
  add(map.moisture.data);
  if (map.edits) {
    add(map.edits.terrain);
    add(map.edits.riverBlock);
    add(map.edits.touched);
  }
  return [...out];
}
