import type { MapData } from '../model/types';

/** Parts of an export set built by the export worker (the image is drawn on the main thread). */
export type ExportPart = 'provinces' | 'heightmap' | 'terrain' | 'tables' | 'gamedata';

export interface ExportRequest {
  id: number;
  map: MapData;
  parts: ExportPart[];
  provinceWidth: number;
  smooth: boolean;
  rasterWidth: number;
}

export type ExportResponse =
  | { id: number; type: 'progress'; label: string; fraction: number }
  | { id: number; type: 'done'; files: { name: string; data: Uint8Array }[] }
  | { id: number; type: 'error'; message: string };

let worker: Worker | null = null;
let nextId = 1;

/** Runs an export in the export worker. */
export function runExport(req: Omit<ExportRequest, 'id'>, onProgress: (label: string, fraction: number) => void): Promise<{ name: string; data: Uint8Array }[]> {
  worker ??= new Worker(new URL('../worker/exportWorker.ts', import.meta.url), { type: 'module' });
  const id = nextId++;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<ExportResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress(m.label, m.fraction);
      else {
        w.removeEventListener('message', onMsg);
        if (m.type === 'done') resolve(m.files);
        else reject(new Error(m.message));
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ ...req, id });
  });
}
