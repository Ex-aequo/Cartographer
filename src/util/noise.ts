import { Rng } from './rng';

/** Seeded 2D simplex noise (Gustavson), returns roughly [-1, 1]. */
export class Simplex2 {
  private perm = new Uint8Array(512);
  private permMod12 = new Uint8Array(512);
  private static grad = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]);

  constructor(rng: Rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  noise(xin: number, yin: number): number {
    const F2 = 0.36602540378;
    const G2 = 0.2113248654;
    const g = Simplex2.grad;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi = this.permMod12[ii + this.perm[jj]] * 2;
      t0 *= t0;
      n += t0 * t0 * (g[gi] * x0 + g[gi + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi = this.permMod12[ii + i1 + this.perm[jj + j1]] * 2;
      t1 *= t1;
      n += t1 * t1 * (g[gi] * x1 + g[gi + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi = this.permMod12[ii + 1 + this.perm[jj + 1]] * 2;
      t2 *= t2;
      n += t2 * t2 * (g[gi] * x2 + g[gi + 1] * y2);
    }
    return 70 * n;
  }

  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * f + o * 17.31, y * f - o * 9.73);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1]: sharp crests for mountain chains. */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let prev = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(this.noise(x * f + o * 31.7, y * f + o * 11.3));
      n *= n;
      sum += n * amp * prev;
      norm += amp;
      prev = n;
      f *= 2.03;
      amp *= 0.5;
    }
    return sum / norm;
  }
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
