import { describe, expect, test } from 'vitest';
import { generateMap } from '../src/gen/generate';
import { rederive } from '../src/gen/rederive';
import { DEFAULT_GAME, DEFAULT_PARAMS, type GameSettings, type MapData } from '../src/model/types';
import { gameReport } from '../src/model/game';
import { provinceWorth } from '../src/gen/political4x';
import { mapFromJSON, mapToJSON } from '../src/model/serialize';
import { buildGameExport } from '../src/model/exportGame';
import { tables } from '../src/export/maps';
import { releaseProvince } from '../src/edit/political';
import { RACE_PRESETS } from '../src/model/races';

const make = (game: Partial<GameSettings>, seed = 'game-tests', extra = {}) => generateMap({ ...DEFAULT_PARAMS, seed, ...extra, game: { ...DEFAULT_GAME, on: true, ...game } });
const kingdoms = (m: MapData) => m.realms.filter((r) => !r.retired && !r.unclaimed);
const provincesOf = (m: MapData, realm: number) => m.realms[realm].regions.flatMap((k) => m.regions[k].provinces);

function connected(m: MapData, ps: number[]): boolean {
  const set = new Set(ps);
  const seen = new Set([ps[0]]);
  const st = [ps[0]];
  while (st.length) {
    const a = st.pop()!;
    for (const b of [...m.provinces[a].neighbors, ...m.provinces[a].seaNeighbors]) if (set.has(b) && !seen.has(b)) (seen.add(b), st.push(b));
  }
  return seen.size === set.size;
}

describe('4X game maps', () => {
  test('classic maps are unchanged by the 4X settings when they are off', () => {
    const P = { ...DEFAULT_PARAMS, cols: 120, rows: 76, seed: 'classic-check' };
    const a = generateMap(P);
    const b = generateMap({ ...P, game: { ...DEFAULT_GAME, on: false } });
    expect(b.grid).toEqual(a.grid);
    expect(b.realms.map((r) => r.name)).toEqual(a.realms.map((r) => r.name));
    expect(Array.from(b.hex.province)).toEqual(Array.from(a.hex.province));
  });

  test.each([
    [{ players: 24 }],
    [{ players: 40, balanced: false }],
    [{ players: 12, provinces: [2, 4] as [number, number], hexes: [4, 8] as [number, number], free: 0.15 }],
  ])('every province and kingdom sits inside its interval (%o)', (settings) => {
    const m = make(settings);
    const g = m.meta.params.game!;
    const r = gameReport(m)!;
    expect(kingdoms(m)).toHaveLength(g.players);
    expect(r.provincesOut).toEqual([]);
    expect(r.kingdomsOut).toEqual([]);
    for (const p of m.provinces) {
      expect(p.hexes.length).toBeGreaterThanOrEqual(g.hexes[0]);
      expect(p.hexes.length).toBeLessThanOrEqual(g.hexes[1]);
    }
    // every land hex is in a province
    for (let i = 0; i < m.hex.province.length; i++) if (m.hex.flags[i] & 1) expect(m.hex.province[i]).toBeGreaterThanOrEqual(0);
    // kingdoms are one piece (across narrow water at most), with their capital inside
    for (const k of kingdoms(m)) {
      const ps = provincesOf(m, k.id);
      expect(ps).toContain(k.capitalProvince);
      expect(connected(m, ps)).toBe(true);
    }
    // player slots 1..N
    expect(kingdoms(m).map((k) => k.player).sort((a, b) => a! - b!)).toEqual(Array.from({ length: g.players }, (_, i) => i + 1));
    // free land close to what was asked for
    expect(Math.abs(r.freeShare - g.free)).toBeLessThan(0.12);
  });

  test('balanced kingdoms have the same number of provinces and land of similar worth', () => {
    const m = make({ players: 30, balanced: true });
    const sizes = kingdoms(m).map((k) => provincesOf(m, k.id).length);
    expect(new Set(sizes).size).toBe(1);
    const worth = kingdoms(m).map((k) => provincesOf(m, k.id).reduce((a, q) => a + provinceWorth(m.hex, m.provinces[q]), 0));
    const mean = worth.reduce((a, b) => a + b, 0) / worth.length;
    for (const w of worth) expect(w / mean).toBeGreaterThan(0.6);
  });

  test('the map size follows the number of players', () => {
    const small = make({ players: 8 });
    const big = make({ players: 60 });
    expect(big.grid.cols * big.grid.rows).toBeGreaterThan(small.grid.cols * small.grid.rows * 5);
    // and keeps the land detailed: more texels per hex on small maps
    expect(small.height.res).toBeGreaterThan(3);
  });

  test('saves, exports with player slots and free land, and survives edits', () => {
    const raw = make({ players: 16 });
    const m = rederive(raw);
    // a rebuild keeps every province, including those that reach across the water to an islet
    expect(m.provinces.filter((p) => !p.retired)).toHaveLength(raw.provinces.length);
    expect(gameReport(m)!.provincesOut).toEqual([]);
    const back = mapFromJSON(mapToJSON(m));
    expect(back.meta.params.game).toEqual(m.meta.params.game);
    expect(back.realms.map((r) => r.player ?? null)).toEqual(m.realms.map((r) => r.player ?? null));
    const g = buildGameExport(m);
    expect(g.game!.players).toBe(16);
    expect(g.realms.filter((r: { unclaimed: boolean }) => r.unclaimed)).toHaveLength(1);
    const freeProv = g.provinces.find((p: { free: boolean }) => p.free);
    expect(freeProv!.player).toBeNull();
    const t = tables(m);
    expect(t['realms.csv'].split('\n')[0]).toMatch(/,player,unclaimed$/);
    expect(t['provinces.csv'].split('\n')[0]).toMatch(/,player,free$/);
    // give a border province back to the free land
    const k = kingdoms(m)[0];
    const q = provincesOf(m, k.id).find((p) => p !== k.capitalProvince)!;
    expect(releaseProvince(m, k.capitalProvince)).toBe(false);
    expect(releaseProvince(m, q)).toBe(true);
    const out = rederive(m);
    expect(out.realms[out.regions[out.provinces[q].region].realm].unclaimed).toBe(true);
    expect(provincesOf(out, k.id)).not.toContain(q);
  });

  test('races found their kingdoms among the players', () => {
    const races = RACE_PRESETS.map((r) => ({ ...JSON.parse(JSON.stringify(r)), enabled: ['dwarves', 'elves'].includes(r.id) }));
    const m = make({ players: 20 }, 'game-races', { races });
    const raced = kingdoms(m).filter((k) => k.race);
    expect(raced.some((k) => k.race === 'dwarves')).toBe(true);
    expect(raced.some((k) => k.race === 'elves')).toBe(true);
    expect(gameReport(m)!.kingdomsOut).toEqual([]);
  });
});
