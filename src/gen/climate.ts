import type { Field, GenParams } from '../model/types';
import { HEIGHT_RES, heightResFor } from './heightfield';
import { sampleField } from '../model/hex';
import { Rng } from '../util/rng';
import { Simplex2, clamp, smoothstep } from '../util/noise';

/** Texels per world unit for climate fields (GPU bilinear does the rest). */
export const CLIMATE_RES = 1;

/** Sea-level temperature field, °C. */
/** Climate texels per world unit: more on small 4X maps, so the climate keeps classic detail. */
function climateRes(p: GenParams, worldW: number): number {
  return (CLIMATE_RES * heightResFor(p, worldW)) / HEIGHT_RES;
}

export function generateTemperature(p: GenParams, worldW: number, worldH: number, rngRoot: Rng): Field {
  const n = new Simplex2(rngRoot.fork('temp'));
  const RES = climateRes(p, worldW);
  const w = Math.ceil(worldW * RES);
  const h = Math.ceil(worldH * RES);
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const t = (j + 0.5) / h;
    const base = p.tempNorth + (p.tempSouth - p.tempNorth) * Math.pow(t, 0.92);
    for (let i = 0; i < w; i++) {
      const X = (i + 0.5) / RES / worldH;
      data[j * w + i] = base + 4.5 * n.fbm(X * 3, t * 3, 3);
    }
  }
  return { w, h, res: RES, data };
}

/**
 * Rainfall from a simple prevailing-wind march: air picks up moisture over
 * water, drops it over land, and drops most of it on windward slopes, which
 * leaves rain shadows behind mountain chains.
 */
export function generateMoisture(p: GenParams, height: Field, temp: Field, worldW: number, worldH: number, rngRoot: Rng): Field {
  const rng = rngRoot.fork('moisture');
  const n = new Simplex2(rng);
  const RES = climateRes(p, worldW);
  const w = Math.ceil(worldW * RES);
  const h = Math.ceil(worldH * RES);
  const rain = new Float32Array(w * h);

  for (let j = 0; j < h; j++) {
    const lat = (j + 0.5) / h;
    // westerlies in the middle band, easterlies near the poles and tropics
    const east = lat > 0.18 && lat < 0.62;
    let hum = 0.9;
    let prevH = 0;
    for (let k = 0; k < w; k++) {
      const i = east ? k : w - 1 - k;
      const x = (i + 0.5) / RES;
      const y = (j + 0.5) / RES;
      const hh = sampleField(height, x, y);
      const tt = sampleField(temp, x, y);
      const cap = clamp((tt + 12) / 38, 0.35, 1);
      if (hh < 0) {
        hum = Math.min(cap, hum + 0.09);
        rain[j * w + i] = hum * 0.5;
        prevH = 0;
      } else {
        const uplift = Math.max(0, hh - prevH) * 9;
        let r = hum * (0.035 + uplift);
        r = Math.min(r, hum);
        hum -= r;
        hum = Math.min(cap, hum + r * 0.32); // vegetation recycling
        rain[j * w + i] = r * 9 + hum * 0.55;
        prevH = hh;
      }
    }
  }

  blur(rain, w, h, 3);
  blur(rain, w, h, 2);

  // Normalise over land, then shape: subtropical dry belt, noise, user multiplier.
  const landVals: number[] = [];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) if (sampleField(height, (i + 0.5) / RES, (j + 0.5) / RES) >= 0) landVals.push(rain[j * w + i]);
  landVals.sort((a, b) => a - b);
  const lo = landVals[Math.floor(landVals.length * 0.02)] ?? 0;
  const hi = landVals[Math.floor(landVals.length * 0.98)] ?? 1;
  const dryLat = 0.5 + 0.5 * (p.tempSouth > p.tempNorth ? 0.36 : -0.36);
  for (let j = 0; j < h; j++) {
    const lat = (j + 0.5) / h;
    const dry = Math.exp(-(((lat - dryLat) / 0.09) ** 2));
    for (let i = 0; i < w; i++) {
      const X = (i + 0.5) / RES / worldH;
      let m = (rain[j * w + i] - lo) / (hi - lo || 1);
      m = m * (1 - 0.42 * dry) + 0.16 * n.fbm(X * 4, lat * 4, 3);
      m *= p.rainfall;
      rain[j * w + i] = clamp(smoothstep(-0.05, 1.05, m), 0, 1);
    }
  }
  return { w, h, res: RES, data: rain };
}

function blur(a: Float32Array, w: number, h: number, r: number): void {
  const tmp = new Float32Array(a.length);
  for (let j = 0; j < h; j++) {
    let acc = 0;
    let cnt = 0;
    for (let i = -r; i < w + r; i++) {
      if (i + r < w) {
        acc += a[j * w + i + r];
        cnt++;
      }
      if (i - r - 1 >= 0) {
        acc -= a[j * w + i - r - 1];
        cnt--;
      }
      if (i >= 0 && i < w) tmp[j * w + i] = acc / cnt;
    }
  }
  for (let i = 0; i < w; i++) {
    let acc = 0;
    let cnt = 0;
    for (let j = -r; j < h + r; j++) {
      if (j + r < h) {
        acc += tmp[(j + r) * w + i];
        cnt++;
      }
      if (j - r - 1 >= 0) {
        acc -= tmp[(j - r - 1) * w + i];
        cnt--;
      }
      if (j >= 0 && j < h) a[j * w + i] = acc / cnt;
    }
  }
}
