import { describe, expect, test } from 'vitest';
import { generateMap } from '../src/gen/generate';
import { rederive } from '../src/gen/rederive';
import { EditSession, type ToolSettings } from '../src/edit/session';
import { DEFAULT_PARAMS, HexFlag, Terrain, type GenParams, type MapData } from '../src/model/types';
import { buildNeighbors, hexCenterX, hexCenterY, sampleField } from '../src/model/hex';
import { mapFromJSON, mapToJSON } from '../src/model/serialize';
import { buildRenderAssets, ownerAt } from '../src/render/assets';

const P: GenParams = { ...DEFAULT_PARAMS, cols: 110, rows: 70, realmCount: 10, seed: 'edit-tests' };
const fresh = () => generateMap(P);
const center = (m: MapData, h: number): [number, number] => {
  const row = Math.floor(h / m.grid.cols);
  return [hexCenterX(h % m.grid.cols, row), hexCenterY(row)];
};
const settings = (tool: ToolSettings['tool'], extra: Partial<ToolSettings> = {}): ToolSettings => ({ tool, radius: 3, strength: 1, terrain: Terrain.Forest, ...extra });

/** Apply a stroke, rebuild, commit: what the app does. */
function stroke(s: EditSession, m: MapData, set: ToolSettings, pts: [number, number][], repeat = 1): MapData {
  s.begin(m, set, pts[0][0], pts[0][1]);
  for (let r = 0; r < repeat; r++) {
    for (const p of pts.slice(1)) s.move(p[0], p[1]);
    s.hold();
  }
  const rec = s.end();
  if (!rec) return m;
  const out = rederive(m);
  s.commit(rec, out);
  return out;
}

function invariants(m: MapData) {
  const nbr = buildNeighbors(m.grid);
  const n = m.hex.province.length;
  for (let i = 0; i < n; i++) {
    const land = (m.hex.flags[i] & HexFlag.Land) !== 0;
    expect(m.hex.province[i] >= 0, `hex ${i} land=${land}`).toBe(land);
  }
  for (const p of m.provinces) {
    if (p.retired) {
      expect(p.hexes.length).toBe(0);
      continue;
    }
    expect(p.hexes.length).toBeGreaterThan(0);
    for (const h of p.hexes) expect(m.hex.province[h]).toBe(p.id);
    expect(p.hexes).toContain(p.capitalHex);
    // contiguous
    const set = new Set(p.hexes);
    const seen = new Set([p.hexes[0]]);
    const st = [p.hexes[0]];
    while (st.length) {
      const i = st.pop()!;
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j >= 0 && set.has(j) && !seen.has(j)) {
          seen.add(j);
          st.push(j);
        }
      }
    }
    expect(seen.size).toBe(p.hexes.length);
    for (const q of p.neighbors) expect(m.provinces[q].neighbors).toContain(p.id);
    expect(m.regions[p.region].provinces).toContain(p.id);
  }
  for (const r of m.rivers) {
    const end = r.hexes[r.hexes.length - 1];
    expect(!(m.hex.flags[end] & HexFlag.Land) || (m.hex.flags[end] & HexFlag.River) !== 0).toBe(true);
  }
}

describe('rebuilding after edits', () => {
  test('an untouched map rebuilds identically', () => {
    const m = fresh();
    const r = rederive(m);
    expect(Array.from(r.hex.province)).toEqual(Array.from(m.hex.province));
    expect(Array.from(r.hex.terrain)).toEqual(Array.from(m.hex.terrain));
    expect(Array.from(r.hex.flags)).toEqual(Array.from(m.hex.flags));
    expect(r.rivers.map((x) => x.name)).toEqual(m.rivers.map((x) => x.name));
  });

  test('raising an island in the open sea makes a new province', () => {
    const m = fresh();
    // the deepest water hex is far from any coast
    let deep = 0;
    for (let i = 0; i < m.hex.elevation.length; i++) if (m.hex.elevation[i] < m.hex.elevation[deep]) deep = i;
    const [x, y] = center(m, deep);
    const s = new EditSession();
    const before = m.provinces.length;
    const out = stroke(s, m, settings('raise', { radius: 4 }), [[x, y]], 120);
    expect(out.hex.flags[deep] & HexFlag.Land).toBeTruthy();
    expect(out.provinces.length).toBeGreaterThan(before);
    invariants(out);
  });

  test('flooding a province retires it and keeps every other id', () => {
    const m = fresh();
    const victim = m.provinces.reduce((a, b) => (b.hexes.length < a.hexes.length ? b : a));
    const s = new EditSession();
    let cur = m;
    s.begin(cur, settings('lower', { radius: 2.2 }), ...center(cur, victim.hexes[0]));
    for (let rep = 0; rep < 160; rep++) for (const h of victim.hexes) s.move(...center(cur, h));
    const rec = s.end()!;
    cur = rederive(cur);
    s.commit(rec, cur);
    expect(cur.provinces[victim.id].retired).toBe(true);
    expect(cur.provinces.length).toBeGreaterThanOrEqual(m.provinces.length);
    for (const p of m.provinces) if (p.id !== victim.id && !cur.provinces[p.id].retired) expect(cur.provinces[p.id].name).toBe(p.name);
    invariants(cur);
  });

  test('painted terrain wins over climate and shows in the art fields', () => {
    const m = fresh();
    const land = m.provinces[3].hexes[0];
    const s = new EditSession();
    const out = stroke(s, m, settings('paint', { radius: 0.5, terrain: Terrain.Desert }), [center(m, land)]);
    expect(out.hex.terrain[land]).toBe(Terrain.Desert);
    const a = buildRenderAssets(out);
    const [x, y] = center(out, land);
    const k = Math.round(y) * a.farmW + Math.round(x);
    expect(a.paint[k * 4 + 2]).toBeGreaterThan(0.5);
    expect(a.paint[k * 4 + 1]).toBeLessThan(0.1);
  });

  test('a drawn river runs along the drawn line and reaches water', () => {
    const m = fresh();
    // from a high inland hex towards the nearest coast
    const big = m.provinces.reduce((a, b) => (b.hexes.length > a.hexes.length ? b : a));
    const start = big.hexes.reduce((a, b) => (m.hex.elevation[b] > m.hex.elevation[a] && !(m.hex.flags[b] & HexFlag.River) ? b : a));
    const [sx, sy] = center(m, start);
    const s = new EditSession();
    const pts: [number, number][] = [];
    for (let k = 0; k <= 10; k++) pts.push([sx + k * 0.9, sy]);
    const out = stroke(s, m, settings('river'), pts);
    expect(out.hex.flags[start] & HexFlag.River).toBeTruthy();
    const path = out.edits!.riverPaths[0];
    expect(path.length).toBeGreaterThan(3);
    for (const h of path) if (out.hex.flags[h] & HexFlag.Land) expect(out.hex.flags[h] & HexFlag.River).toBeTruthy();
    invariants(out);
  });

  test('a river drawn uphill still flows along the line and out to sea', () => {
    const m = fresh();
    // start on the coast and draw inland, towards the highest hex of a big province
    const big = m.provinces.filter((p) => p.coastal).reduce((a, b) => (b.hexes.length > a.hexes.length ? b : a));
    const coast = big.hexes.find((h) => m.hex.flags[h] & HexFlag.Coastal)!;
    const peak = big.hexes.reduce((a, b) => (m.hex.elevation[b] > m.hex.elevation[a] ? b : a));
    const [ax, ay] = center(m, coast);
    const [bx, by] = center(m, peak);
    const pts: [number, number][] = [];
    for (let k = 0; k <= 20; k++) pts.push([ax + ((bx - ax) * k) / 20, ay + ((by - ay) * k) / 20]);
    const s = new EditSession();
    const out = stroke(s, m, settings('river'), pts);
    const path = out.edits!.riverPaths[0];
    for (const h of path) if (out.hex.flags[h] & HexFlag.Land) expect(out.hex.flags[h] & HexFlag.River).toBeTruthy();
    invariants(out);
  });

  test('erasing a river removes it from there up to its sources', () => {
    const m = fresh();
    const r = m.rivers.reduce((a, b) => (b.hexes.length > a.hexes.length ? b : a));
    const mid = r.hexes[Math.floor(r.hexes.length / 2)];
    const s = new EditSession();
    const out = stroke(s, m, settings('erase-river', { radius: 0.5 }), [center(m, mid)]);
    expect(out.hex.flags[mid] & HexFlag.River).toBeFalsy();
    expect(out.hex.flags[r.hexes[0]] & HexFlag.River).toBeFalsy();
    invariants(out);
  });

  test('undo restores the exact map, redo the exact edit', () => {
    const m0 = fresh();
    const base = rederive(m0);
    const s = new EditSession();
    const [x, y] = center(base, base.provinces[5].hexes[0]);
    let cur = stroke(s, base, settings('raise', { radius: 5 }), [[x, y], [x + 4, y + 2]], 30);
    cur = stroke(s, cur, settings('paint', { terrain: Terrain.Marsh }), [[x + 1, y]]);
    const edited = { prov: Array.from(cur.hex.province), terrain: Array.from(cur.hex.terrain), h: cur.height.data.slice() };
    s.undo(cur);
    cur = rederive(cur);
    s.undo(cur);
    cur = rederive(cur);
    expect(Array.from(cur.hex.province)).toEqual(Array.from(base.hex.province));
    expect(Array.from(cur.hex.terrain)).toEqual(Array.from(base.hex.terrain));
    expect(Array.from(cur.height.data)).toEqual(Array.from(base.height.data));
    expect(cur.provinces.map((p) => p.name)).toEqual(base.provinces.map((p) => p.name));
    s.redo(cur);
    cur = rederive(cur);
    s.redo(cur);
    cur = rederive(cur);
    expect(Array.from(cur.hex.province)).toEqual(edited.prov);
    expect(Array.from(cur.hex.terrain)).toEqual(edited.terrain);
    expect(Array.from(cur.height.data)).toEqual(Array.from(edited.h));
  });

  test('edits survive save and open, and art still matches data', () => {
    const m = fresh();
    const s = new EditSession();
    const [x, y] = center(m, m.provinces[2].hexes[0]);
    let cur = stroke(s, m, settings('lower', { radius: 4 }), [[x, y]], 60);
    cur = stroke(s, cur, settings('paint', { terrain: Terrain.Glacier }), [[x + 3, y + 3]]);
    const back = mapFromJSON(mapToJSON(cur));
    expect(back.edits!.terrain).toBeInstanceOf(Int8Array);
    expect(Array.from(back.edits!.terrain)).toEqual(Array.from(cur.edits!.terrain));
    const a = buildRenderAssets(cur);
    for (let i = 0; i < cur.hex.province.length; i++) {
      const [hx, hy] = center(cur, i);
      expect(sampleField(cur.height, hx, hy) >= 0).toBe(cur.hex.province[i] >= 0);
      if (cur.hex.province[i] >= 0) expect(ownerAt(cur, a, hx, hy)).toBe(cur.hex.province[i]);
    }
  });
});
