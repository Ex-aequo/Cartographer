import type { Field, GenParams } from '../model/types';
import { Rng } from '../util/rng';
import { Simplex2, smoothstep, clamp } from '../util/noise';

/** Texels per world unit for the art heightfield. */
export const HEIGHT_RES = 3;

/**
 * 4X game maps have few, big hexes; their heightfield gets more texels per
 * world unit so the land keeps the detail of a classic map of the same
 * screen size.
 */
export function heightResFor(p: GenParams, worldW: number): number {
  if (!p.game?.on) return HEIGHT_RES;
  return Math.min(14, Math.max(HEIGHT_RES, Math.round((HEIGHT_RES * 520) / worldW)));
}

interface Blob {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot: number;
  weight: number;
}

interface Range {
  pts: [number, number][];
  width: number;
  strength: number;
}

/**
 * Builds the continuous heightfield. Coordinates inside use units of map
 * height (Y in 0..1, X in 0..aspect) so templates behave the same at every
 * map size.
 */
export function generateHeightfield(p: GenParams, worldW: number, worldH: number, rngRoot: Rng): Field {
  const rng = rngRoot.fork('height');
  const nShape = new Simplex2(rng.fork('shape'));
  const nWarp = new Simplex2(rng.fork('warp'));
  const nDetail = new Simplex2(rng.fork('detail'));
  const nRidge = new Simplex2(rng.fork('ridge'));

  const aspect = worldW / worldH;
  const blobs = makeBlobs(p, aspect, rng.fork('blobs'));
  const holes = p.template === 'inland-sea' ? makeInlandSea(blobs, rng.fork('holes')) : [];
  const ranges = makeRanges(blobs, p, aspect, rng.fork('ranges'));

  const RES = heightResFor(p, worldW);
  const w = Math.ceil(worldW * RES);
  const h = Math.ceil(worldH * RES);
  const data = new Float32Array(w * h);
  const mtn = 0.25 + 0.9 * p.mountains;

  // Pass 1 (coarse, 1 texel per world unit): smooth large-scale quantities —
  // warp, continent mask, range influence, upland noise. These are the
  // expensive parts and vary slowly, so they are interpolated in pass 2.
  // coarse texels per world unit: 1 on classic maps, more on small 4X maps
  const C = RES / HEIGHT_RES;
  const cw = Math.ceil(worldW * C) + 2;
  const ch = Math.ceil(worldH * C) + 2;
  const cWx = new Float32Array(cw * ch);
  const cWy = new Float32Array(cw * ch);
  const cBase = new Float32Array(cw * ch);
  const cRidge = new Float32Array(cw * ch);
  const cUp = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    const Y = j / C / worldH;
    for (let i = 0; i < cw; i++) {
      const X = i / C / worldH;
      // Domain warp: breaks the ellipses into believable coastlines.
      const wx = X + 0.075 * nWarp.fbm(X * 2.2, Y * 2.2, 4) + 0.02 * nWarp.fbm(X * 9 + 3, Y * 9, 3);
      const wy = Y + 0.075 * nWarp.fbm(X * 2.2 + 11, Y * 2.2 - 7, 4) + 0.02 * nWarp.fbm(X * 9, Y * 9 + 5, 3);
      let mask = 0;
      for (const b of blobs) mask = softMax(mask, blobValue(b, wx, wy) * b.weight, 0.12);
      for (const b of holes) mask -= blobValue(b, wx, wy) * b.weight;
      let ridgeInfl = 0;
      for (const r of ranges) {
        const d = distToPolyline(wx, wy, r.pts);
        if (d > r.width * 3) continue;
        ridgeInfl = Math.max(ridgeInfl, Math.exp(-((d / r.width) ** 2)) * r.strength);
      }
      const k = j * cw + i;
      cWx[k] = wx;
      cWy[k] = wy;
      cBase[k] = mask * 0.95 - 0.42 + 0.3 * nShape.fbm(wx * 2.6, wy * 2.6, 5);
      cRidge[k] = ridgeInfl;
      cUp[k] = smoothstep(-0.2, 0.6, nShape.noise(wx * 3.1 + 40, wy * 3.1));
    }
  }
  // Cubic B-spline upsampling: bilinear would leave creases along the coarse
  // grid that hillshading turns into visible straight lines.
  const wx4 = new Float64Array(4);
  const wy4 = new Float64Array(4);
  let lastX = NaN;
  let lastY = NaN;
  let ix0 = 0;
  let iy0 = 0;
  const bspline = (t: number, out: Float64Array) => {
    const t2 = t * t;
    const t3 = t2 * t;
    out[0] = (1 - 3 * t + 3 * t2 - t3) / 6;
    out[1] = (4 - 6 * t2 + 3 * t3) / 6;
    out[2] = (1 + 3 * t + 3 * t2 - 3 * t3) / 6;
    out[3] = t3 / 6;
  };
  const prep = (fx: number, fy: number) => {
    if (fx === lastX && fy === lastY) return;
    lastX = fx;
    lastY = fy;
    ix0 = Math.floor(fx);
    iy0 = Math.floor(fy);
    bspline(fx - ix0, wx4);
    bspline(fy - iy0, wy4);
  };
  const bil = (a: Float32Array, fx: number, fy: number) => {
    prep(fx, fy);
    let sum = 0;
    for (let b = 0; b < 4; b++) {
      const j = Math.min(ch - 1, Math.max(0, iy0 - 1 + b));
      let row = 0;
      for (let c = 0; c < 4; c++) {
        const i = Math.min(cw - 1, Math.max(0, ix0 - 1 + c));
        row += a[j * cw + i] * wx4[c];
      }
      sum += row * wy4[b];
    }
    return sum;
  };

  // Pass 2 (full resolution): fine detail and mountain crests.
  for (let j = 0; j < h; j++) {
    const yw = (j + 0.5) / RES;
    const Y = yw / worldH;
    for (let i = 0; i < w; i++) {
      const xw = (i + 0.5) / RES;
      const X = xw / worldH;
      const wx = bil(cWx, xw * C, yw * C);
      const wy = bil(cWy, xw * C, yw * C);
      let v = bil(cBase, xw * C, yw * C);
      v += 0.09 * nDetail.fbm(wx * 11, wy * 11, 4);
      const landish = smoothstep(-0.05, 0.35, v);
      const ridgeInfl = bil(cRidge, xw * C, yw * C);
      const up = bil(cUp, xw * C, yw * C);
      // Mountain chains along range lines, plus scattered uplands.
      if (landish > 0.01 || ridgeInfl > 0.05) {
        const ridge = nRidge.ridged(wx * 7.5, wy * 7.5, 5);
        v += ridgeInfl * mtn * (0.15 + 0.85 * ridge) * 0.62 * (0.35 + 0.65 * landish);
        v += 0.16 * mtn * landish * smoothstep(0.45, 0.85, ridge) * up;
      }
      // Ocean margin around the world.
      const edge = Math.min(Math.min(X, aspect - X), Math.min(Y, 1 - Y));
      v -= 0.7 * (1 - smoothstep(0.0, 0.085, edge));
      data[j * w + i] = v;
    }
  }

  normalizeToSeaLevel(data, p.landFraction);
  return { w, h, res: RES, data };
}

function softMax(a: number, b: number, k: number): number {
  const hh = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return a * (1 - hh) + b * hh + k * hh * (1 - hh);
}

function blobValue(b: Blob, x: number, y: number): number {
  const dx = x - b.x;
  const dy = y - b.y;
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  const u = (dx * c + dy * s) / b.rx;
  const v = (-dx * s + dy * c) / b.ry;
  const d = Math.sqrt(u * u + v * v);
  return 1 - smoothstep(0.35, 1.15, d);
}

function makeBlobs(p: GenParams, aspect: number, rng: Rng): Blob[] {
  const blobs: Blob[] = [];
  const add = (x: number, y: number, r: number, el: number, weight = 1) => {
    blobs.push({ x, y, rx: r * el, ry: r / el, rot: rng.range(0, Math.PI), weight });
  };
  switch (p.template) {
    case 'pangaea': {
      add(aspect * rng.range(0.42, 0.58), rng.range(0.42, 0.58), 0.42, rng.range(1.1, 1.5));
      for (let k = 0; k < 4; k++) add(aspect * rng.range(0.25, 0.75), rng.range(0.25, 0.75), rng.range(0.15, 0.25), rng.range(0.8, 1.6));
      break;
    }
    case 'archipelago': {
      const n = rng.int(18, 30);
      for (let k = 0; k < n; k++) add(aspect * rng.range(0.08, 0.92), rng.range(0.1, 0.9), rng.range(0.05, 0.12), rng.range(0.7, 1.6), rng.range(0.8, 1.05));
      break;
    }
    case 'inland-sea': {
      add(aspect * 0.5, 0.5, 0.5, rng.range(1.3, 1.6));
      for (let k = 0; k < 3; k++) add(aspect * rng.range(0.2, 0.8), rng.range(0.25, 0.75), rng.range(0.2, 0.3), rng.range(0.8, 1.4));
      break;
    }
    default: {
      // continents: 2–4 large masses spread across the map, plus islands
      const n = rng.int(2, 4);
      const slots = Array.from({ length: n }, (_, k) => (k + 0.5) / n);
      rng.shuffle(slots);
      for (let k = 0; k < n; k++) {
        const cx = aspect * clamp(slots[k] + rng.range(-0.06, 0.06), 0.15, 0.85);
        const cy = rng.range(0.3, 0.7);
        const r = rng.range(0.2, 0.32) * (n === 2 ? 1.12 : 1);
        add(cx, cy, r, rng.range(0.75, 1.35));
        // lobes give peninsulas and irregular outlines
        for (let l = 0; l < 3; l++) {
          const a = rng.range(0, Math.PI * 2);
          add(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.75, r * rng.range(0.35, 0.6), rng.range(0.7, 1.5), 0.92);
        }
      }
      const isl = rng.int(4, 9);
      for (let k = 0; k < isl; k++) add(aspect * rng.range(0.08, 0.92), rng.range(0.1, 0.9), rng.range(0.035, 0.07), rng.range(0.7, 1.6), 0.9);
    }
  }
  return blobs;
}

function makeInlandSea(blobs: Blob[], rng: Rng): Blob[] {
  const b = blobs[0];
  return [{ x: b.x + rng.range(-0.05, 0.05), y: b.y + rng.range(-0.05, 0.05), rx: b.rx * 0.42, ry: b.ry * 0.34, rot: rng.range(0, Math.PI), weight: 1.1 }];
}

function makeRanges(blobs: Blob[], p: GenParams, aspect: number, rng: Rng): Range[] {
  const ranges: Range[] = [];
  const big = blobs.filter((b) => Math.max(b.rx, b.ry) > 0.12);
  for (const b of big) {
    const count = Math.round(rng.range(0.6, 1.6) + p.mountains * 1.8 * Math.max(b.rx, b.ry) * 3.2);
    for (let k = 0; k < count; k++) {
      // start somewhere inside the blob, wander in a consistent direction
      const a0 = rng.range(0, Math.PI * 2);
      const rr = rng.range(0.1, 0.7);
      let x = b.x + Math.cos(a0) * b.rx * rr;
      let y = b.y + Math.sin(a0) * b.ry * rr;
      let dir = rng.range(0, Math.PI * 2);
      const pts: [number, number][] = [[x, y]];
      const segs = rng.int(3, 7);
      const step = rng.range(0.04, 0.08);
      for (let s = 0; s < segs; s++) {
        dir += rng.range(-0.5, 0.5);
        x += Math.cos(dir) * step;
        y += Math.sin(dir) * step;
        pts.push([clamp(x, 0, aspect), clamp(y, 0, 1)]);
      }
      ranges.push({ pts, width: rng.range(0.018, 0.04), strength: rng.range(0.7, 1.15) });
    }
  }
  return ranges;
}

function distToPolyline(x: number, y: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const t = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    const dx = ax + vx * t - x;
    const dy = ay + vy * t - y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Rescales so the requested share is land: land 0..1, water −1..0. */
function normalizeToSeaLevel(data: Float32Array, landFraction: number): void {
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(data.length / 200000));
  for (let i = 0; i < data.length; i += stride) sample.push(data[i]);
  sample.sort((a, b) => a - b);
  const sea = sample[Math.floor((1 - landFraction) * (sample.length - 1))];
  const lo = sample[0];
  const hi = sample[Math.floor(0.9995 * (sample.length - 1))];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v >= sea) {
      const t = Math.min(1, (v - sea) / (hi - sea));
      // most land is lowland; peaks are rare
      data[i] = Math.pow(t, 1.45) * 0.98 + 0.002;
    } else {
      const t = Math.min(1, (sea - v) / (sea - lo));
      data[i] = -Math.pow(t, 0.75);
    }
  }
}
