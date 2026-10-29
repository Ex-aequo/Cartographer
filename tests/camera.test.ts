import { describe, expect, test } from 'vitest';
import { MAX_TILT, basisFor, projector, reliefAt } from '../src/render/camera';
import type { Field } from '../src/model/types';

const W = 1200;
const H = 800;

/** a smooth hill in the middle of a 100×80 world */
function hill(): Field {
  const w = 100;
  const h = 80;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.max(0, 1 - Math.hypot(x + 0.5 - 50, y + 0.5 - 40) / 25);
  return { w, h, res: 1, data };
}

describe('camera', () => {
  test('the flat view is the plain top-down map', () => {
    const p = projector({ cx: 50, cy: 40, zoom: 8 }, W, H, null);
    expect(p.pt(50, 40)).toEqual([600, 400, 8]);
    expect(p.pt(51, 41)).toEqual([608, 408, 8]);
    expect(p.unproject(608, 408)).toEqual([51, 41]);
  });

  test('3D at no tilt or turn, with flat land, matches the flat view', () => {
    const flat = projector({ cx: 50, cy: 40, zoom: 8 }, W, H, null);
    const d3 = projector({ cx: 50, cy: 40, zoom: 8, on3d: true, rot: 0, tilt: 0, relief: 0 }, W, H, null);
    for (const [x, y] of [
      [50, 40],
      [10, 5],
      [90, 70],
    ]) {
      const a = flat.pt(x, y)!;
      const b = d3.pt(x, y, 0)!;
      expect(b[0]).toBeCloseTo(a[0], 6);
      expect(b[1]).toBeCloseTo(a[1], 6);
      expect(b[2]).toBeCloseTo(a[2], 6);
    }
  });

  test('the view centre stays put and keeps its zoom when the camera tilts and turns', () => {
    for (const tilt of [0.3, MAX_TILT]) {
      const p = projector({ cx: 50, cy: 40, zoom: 8, on3d: true, rot: 0.7, tilt }, W, H, null);
      const c = p.pt(50, 40, 0)!;
      expect(c[0]).toBeCloseTo(600, 6);
      expect(c[1]).toBeCloseTo(400, 6);
      expect(c[2]).toBeCloseTo(8, 6);
    }
  });

  test('a click lands on the hill the player sees', () => {
    const field = hill();
    const v = { cx: 50, cy: 40, zoom: 9, on3d: true, rot: 0.4, tilt: 0.9, relief: reliefAt(1, 0) };
    const p = projector(v, W, H, field);
    for (const [x, y] of [
      [50, 40],
      [44, 36],
      [58, 47],
      [30, 30],
    ]) {
      const s = p.pt(x, y, p.ground(x, y))!;
      const back = p.unproject(s[0], s[1])!;
      expect(Math.hypot(back[0] - x, back[1] - y)).toBeLessThan(0.05);
    }
  });

  test('tilting looks toward the top of the screen; turning keeps north on a circle', () => {
    const b = basisFor({ cx: 0, cy: 0, zoom: 1, tilt: 0.5 }, H);
    // camera sits south of the centre (larger y) and looks north
    expect(b.pos[1]).toBeGreaterThan(0);
    expect(b.fwd[1]).toBeLessThan(0);
    const p = projector({ cx: 50, cy: 40, zoom: 8, on3d: true, rot: Math.PI / 2, tilt: 0 }, W, H, null);
    // a quarter turn: the point north of the centre is now to the left
    const n = p.pt(50, 30, 0)!;
    expect(n[0]).toBeLessThan(600);
    expect(n[1]).toBeCloseTo(400, 6);
  });

  test('the paper map stays flat', () => {
    expect(reliefAt(1, 1)).toBe(0);
    expect(reliefAt(1, 0)).toBeGreaterThan(0);
  });
});
