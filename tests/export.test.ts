import { describe, expect, test } from 'vitest';
import { generateMap } from '../src/gen/generate';
import { DEFAULT_PARAMS, HexFlag, type GenParams } from '../src/model/types';
import { decodePng, encodePng } from '../src/export/png';
import { SEA_ID_BASE, heightmaps, idColor, provinceMap, riverMask, seaZones, tables, terrainMaps } from '../src/export/maps';
import { hexCenterX, hexCenterY } from '../src/model/hex';
import { buildGameExport } from '../src/model/exportGame';

const P: GenParams = { ...DEFAULT_PARAMS, cols: 90, rows: 60, realmCount: 8, seed: 'export-tests' };
const m = generateMap(P);

describe('PNG encoder', () => {
  test('8-bit RGB and 16-bit grey round-trip exactly', async () => {
    const rgb = new Uint8Array(7 * 5 * 3).map((_, i) => (i * 37) & 255);
    const back = await decodePng(await encodePng({ width: 7, height: 5, channels: 3, depth: 8, data: rgb }));
    expect(back).toMatchObject({ width: 7, height: 5, channels: 3, depth: 8 });
    expect(Array.from(back.data)).toEqual(Array.from(rgb));
    const g = new Uint16Array(9 * 4).map((_, i) => (i * 4099) & 0xffff);
    const back16 = await decodePng(await encodePng({ width: 9, height: 4, channels: 1, depth: 16, data: g }));
    expect(Array.from(back16.data)).toEqual(Array.from(g));
  });
});

describe('export maps', () => {
  test('province colours are unique and never black', () => {
    const seen = new Set<string>();
    for (let id = 0; id < 5000; id++) {
      const c = idColor(id).join(',');
      expect(c).not.toBe('0,0,0');
      seen.add(c);
    }
    for (let k = 0; k < 2000; k++) seen.add(idColor(SEA_ID_BASE + k).join(','));
    expect(seen.size).toBe(7000);
  });

  test('every water hex is in exactly one sea zone or lake', () => {
    const { zones, zoneOf } = seaZones(m);
    for (let h = 0; h < zoneOf.length; h++) {
      const water = !(m.hex.flags[h] & HexFlag.Land);
      expect(zoneOf[h] >= 0).toBe(water);
    }
    expect(zones.reduce((a, z) => a + z.hexes.length, 0)).toBe(Array.from(zoneOf).filter((z) => z >= 0).length);
    expect(zones.some((z) => z.kind === 'sea')).toBe(true);
    expect(zones.every((z) => z.name.length > 0)).toBe(true);
  });

  test('province image: the pixel at each province town has its colour; definition lists it', () => {
    for (const smooth of [false, true]) {
      const { image, definition } = provinceMap(m, 400, smooth);
      const scale = image.width / m.world.width;
      for (const p of m.provinces.slice(0, 30)) {
        if (p.retired || p.capitalHex < 0) continue;
        const row = Math.floor(p.capitalHex / m.grid.cols);
        const x = Math.floor(hexCenterX(p.capitalHex % m.grid.cols, row) * scale);
        const y = Math.floor(hexCenterY(row) * scale);
        const o = (y * image.width + x) * 3;
        expect(Array.from(image.data.slice(o, o + 3))).toEqual(idColor(p.id));
      }
      const lines = definition.trim().split('\n');
      expect(lines[0]).toBe('province;red;green;blue;name;type;x;y');
      expect(lines.filter((l) => l.endsWith('') && l.includes(';land;')).length).toBe(m.provinces.filter((p) => !p.retired).length);
      // no black pixels: every pixel belongs to something
      for (let i = 0; i < image.data.length; i += 3 * 97) expect(image.data[i] + image.data[i + 1] + image.data[i + 2]).toBeGreaterThan(0);
    }
  });

  test('heightmaps put sea level where documented', () => {
    const { h16, h8 } = heightmaps(m, 300);
    const scale = 300 / m.world.width;
    const land = m.provinces[0].capitalHex;
    const row = Math.floor(land / m.grid.cols);
    const i = Math.floor(hexCenterY(row) * scale) * 300 + Math.floor(hexCenterX(land % m.grid.cols, row) * scale);
    expect(h16.data[i]).toBeGreaterThanOrEqual(32768);
    expect(h8.data[i]).toBeGreaterThanOrEqual(96);
    expect(Math.min(...Array.from(h16.data))).toBeLessThan(32768);
  });

  test('terrain masks cover the map exactly once; water and river masks', () => {
    const { index, masks, water } = terrainMaps(m, 240);
    const n = index.width * index.height;
    const cover = new Uint8Array(n);
    for (const mk of masks) for (let i = 0; i < n; i++) if (mk.image.data[i]) cover[i]++;
    expect(Array.from(cover).every((c) => c === 1)).toBe(true);
    expect(masks.map((x) => x.name)).toContain('plains');
    expect(Array.from(water.data).some((v) => v === 255)).toBe(true);
    const rivers = riverMask(m, 480);
    expect(Array.from(rivers.data).filter((v) => v > 0).length).toBeGreaterThan(100);
  });

  test('CSV tables and game data agree on sea zones', () => {
    const t = tables(m);
    expect(Object.keys(t)).toEqual(['hexes.csv', 'provinces.csv', 'regions.csv', 'realms.csv', 'sea_zones.csv']);
    expect(t['hexes.csv'].trim().split('\n').length).toBe(m.grid.cols * m.grid.rows + 1);
    const g = buildGameExport(m);
    const sea = g.hexes.find((h: { land: boolean }) => !h.land)!;
    expect(sea.seaZone).toBeGreaterThanOrEqual(SEA_ID_BASE);
    expect(t['hexes.csv'].split('\n')[sea.id + 1].endsWith(`,${sea.seaZone}`)).toBe(true);
    expect(g.seaZones.length).toBe(seaZones(m).zones.length);
  });
});
