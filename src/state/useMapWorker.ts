import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenParams, MapData } from '../model/types';
import type { RenderAssets } from '../render/assets';
import type { WorkerRequest, WorkerResponse } from '../worker/mapWorker';

export interface LoadedMap {
  map: MapData;
  assets: RenderAssets;
  ms: number;
}

export interface Busy {
  step: string;
  fraction: number;
}

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

type Pending = { resolve: (m: LoadedMap) => void; reject: (e: Error) => void };

/** Runs generation and asset building off the main thread. */
export function useMapWorker() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const [busy, setBusy] = useState<Busy | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('../worker/mapWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setBusy({ step: msg.step, fraction: msg.fraction });
        return;
      }
      const p = pending.current.get(msg.id);
      pending.current.delete(msg.id);
      if (pending.current.size === 0) setBusy(null);
      if (!p) return;
      if (msg.type === 'done') p.resolve({ map: msg.map, assets: msg.assets, ms: msg.ms });
      else p.reject(new Error(msg.message));
    };
    w.onerror = (e) => {
      pending.current.forEach((p) => p.reject(new Error(e.message || 'The map worker stopped unexpectedly.')));
      pending.current.clear();
      setBusy(null);
    };
    worker.current = w;
    return () => {
      w.terminate();
      pending.current.clear();
    };
  }, []);

  const run = useCallback((req: DistributiveOmit<WorkerRequest, 'id'>, first: string) => {
    return new Promise<LoadedMap>((resolve, reject) => {
      const id = nextId.current++;
      pending.current.set(id, { resolve, reject });
      setBusy({ step: first, fraction: 0 });
      worker.current!.postMessage({ ...req, id } as WorkerRequest);
    });
  }, []);

  const generate = useCallback((params: GenParams) => run({ type: 'generate', params }, 'Raising continents'), [run]);
  const open = useCallback((json: string) => run({ type: 'open', json }, 'Unrolling the map'), [run]);

  return { generate, open, busy };
}
