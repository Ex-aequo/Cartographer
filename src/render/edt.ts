/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher).
 * `seed[i]` true → distance 0. Returns distance in texels, capped at `cap`.
 */
export function distanceTransform(seed: Uint8Array, w: number, h: number, cap: number): Float32Array {
  const INF = 1e20;
  const n = w * h;
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = seed[i] ? 0 : INF;
  const size = Math.max(w, h);
  const z = new Float32Array(size + 1);
  const v = new Int32Array(size);
  const d = new Float32Array(size);
  const col = new Float32Array(size);

  // columns
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = f[y * w + x];
    edt1d(col, h, v, z, d);
    for (let y = 0; y < h; y++) f[y * w + x] = d[y];
  }
  // rows
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) col[x] = f[off + x];
    edt1d(col, w, v, z, d);
    for (let x = 0; x < w; x++) f[off + x] = Math.min(cap, Math.sqrt(d[x]));
  }
  return f;
}

function edt1d(f: Float32Array, n: number, v: Int32Array, z: Float32Array, d: Float32Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
