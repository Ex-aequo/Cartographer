import { FORMAT_ID, FORMAT_VERSION, type MapData } from './types';

/**
 * Project files (.cartomap): gzip-compressed JSON. Typed arrays are stored as
 * base64 so the file stays a single self-describing document.
 */

const TA = { Float32Array, Int32Array, Uint8Array, Uint16Array, Int16Array, Int8Array } as const;
type TAName = keyof typeof TA;

function b64encode(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Heights are stored as 16-bit integers (step ≈ 0.00003, well under a metre). */
const HEIGHT_Q = 32767;

export function mapToJSON(map: MapData): string {
  const src = map.height.data;
  const q = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = Math.round(Math.max(-1, Math.min(1, src[i])) * HEIGHT_Q);
    // never let a sliver of sea round up to sea level (0 counts as land)
    q[i] = src[i] < 0 ? Math.min(-1, v) : v;
  }
  const packed = { ...map, version: FORMAT_VERSION, height: { ...map.height, data: q, quantized: HEIGHT_Q } };
  return JSON.stringify(packed, (_k, v) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const name = v.constructor.name as TAName;
      if (name in TA) return { $ta: name, b64: b64encode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    return v;
  });
}

export function mapFromJSON(text: string): MapData {
  const obj = JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.$ta === 'string' && typeof v.b64 === 'string') {
      const Ctor = TA[v.$ta as TAName];
      if (!Ctor) throw new Error(`Unknown array type ${v.$ta}`);
      const bytes = b64decode(v.b64);
      return new Ctor(bytes.buffer, bytes.byteOffset, bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
    }
    return v;
  });
  const map = validate(obj);
  // format 2: quantized heightfield
  const h = map.height as MapData['height'] & { quantized?: number };
  if (h.quantized) {
    const qd = h.data as unknown as Int16Array;
    const out = new Float32Array(qd.length);
    for (let i = 0; i < qd.length; i++) out[i] = qd[i] / h.quantized;
    map.height = { w: h.w, h: h.h, res: h.res, data: out };
  }
  // custom data layers (format 3); older files have none
  map.layers = Array.isArray(map.layers) ? map.layers.filter((l) => l && l.def && l.values instanceof Float32Array && l.locked instanceof Uint8Array) : [];
  map.version = FORMAT_VERSION;
  return map;
}

export function validate(obj: any): MapData {
  if (!obj || obj.format !== FORMAT_ID) throw new Error('This file is not a Cartographer map.');
  if (typeof obj.version !== 'number' || obj.version > FORMAT_VERSION)
    throw new Error(`This map was saved by a newer version of Cartographer (format ${obj.version}). Update the app to open it.`);
  const n = obj.grid?.cols * obj.grid?.rows;
  if (!n || obj.hex?.elevation?.length !== n) throw new Error('The map file is damaged: hex data does not match the grid size.');
  return obj as MapData;
}

export async function gzip(text: string): Promise<Blob> {
  if (typeof CompressionStream === 'undefined') return new Blob([text], { type: 'application/json' });
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export async function readMapFile(file: Blob): Promise<MapData> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let text: string;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = await file.text();
  }
  return mapFromJSON(text);
}
