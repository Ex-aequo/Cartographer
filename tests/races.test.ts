import { describe, expect, test } from 'vitest';
import { generateMap } from '../src/gen/generate';
import { rederive, ensureEdits } from '../src/gen/rederive';
import { DEFAULT_PARAMS, Terrain, type GenParams } from '../src/model/types';
import { RACE_PRESETS, fitBorders, kingdomCounts, raceColors, raceReport, shapeTerrain, type RaceDef } from '../src/model/races';
import { mapFromJSON, mapToJSON } from '../src/model/serialize';
import { buildGameExport } from '../src/model/exportGame';
import { tables } from '../src/export/maps';
import { EditSession } from '../src/edit/session';
import { settlementAsset } from '../src/model/symbols';

const P: GenParams = { ...DEFAULT_PARAMS, cols: 160, rows: 100, realmCount: 14, seed: 'race-tests' };
const pick = (ids: string[], patch: Partial<RaceDef> = {}): RaceDef[] => RACE_PRESETS.map((r) => ({ ...JSON.parse(JSON.stringify(r)), enabled: ids.includes(r.id), ...(ids.includes(r.id) ? patch : {}) }));

describe('races', () => {
  test('worlds without races are unchanged', () => {
    const a = generateMap(P);
    const b = generateMap({ ...P, races: pick([]) });
    expect(b.realms.map((r) => r.name)).toEqual(a.realms.map((r) => r.name));
    expect(Array.from(b.hex.province)).toEqual(Array.from(a.hex.province));
    expect(b.realms.some((r) => r.race)).toBe(false);
  });

  test('each race gets its kingdoms, on land that suits it', () => {
    const m = generateMap({ ...P, races: pick(['dwarves', 'elves', 'auroch']) });
    const of = (id: string) => m.realms.filter((r) => r.race === id);
    expect(of('dwarves')).toHaveLength(3);
    expect(of('elves')).toHaveLength(2);
    expect(of('auroch')).toHaveLength(2);
    const fits = raceReport(m);
    // dwarves sit in the mountains: well above the world's share
    const mountainShare = (() => {
      let land = 0;
      let mtn = 0;
      for (let h = 0; h < m.hex.terrain.length; h++) {
        if (m.hex.province[h] < 0) continue;
        land++;
        if ([Terrain.Mountains, Terrain.Hills, Terrain.Peaks].includes(m.hex.terrain[h])) mtn++;
      }
      return mtn / land;
    })();
    for (const f of fits.filter((x) => x.race.id === 'dwarves')) {
      expect(f.results[0].share).toBeGreaterThan(mountainShare);
      expect(f.results[0].share).toBeGreaterThanOrEqual(0.5);
    }
    // their own name style and culture
    expect(m.cultures.some((c) => c.name === 'Dwarves')).toBe(true);
    expect(of('dwarves').every((r) => m.cultures[r.culture].name === 'Dwarves')).toBe(true);
  });

  test('fit borders reduces the shortfall without emptying realms or moving capitals', () => {
    const m = generateMap({ ...P, races: pick(['dwarves', 'elves', 'humans', 'orcs']) });
    const before = raceReport(m).reduce((a, f) => a + f.deficit, 0);
    const capitals = m.realms.map((r) => m.provinces[r.capitalProvince].region);
    fitBorders(m);
    const out = rederive(m);
    const after = raceReport(out).reduce((a, f) => a + f.deficit, 0);
    expect(after).toBeLessThanOrEqual(before + 1e-9);
    expect(out.realms.filter((r) => !r.retired).length).toBe(m.realms.filter((r) => !r.retired).length);
    m.realms.forEach((r, i) => expect(out.provinces[r.capitalProvince].region).toBe(capitals[i]));
  });

  test('races allowed to change the land always reach their targets', () => {
    const m = generateMap({ ...P, races: pick(['dwarves'], { terraform: true, biases: [{ terrains: [Terrain.Mountains, Terrain.Hills], op: 'min', pct: 80 }] }) });
    fitBorders(m);
    shapeTerrain(m, ensureEdits(m));
    const out = rederive(m);
    for (const f of raceReport(out)) expect(f.ok).toBe(true);
  });

  test('kingdom counts shrink together when they ask for more realms than exist', () => {
    const races = pick(['dwarves', 'elves', 'humans', 'orcs', 'nomads']).filter((r) => r.enabled);
    const c = kingdomCounts(races, 6);
    expect([...c.values()].reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6);
    for (const v of c.values()) expect(v).toBeGreaterThanOrEqual(1);
  });

  test('races save, export, show as a map mode, mark towns and undo', () => {
    const m = rederive(generateMap({ ...P, races: pick(['dwarves', 'auroch']) }));
    const back = mapFromJSON(mapToJSON(m));
    expect(back.realms.map((r) => r.race)).toEqual(m.realms.map((r) => r.race));
    expect(back.meta.params.races?.filter((r) => r.enabled).map((r) => r.id)).toEqual(['dwarves', 'auroch']);
    const g = buildGameExport(m);
    expect(g.races.map((r: { id: string }) => r.id)).toEqual(['dwarves', 'auroch']);
    const dwarf = m.realms.find((r) => r.race === 'dwarves')!;
    expect(g.realms[dwarf.id].race).toBe('dwarves');
    expect(g.provinces[dwarf.capitalProvince].race).toBe('dwarves');
    expect(g.hexes[m.provinces[dwarf.capitalProvince].capitalHex].race).toBe('dwarves');
    expect(tables(m)['races.csv']).toContain('dwarves,Dwarves,');
    const c = raceColors(m);
    const h = m.provinces[dwarf.capitalProvince].capitalHex;
    expect(Array.from(c.slice(h * 4, h * 4 + 3))).toEqual(RACE_PRESETS.find((r) => r.id === 'dwarves')!.color);
    expect(settlementAsset(m, dwarf.capitalProvince, 'capital')).toBe('ink:tower');
    // change a realm's race, then undo
    const s = new EditSession();
    const rec = s.change(m, 'race', () => void (m.realms[dwarf.id].race = 'auroch'))!;
    s.commit(rec, m);
    expect(m.realms[dwarf.id].race).toBe('auroch');
    s.undo(m);
    expect(m.realms[dwarf.id].race).toBe('dwarves');
  });
});
