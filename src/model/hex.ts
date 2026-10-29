/** Pointy-top, odd-r offset hex grid helpers. Hex circumradius = 1 world unit. */

export const SQRT3 = Math.sqrt(3);

export interface Grid {
  cols: number;
  rows: number;
}

export function worldSize(g: Grid): { width: number; height: number } {
  return { width: SQRT3 * (g.cols + 0.5), height: 1.5 * g.rows + 0.5 };
}

export function hexCenterX(col: number, row: number): number {
  return SQRT3 * (col + 0.5 * (row & 1)) + SQRT3 / 2;
}
export function hexCenterY(row: number): number {
  return 1.5 * row + 1;
}

export function toAxial(col: number, row: number): [number, number] {
  return [col - (row - (row & 1)) / 2, row];
}

/** Hex index containing world point (x, y), or −1 outside the grid. */
export function hexAt(g: Grid, x: number, y: number): number {
  const px = x - SQRT3 / 2;
  const py = y - 1;
  const qf = (SQRT3 / 3) * px - py / 3;
  const rf = (2 / 3) * py;
  // cube rounding
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;
  let rx = Math.round(xf);
  const ry = Math.round(yf);
  let rz = Math.round(zf);
  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  const row = rz;
  const col = rx + (row - (row & 1)) / 2;
  if (row < 0 || row >= g.rows || col < 0 || col >= g.cols) return -1;
  return row * g.cols + col;
}

const EVEN = [
  [1, 0],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const ODD = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [0, 1],
  [1, 1],
];

/** Precomputed neighbour table: 6 entries per hex, −1 where off-grid. */
export function buildNeighbors(g: Grid): Int32Array {
  const n = g.cols * g.rows;
  const out = new Int32Array(n * 6).fill(-1);
  for (let row = 0; row < g.rows; row++) {
    const dirs = row & 1 ? ODD : EVEN;
    for (let col = 0; col < g.cols; col++) {
      const i = row * g.cols + col;
      for (let d = 0; d < 6; d++) {
        const c = col + dirs[d][0];
        const r = row + dirs[d][1];
        if (c >= 0 && c < g.cols && r >= 0 && r < g.rows) out[i * 6 + d] = r * g.cols + c;
      }
    }
  }
  return out;
}

/** Hex distance in steps. */
export function hexDistance(g: Grid, a: number, b: number): number {
  const [aq, ar] = toAxial(a % g.cols, Math.floor(a / g.cols));
  const [bq, br] = toAxial(b % g.cols, Math.floor(b / g.cols));
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Bilinear sample of a world-aligned field at world point (x, y). */
export function sampleField(f: { w: number; h: number; res: number; data: Float32Array }, x: number, y: number): number {
  const fx = Math.min(f.w - 1.001, Math.max(0, x * f.res - 0.5));
  const fy = Math.min(f.h - 1.001, Math.max(0, y * f.res - 0.5));
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const d = f.data;
  const k = j * f.w + i;
  const a = d[k] + (d[k + 1] - d[k]) * tx;
  const b = d[k + f.w] + (d[k + f.w + 1] - d[k + f.w]) * tx;
  return a + (b - a) * ty;
}
