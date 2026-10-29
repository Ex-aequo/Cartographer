import { crc32 } from '../util/zip';

/**
 * A small PNG encoder: greyscale, RGB or RGBA, 8 or 16 bits per channel,
 * exact (no colour management), so province colours and heights come out
 * precisely as computed. Uses the platform's deflate (CompressionStream).
 */

export interface RawImage {
  width: number;
  height: number;
  /** 1 grey, 3 RGB, 4 RGBA */
  channels: 1 | 3 | 4;
  depth: 8 | 16;
  /** row-major samples, channels interleaved */
  data: Uint8Array | Uint16Array;
}

const COLOR_TYPE = { 1: 0, 3: 2, 4: 6 } as const;

export async function encodePng(img: RawImage): Promise<Uint8Array> {
  const { width, height, channels, depth, data } = img;
  const bpp = channels * (depth / 8);
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  // samples as big-endian bytes, each row "Sub"-filtered (smaller files for smooth data)
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    if (depth === 8) row.set((data as Uint8Array).subarray(y * width * channels, (y + 1) * width * channels));
    else {
      const d = data as Uint16Array;
      const o = y * width * channels;
      for (let i = 0; i < width * channels; i++) {
        row[i * 2] = d[o + i] >> 8;
        row[i * 2 + 1] = d[o + i] & 255;
      }
    }
    const out = y * (stride + 1);
    raw[out] = 1;
    for (let i = 0; i < stride; i++) raw[out + 1 + i] = (row[i] - (i >= bpp ? row[i - bpp] : 0)) & 255;
  }
  const idat = await deflate(raw);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = COLOR_TYPE[channels];
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const c = new Uint8Array(12 + body.length);
  const dv = new DataView(c.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
  c.set(body, 8);
  dv.setUint32(8 + body.length, crc32(c.subarray(4, 8 + body.length)));
  return c;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads back a PNG written by encodePng (for tests and checks). */
export async function decodePng(bytes: Uint8Array): Promise<RawImage> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  let width = 0;
  let height = 0;
  let depth: 8 | 16 = 8;
  let channels: 1 | 3 | 4 = 1;
  const idat: Uint8Array[] = [];
  while (p < bytes.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      const b = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = b.getUint32(0);
      height = b.getUint32(4);
      depth = body[8] as 8 | 16;
      channels = ({ 0: 1, 2: 3, 6: 4 } as Record<number, 1 | 3 | 4>)[body[9]];
    } else if (type === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  const stream = new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const bpp = channels * (depth / 8);
  const stride = width * bpp;
  const bytesOut = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? bytesOut[y * stride + i - bpp] : 0;
      const b = y > 0 ? bytesOut[(y - 1) * stride + i] : 0;
      bytesOut[y * stride + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : x) & 255;
    }
  }
  if (depth === 8) return { width, height, channels, depth, data: bytesOut };
  const d16 = new Uint16Array(width * height * channels);
  for (let i = 0; i < d16.length; i++) d16[i] = (bytesOut[i * 2] << 8) | bytesOut[i * 2 + 1];
  return { width, height, channels, depth, data: d16 };
}
