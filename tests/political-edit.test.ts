import { describe, expect, test } from 'vitest';
import { generateMap } from '../src/gen/generate';
import { rederive } from '../src/gen/rederive';
import { EditSession, type ToolSettings } from '../src/edit/session';
import { newRealmFrom, newRegionFrom } from '../src/edit/political';
import { DEFAULT_PARAMS, HexFlag, Terrain, type GenParams, type MapData } from '../src/model/types';
import { buildNeighbors, hexCenterX, hexCenterY } from '../src/model/hex';
import { buildRenderAssets } from '../src/render/assets';
import { adjustedCurve } from '../src/render/LabelLayer';
import { mapFromJSON, mapToJSON } from '../src/model/serialize';

const P: GenParams = { ...DEFAULT_PARAMS, cols: 110, rows: 70, realmCount: 10, seed: 'border-tests' };
const fresh = () => rederive(generateMap(P));
const center = (m: MapData, h: number): [number, number] => {
  const row = Math.floor(h / m.grid.cols);
  return [hexCenterX(h % m.grid.cols, row), hexCenterY(row)];
};
const set = (tool: ToolSettings['tool'], radius = 1.5): ToolSettings => ({ tool, radius, strength: 1, terrain: Terrain.Forest });

function stroke(s: EditSession, m: MapData, t: ToolSettings, pts: [number, number][], ctx = {}): MapData {
  s.begin(m, t, pts[0][0], pts[0][1], ctx);
  for (const p of pts.slice(1)) s.move(p[0], p[1]);
  const rec = s.end();
  if (!rec) return m;
  if (rec.kind === 'instant') {
    s.commit(rec, m);
    return m;
  }
  const out = rederive(m);
  s.commit(rec, out);
  return out;
}

function invariants(m: MapData) {
  const nbr = buildNeighbors(m.grid);
  for (let i = 0; i < m.hex.province.length; i++) expect(m.hex.province[i] >= 0).toBe((m.hex.flags[i] & HexFlag.Land) !== 0);
  for (const p of m.provinces) {
    if (p.retired) continue;
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
    expect(seen.size, `province ${p.id} contiguous`).toBe(p.hexes.length);
    for (const q of p.neighbors) expect(m.provinces[q].neighbors).toContain(p.id);
    expect(m.regions[p.region].provinces).toContain(p.id);
    expect(m.realms[m.regions[p.region].realm].regions).toContain(p.region);
  }
}

/** a pair of neighbouring, mid-sized land provinces */
function pair(m: MapData) {
  for (const a of m.provinces) {
    if (a.hexes.length < 20) continue;
    for (const b of a.neighbors) if (m.provinces[b].hexes.length >= 20) return [a, m.provinces[b]];
  }
  throw new Error('no pair');
}

describe('border tools', () => {
  test('reassign grows a province into its neighbour', () => {
    const m = fresh();
    const [a, b] = pair(m);
    const s = new EditSession();
    // start in a, drag across b's hexes nearest to a
    const border = b.hexes.find((h) => buildNeighbors(m.grid).slice(h * 6, h * 6 + 6).some((j) => m.hex.province[j] === a.id))!;
    const out = stroke(s, m, set('assign', 2.5), [center(m, a.capitalHex), center(m, border)]);
    expect(out.hex.province[border]).toBe(a.id);
    expect(out.provinces[a.id].hexes.length).toBeGreaterThan(a.hexes.length);
    invariants(out);
  });

  test('split cuts a province in two, merge joins them back', () => {
    const m = fresh();
    const big = m.provinces.reduce((x, y) => (y.hexes.length > x.hexes.length ? y : x));
    // a line across the province through its centre, far beyond its edges
    // a vertical line through the settlement, from just outside one border to just outside the other
    const [cx] = center(m, big.capitalHex);
    const ys = big.hexes.filter((h) => Math.abs(center(m, h)[0] - cx) < 1).map((h) => center(m, h)[1]);
    const pts: [number, number][] = [];
    for (let y = Math.min(...ys) - 1.6; y <= Math.max(...ys) + 1.6; y += 0.5) pts.push([cx + 0.9, y]);
    const s = new EditSession();
    const before = m.provinces.length;
    let out = stroke(s, m, set('split'), pts);
    expect(s.message).toBeNull();
    expect(out.provinces.length).toBeGreaterThan(before);
    const created = out.provinces[out.provinces.length - 1];
    expect(created.hexes.length).toBeGreaterThan(1);
    expect(out.provinces[big.id].hexes.length).toBeLessThan(big.hexes.length);
    invariants(out);
    // merge the new province back into the old one
    out = stroke(s, out, set('merge'), [center(out, out.provinces[big.id].capitalHex), center(out, created.capitalHex)]);
    expect(out.provinces[created.id].retired).toBe(true);
    invariants(out);
  });

  test('a line that does not cross the province explains why', () => {
    const m = fresh();
    const big = m.provinces.reduce((x, y) => (y.hexes.length > x.hexes.length ? y : x));
    const s = new EditSession();
    const [x, y] = center(m, big.capitalHex);
    const out = stroke(s, m, set('split'), [[x, y], [x + 0.6, y]]);
    expect(out).toBe(m);
    expect(s.message).toMatch(/border to border/);
  });

  test('merging provinces that do not touch is refused', () => {
    const m = fresh();
    const a = m.provinces[0];
    const far = m.provinces.find((p) => !p.retired && p.id !== a.id && !a.neighbors.includes(p.id))!;
    const s = new EditSession();
    stroke(s, m, set('merge'), [center(m, a.capitalHex), center(m, far.capitalHex)]);
    expect(s.message).toMatch(/do not share a border/);
  });

  test('region and realm brushes move provinces and regions', () => {
    const m = fresh();
    const [a, b] = pair(m);
    const s = new EditSession();
    let out = stroke(s, m, set('region', 0.5), [center(m, a.capitalHex), center(m, b.capitalHex)]);
    expect(out.provinces[b.id].region).toBe(out.provinces[a.id].region);
    invariants(out);
    const ra = out.regions[out.provinces[a.id].region].realm;
    const otherRegion = out.regions.find((r) => !r.retired && r.realm !== ra)!;
    out = stroke(s, out, set('realm', 0.5), [center(out, a.capitalHex), center(out, out.provinces[otherRegion.capitalProvince].capitalHex)]);
    expect(out.regions[otherRegion.id].realm).toBe(ra);
    invariants(out);
  });

  test('new region and independent realm, with undo', () => {
    const m = fresh();
    const region = m.regions.find((r) => r.provinces.length >= 3)!;
    const prov = region.provinces[1];
    const counts = { regions: m.regions.length, realms: m.realms.length, realm: region.realm };
    const s = new EditSession();
    const rec1 = s.change(m, 'new region', () => newRegionFrom(m, prov))!;
    let out = rederive(m);
    s.commit(rec1, out);
    const newRegion = out.provinces[prov].region;
    expect(newRegion).toBe(counts.regions);
    const rec2 = s.change(out, 'independence', () => newRealmFrom(out, newRegion))!;
    const out2 = rederive(out);
    s.commit(rec2, out2);
    const newRealm = out2.regions[newRegion].realm;
    expect(newRealm).toBe(out2.realms.length - 1);
    expect(out2.realms[newRealm].color).not.toEqual(out2.realms[counts.realm].color);
    invariants(out2);
    // undo both
    s.undo(out2);
    out = rederive(out2);
    s.undo(out);
    out = rederive(out);
    expect(out.realms.length).toBe(counts.realms);
    expect(out.regions.length).toBe(counts.regions);
    expect(out.provinces[prov].region).toBe(region.id);
    invariants(out);
  });

  test('renames survive rebuilds, saving and undo', () => {
    const m = fresh();
    const s = new EditSession();
    const rec = s.change(m, 'rename', () => (m.provinces[3].name = 'Highwatch'))!;
    let out = rederive(m);
    s.commit(rec, out);
    expect(out.provinces[3].name).toBe('Highwatch');
    expect(mapFromJSON(mapToJSON(out)).provinces[3].name).toBe('Highwatch');
    s.undo(out);
    out = rederive(out);
    expect(out.provinces[3].name).not.toBe('Highwatch');
  });
});

describe('instant', () => {
  test('moving a label is one undo step and needs no rebuild', () => {
    const m = fresh();
    const a = buildRenderAssets(m);
    const lbl = a.realmLabels[0];
    const key = `realm:${lbl.id}`;
    const s = new EditSession();
    const [x, y] = lbl.p1;
    const out = stroke(s, m, set('label'), [[x, y], [x + 3, y + 1], [x + 5, y + 2]], { labelKey: key });
    expect(out).toBe(m);
    expect(m.labels![key].dx).toBeCloseTo(5);
    expect(m.labels![key].dy).toBeCloseTo(2);
    const moved = adjustedCurve(lbl, m.labels![key], 'X');
    expect(moved.p0[0]).toBeCloseTo(lbl.p0[0] + 5);
    s.undo(m);
    expect(m.labels![key]).toBeUndefined();
  });

  test('bend, angle and scale reshape the curve', () => {
    const l = { p0: [0, 0] as [number, number], p1: [5, 0] as [number, number], p2: [10, 0] as [number, number], size: 2, text: 'A', id: 0 };
    const c = adjustedCurve(l, { bend: 0.2, scale: 1.5, angle: Math.PI / 2 }, 'A');
    expect(c.size).toBeCloseTo(3);
    // rotated 90° about the middle (5, 0): ends now vertical
    expect(c.p0[0]).toBeCloseTo(5);
    expect(c.p2[0]).toBeCloseTo(5);
    // bent: the control point leaves the straight line
    expect(Math.abs(c.p1[0] - 5)).toBeGreaterThan(1);
  });
});
