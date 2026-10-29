import type { Field } from '../model/types';
import { sampleField } from '../model/hex';

/**
 * The map camera. Flat (the default) is the plain top-down view: one world
 * unit is `zoom` px, nothing else. In 3D the camera orbits the view centre:
 * `rot` turns the map, `tilt` leans the camera from straight down toward the
 * horizon, and `relief` lifts the land (world units of height per unit of
 * elevation). The shader uses the same maths, so a point projected here lands
 * on the pixel that draws it, and a click unprojects onto the ground the
 * player sees.
 */

export interface View {
  /** world units */
  cx: number;
  cy: number;
  /** CSS px per world unit at the view centre */
  zoom: number;
  /** radians, clockwise; 0 = north up */
  rot?: number;
  /** radians from straight down; 0 = top-down */
  tilt?: number;
  /** world units of height for elevation 1 (0 = flat land) */
  relief?: number;
  /** 3D view on */
  on3d?: boolean;
}

/** Vertical field of view in 3D. */
export const FOV = (34 * Math.PI) / 180;
export const MAX_TILT = (62 * Math.PI) / 180;

export type Vec3 = [number, number, number];

export interface CameraBasis {
  pos: Vec3;
  right: Vec3;
  up: Vec3;
  fwd: Vec3;
  /** px from the eye to the screen, for the given viewport height */
  focal: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const is3d = (v: View) => !!v.on3d;

/** Camera vectors for a view in a viewport `h` px high (CSS or device px alike). */
export function basisFor(v: View, h: number): CameraBasis {
  const focal = h / 2 / Math.tan(FOV / 2);
  const r = v.rot ?? 0;
  const t = v.tilt ?? 0;
  const D = focal / v.zoom; // distance at which the centre has `zoom` px per unit
  const R: Vec3 = [Math.cos(r), Math.sin(r), 0];
  const U: Vec3 = [Math.sin(r), -Math.cos(r), 0]; // "up the screen" along the ground
  const pos: Vec3 = [v.cx - U[0] * D * Math.sin(t), v.cy - U[1] * D * Math.sin(t), D * Math.cos(t)];
  const fwd: Vec3 = [U[0] * Math.sin(t), U[1] * Math.sin(t), -Math.cos(t)];
  const up: Vec3 = [U[0] * Math.cos(t), U[1] * Math.cos(t), Math.sin(t)];
  return { pos, right: R, up, fwd, focal };
}

export interface Projector {
  /** world point → CSS px, with the local scale (px per world unit); null when behind the camera */
  pt(x: number, y: number, z?: number): [number, number, number] | null;
  /** ground height (world units) under a world point */
  ground(x: number, y: number): number;
  /** screen px → world point on the land (null when the ray misses) */
  unproject(sx: number, sy: number): [number, number] | null;
  /** screen px → world point on the flat plane at height z (null above the horizon) */
  plane(sx: number, sy: number, z?: number): [number, number] | null;
  /** the view's rotation, for text and symbols that turn with the map */
  rot: number;
  /** vertical squash of things lying flat on the map (1 = top-down) */
  squash: number;
  flat: boolean;
}

/** Height of the land in world units (sea stays at 0). */
export function groundHeight(height: Field | null, relief: number, x: number, y: number): number {
  if (!height || relief <= 0) return 0;
  return Math.max(0, sampleField(height, x, y)) * relief;
}

export function projector(v: View, cssW: number, cssH: number, height: Field | null): Projector {
  if (!is3d(v)) {
    const z = v.zoom;
    return {
      pt: (x, y) => [(x - v.cx) * z + cssW / 2, (y - v.cy) * z + cssH / 2, z],
      ground: () => 0,
      unproject: (sx, sy) => [v.cx + (sx - cssW / 2) / z, v.cy + (sy - cssH / 2) / z],
      plane: (sx, sy) => [v.cx + (sx - cssW / 2) / z, v.cy + (sy - cssH / 2) / z],
      rot: 0,
      squash: 1,
      flat: true,
    };
  }
  const b = basisFor(v, cssH);
  const relief = v.relief ?? 0;
  const ground = (x: number, y: number) => groundHeight(height, relief, x, y);
  const pt = (x: number, y: number, z = 0): [number, number, number] | null => {
    const d: Vec3 = [x - b.pos[0], y - b.pos[1], z - b.pos[2]];
    const zc = dot(d, b.fwd);
    if (zc <= 1e-3) return null;
    const s = b.focal / zc;
    return [cssW / 2 + dot(d, b.right) * s, cssH / 2 - dot(d, b.up) * s, s];
  };
  const ray = (sx: number, sy: number): Vec3 | null => {
    const ox = sx - cssW / 2;
    const oy = sy - cssH / 2;
    const dir: Vec3 = [b.fwd[0] * b.focal + b.right[0] * ox - b.up[0] * oy, b.fwd[1] * b.focal + b.right[1] * ox - b.up[1] * oy, b.fwd[2] * b.focal + b.right[2] * ox - b.up[2] * oy];
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    dir[0] /= len;
    dir[1] /= len;
    dir[2] /= len;
    return dir[2] >= -1e-4 ? null : dir;
  };
  const unproject = (sx: number, sy: number): [number, number] | null => {
    const dir = ray(sx, sy);
    return dir ? marchRay(b.pos, dir, relief, (x, y) => ground(x, y)) : null;
  };
  const plane = (sx: number, sy: number, z = 0): [number, number] | null => {
    const dir = ray(sx, sy);
    if (!dir) return null;
    const t = (z - b.pos[2]) / dir[2];
    return t > 0 ? [b.pos[0] + dir[0] * t, b.pos[1] + dir[1] * t] : null;
  };
  return { pt, ground, unproject, plane, rot: v.rot ?? 0, squash: Math.cos(v.tilt ?? 0), flat: false };
}

/**
 * Walks a ray down from the camera until it meets the land: coarse steps
 * between the top of the highest mountain and sea level, then a binary
 * search for the exact surface. The shader does the same per pixel.
 */
export function marchRay(o: Vec3, d: Vec3, relief: number, ground: (x: number, y: number) => number, steps = 64): [number, number] {
  const tBot = (0 - o[2]) / d[2];
  if (relief <= 0) return [o[0] + d[0] * tBot, o[1] + d[1] * tBot];
  const tTop = Math.max(0, (relief - o[2]) / d[2]);
  let prev = tTop;
  const above = (t: number) => o[2] + d[2] * t > ground(o[0] + d[0] * t, o[1] + d[1] * t);
  for (let k = 1; k <= steps; k++) {
    const t = tTop + ((tBot - tTop) * k) / steps;
    if (!above(t)) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (above(mid)) lo = mid;
        else hi = mid;
      }
      return [o[0] + d[0] * hi, o[1] + d[1] * hi];
    }
    prev = t;
  }
  return [o[0] + d[0] * tBot, o[1] + d[1] * tBot];
}

/** The relief actually used at a zoom: none on the paper map, full on terrain. */
export function reliefAt(strength: number, paperMix: number): number {
  return 3.2 * strength * (1 - paperMix);
}

/** The 3D settings the player controls; the view adds them on top of pan and zoom. */
export interface Camera3D {
  on: boolean;
  /** radians */
  rot: number;
  /** radians, 0..MAX_TILT */
  tilt: number;
  /** relief strength, 0..2 (1 = natural) */
  height: number;
}

export const DEFAULT_CAMERA: Camera3D = { on: false, rot: 0, tilt: (48 * Math.PI) / 180, height: 1 };

/** Wraps an angle into −π..π. */
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
