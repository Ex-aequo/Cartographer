import { FORMAT_ID, FORMAT_VERSION, type MapData } from './types';

/**
 * Project files (.cartomap): gzip-compressed JSON. Typed arrays are stored as
 * base64 so the file stays a single self-describing document.
 */

const TA = { Float32Array, Int32Array, Uint8Array, Uint16Array } as const;
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

export function mapToJSON(map: MapData): string {
  return JSON.stringify(map, (_k, v) => {
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
  return validate(obj);
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
