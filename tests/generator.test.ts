import { describe, expect, test } from 'vitest';
import { generateMap } from '../src/gen/generate';
import { DEFAULT_PARAMS, HexFlag, type GenParams, type MapData } from '../src/model/types';
import { buildNeighbors, sampleField } from '../src/model/hex';
import { mapFromJSON, mapToJSON } from '../src/model/serialize';
import { buildGameExport } from '../src/model/exportGame';
import { buildRenderAssets, ownerAt } from '../src/render/assets';

const SMALL: GenParams = { ...DEFAULT_PARAMS, cols: 110, rows: 70, realmCount: 10, seed: 'test-seed' };
const cache = new Map<string, MapData>();
const gen = (p: GenParams) => {
  const k = JSON.stringify(p);
  if (!cache.has(k)) cache.set(k, generateMap(p));
  return cache.get(k)!;
};

function hashMap(m: MapData): string {
  let h = 0;
  const mix = (v: number) => (h = (Math.imul(h ^ (v | 0), 2654435761) + 0x9e37) | 0);
  m.hex.province.forEach(mix);
  m.hex.terrain.forEach(mix);
  m.hex.flags.forEach(mix);
  for (const p of m.provinces) for (const c of p.name) mix(c.charCodeAt(0));
  return String(h);
}

describe('generator', () => {
  test('same seed gives the same world', () => {
    const a = generateMap(SMALL);
    const b = generateMap(SMALL);
    expect(hashMap(a)).toBe(hashMap(b));
  });

  test('different seeds give different worlds', () => {
    expect(hashMap(gen(SMALL))).not.toBe(hashMap(gen({ ...SMALL, seed: 'another' })));
  });

  test('land share is close to the requested amount', () => {
    const m = gen(SMALL);
    let land = 0;
    m.hex.flags.forEach((f) => (land += f & HexFlag.Land ? 1 : 0));
    const share = land / m.hex.flags.length;
    expect(share).toBeGreaterThan(SMALL.landFraction - 0.12);
    expect(share).toBeLessThan(SMALL.landFraction + 0.08);
  });

  for (const template of ['continents', 'pangaea', 'archipelago', 'inland-sea'] as const) {
    describe(`${template} template`, () => {
      const m = () => gen({ ...SMALL, template });

      test('every land hex belongs to exactly one province; water to none', () => {
        const map = m();
        const seen = new Int32Array(map.hex.province.length).fill(-1);
        map.provinces.forEach((p) => {
          for (const h of p.hexes) {
            expect(seen[h]).toBe(-1);
            seen[h] = p.id;
          }
        });
        for (let i = 0; i < map.hex.province.length; i++) {
          const land = (map.hex.flags[i] & HexFlag.Land) !== 0;
          expect(map.hex.province[i] >= 0).toBe(land);
          expect(seen[i]).toBe(map.hex.province[i]);
        }
      });

      test('provinces are contiguous and ids are dense', () => {
        const map = m();
        const nbr = buildNeighbors(map.grid);
        map.provinces.forEach((p, idx) => {
          expect(p.id).toBe(idx);
          const set = new Set(p.hexes);
          const stack = [p.hexes[0]];
          const reached = new Set(stack);
          while (stack.length) {
            const i = stack.pop()!;
            for (let d = 0; d < 6; d++) {
              const j = nbr[i * 6 + d];
              if (j >= 0 && set.has(j) && !reached.has(j)) {
                reached.add(j);
                stack.push(j);
              }
            }
          }
          expect(reached.size).toBe(p.hexes.length);
          expect(set.has(p.capitalHex)).toBe(true);
        });
      });

      test('adjacency is symmetric and hierarchy is consistent', () => {
        const map = m();
        for (const p of map.provinces) {
          for (const q of p.neighbors) expect(map.provinces[q].neighbors).toContain(p.id);
          for (const q of p.seaNeighbors) expect(map.provinces[q].seaNeighbors).toContain(p.id);
          expect(map.regions[p.region].provinces).toContain(p.id);
        }
        for (const r of map.regions) {
          expect(r.provinces.length).toBeGreaterThan(0);
          expect(map.realms[r.realm].regions).toContain(r.id);
        }
        for (const realm of map.realms) {
          expect(realm.regions.length).toBeGreaterThan(0);
          expect(realm.name.length).toBeGreaterThan(2);
        }
      });

      test('rivers flow downhill into water or another river', () => {
        const map = m();
        for (const r of map.rivers) {
          expect(r.hexes.length).toBeGreaterThanOrEqual(4);
          for (let k = 0; k < r.hexes.length - 1; k++) expect(map.hex.flowTo[r.hexes[k]]).toBe(r.hexes[k + 1]);
          const end = r.hexes[r.hexes.length - 1];
          const endsInWater = !(map.hex.flags[end] & HexFlag.Land);
          const joinsRiver = (map.hex.flags[end] & HexFlag.River) !== 0;
          expect(endsInWater || joinsRiver).toBe(true);
        }
      });

      test('art and data agree at hex centres (land vs water)', () => {
        const map = m();
        const a = buildRenderAssets(map);
        let mismatch = 0;
        for (let i = 0; i < map.hex.province.length; i++) {
          const row = Math.floor(i / map.grid.cols);
          const x = Math.sqrt(3) * ((i % map.grid.cols) + 0.5 * (row & 1)) + Math.sqrt(3) / 2;
          const y = 1.5 * row + 1;
          const picked = ownerAt(map, a, x, y);
          const pickedLand = picked >= 0;
          const dataLand = map.hex.province[i] >= 0;
          if (pickedLand !== dataLand) mismatch++;
          if (sampleField(map.height, x, y) >= 0 !== dataLand) mismatch++;
          if (dataLand && pickedLand) expect(picked).toBe(map.hex.province[i]);
        }
        expect(mismatch).toBe(0);
      });
    });
  }
});

describe('files', () => {
  test('project file round-trips exactly', () => {
    const m = gen(SMALL);
    const back = mapFromJSON(mapToJSON(m));
    expect(hashMap(back)).toBe(hashMap(m));
    expect(back.height.data).toBeInstanceOf(Float32Array);
    let maxErr = 0;
    for (let i = 0; i < m.height.data.length; i++) maxErr = Math.max(maxErr, Math.abs(back.height.data[i] - m.height.data[i]));
    expect(maxErr).toBeLessThan(4e-5); // 16-bit step, plus sea kept below zero
    expect(back.provinces).toEqual(m.provinces);
  });

  test('rejects files that are not maps', () => {
    expect(() => mapFromJSON('{"hello":1}')).toThrow(/not a Cartographer map/);
    expect(() => mapFromJSON(JSON.stringify({ format: 'cartographer-map', version: 999 }))).toThrow(/newer version/);
  });

  test('game export has stable ids and complete records', () => {
    const m = gen(SMALL);
    const g = buildGameExport(m);
    expect(g.schema).toBe('cartographer-game-data');
    expect(g.hexes.length).toBe(m.grid.cols * m.grid.rows);
    g.hexes.forEach((h, i) => {
      expect(h.id).toBe(i);
      expect(h.id).toBe(h.row * m.grid.cols + h.col);
    });
    expect(g.provinces.length).toBe(m.provinces.length);
    for (const p of g.provinces) expect(g.regions[p.region].realm).toBe(p.realm);
    expect(g.realms.every((r) => /^#[0-9a-f]{6}$/.test(r.color))).toBe(true);
  });
});
