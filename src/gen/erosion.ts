import type { Field } from '../model/types';
import { Rng } from '../util/rng';

/**
 * Droplet hydraulic erosion (after Hans Beyer / Sebastian Lague).
 * Thousands of raindrops run downhill, pick up soil where they speed up and
 * drop it where they slow down. Mountains come out with branching gullies and
 * valleys come out with soft alluvial floors, instead of raw noise.
 *
 * Only land is eroded, and land never sinks below sea level, so coastlines
 * stay where the generator put them.
 */
export interface ErosionOptions {
  /** droplets per land texel */
  density: number;
  lifetime: number;
  inertia: number;
  capacity: number;
  minCapacity: number;
  erodeSpeed: number;
  depositSpeed: number;
  evaporate: number;
  gravity: number;
  radius: number;
}

export const DEFAULT_EROSION: ErosionOptions = {
  density: 0.35,
  lifetime: 36,
  inertia: 0.06,
  capacity: 5,
  minCapacity: 0.002,
  erodeSpeed: 0.35,
  depositSpeed: 0.25,
  evaporate: 0.018,
  gravity: 6,
  radius: 2,
};

export function erode(f: Field, rng: Rng, strength: number, opt: ErosionOptions = DEFAULT_EROSION): void {
  if (strength <= 0) return;
  const { w, h, data } = f;
  // Heights are in "elevation units" over texel-sized steps; scale so slopes
  // are in a range the droplet constants are tuned for.
  const S = 6;
  for (let i = 0; i < data.length; i++) if (data[i] > 0) data[i] *= S;
  // land may be carved by at most ~45% of its height, so low coastal plains
  // keep their shape instead of being planed flat to sea level
  const floor = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) floor[i] = data[i] > 0 ? Math.max(0.002 * S, data[i] * 0.55) : 0;

  // brush: precomputed offsets and normalised weights
  const r = opt.radius;
  const bOff: number[] = [];
  const bW: number[] = [];
  let wsum = 0;
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > r) continue;
      const wt = 1 - d / r;
      bOff.push(x, y);
      bW.push(wt);
      wsum += wt;
    }
  for (let k = 0; k < bW.length; k++) bW[k] /= wsum;

  // droplets start on land, more of them where the land is high
  const starts: number[] = [];
  for (let i = 0; i < data.length; i++) if (data[i] > 0.05 * S) starts.push(i);
  if (!starts.length) return;
  const count = Math.round(starts.length * opt.density * strength);
  const minLand = 0.002 * S;

  for (let n = 0; n < count; n++) {
    const s = starts[Math.floor(rng.next() * starts.length)];
    let px = (s % w) + rng.next();
    let py = Math.floor(s / w) + rng.next();
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let life = 0; life < opt.lifetime; life++) {
      const ix = Math.floor(px);
      const iy = Math.floor(py);
      if (ix < 1 || iy < 1 || ix >= w - 2 || iy >= h - 2) break;
      const fx = px - ix;
      const fy = py - iy;
      const k = iy * w + ix;
      const h00 = data[k];
      const h10 = data[k + 1];
      const h01 = data[k + w];
      const h11 = data[k + w + 1];
      if (h00 <= 0 && h10 <= 0 && h01 <= 0 && h11 <= 0) break; // reached water
      const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
      const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      const hOld = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;

      dx = dx * opt.inertia - gx * (1 - opt.inertia);
      dy = dy * opt.inertia - gy * (1 - opt.inertia);
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) {
        const a = rng.next() * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a);
      } else {
        dx /= len;
        dy /= len;
      }
      px += dx;
      py += dy;
      const nx = Math.floor(px);
      const ny = Math.floor(py);
      if (nx < 1 || ny < 1 || nx >= w - 2 || ny >= h - 2) break;
      const nfx = px - nx;
      const nfy = py - ny;
      const nk = ny * w + nx;
      const hNew =
        data[nk] * (1 - nfx) * (1 - nfy) + data[nk + 1] * nfx * (1 - nfy) + data[nk + w] * (1 - nfx) * nfy + data[nk + w + 1] * nfx * nfy;
      const dh = hNew - hOld;

      const cap = Math.max(-dh * speed * water * opt.capacity, opt.minCapacity);
      if (sediment > cap || dh > 0) {
        // deposit at the old position (bilinear)
        const amt = dh > 0 ? Math.min(dh, sediment) : (sediment - cap) * opt.depositSpeed;
        sediment -= amt;
        // never build new land out of the sea
        if (data[k] > 0) data[k] += amt * (1 - fx) * (1 - fy);
        if (data[k + 1] > 0) data[k + 1] += amt * fx * (1 - fy);
        if (data[k + w] > 0) data[k + w] += amt * (1 - fx) * fy;
        if (data[k + w + 1] > 0) data[k + w + 1] += amt * fx * fy;
      } else {
        const amt = Math.min((cap - sediment) * opt.erodeSpeed, -dh);
        for (let b = 0; b < bW.length; b++) {
          const ex = ix + bOff[b * 2];
          const ey = iy + bOff[b * 2 + 1];
          if (ex < 0 || ey < 0 || ex >= w || ey >= h) continue;
          const ek = ey * w + ex;
          const cur = data[ek];
          const lim = Math.max(minLand, floor[ek]);
          if (cur <= lim) continue;
          const take = Math.min(amt * bW[b], cur - lim);
          data[ek] = cur - take;
          sediment += take;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * opt.gravity));
      water *= 1 - opt.evaporate;
    }
  }
  for (let i = 0; i < data.length; i++) if (data[i] > 0) data[i] /= S;
}
