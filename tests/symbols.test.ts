import { describe, expect, test } from 'vitest';
import { generateMap } from '../src/gen/generate';
import { EditSession } from '../src/edit/session';
import { DEFAULT_PARAMS, type GenParams } from '../src/model/types';
import {
  DEFAULT_PLACE,
  ImportError,
  MAX_ASSET_BYTES,
  addPlacement,
  allAssets,
  assetFromFile,
  ensureSymbols,
  newAssetId,
  placementAt,
  readSetFile,
  removeAsset,
  sanitizeSvg,
  setFile,
  settlementAsset,
  svgSize,
} from '../src/model/symbols';
import { INK_ASSETS } from '../src/symbols/inkSet';
import { mapFromJSON, mapToJSON } from '../src/model/serialize';
import { buildGameExport } from '../src/model/exportGame';
import { hexCenterX, hexCenterY } from '../src/model/hex';

const P: GenParams = { ...DEFAULT_PARAMS, cols: 90, rows: 60, realmCount: 8, seed: 'symbol-tests' };
const enc = (s: string) => new TextEncoder().encode(s);

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

describe('symbol assets', () => {
  test('the built-in ink set has the promised symbols', () => {
    const names = INK_ASSETS.map((a) => a.name);
    for (const n of ['Village', 'City', 'Castle', 'Ruins', 'Mine', 'Port', 'Temple', 'Sea serpent', 'Kraken', 'Ship']) expect(names).toContain(n);
    for (const a of INK_ASSETS) {
      expect(a.data.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
      expect(sanitizeSvg(a.data)).toBe(a.data);
    }
  });

  test('SVGs are cleaned of anything that is not a picture', () => {
    const dirty = `<?xml version="1.0"?><svg viewBox="0 0 120 80" onload="alert(1)"><script>alert(2)</script>
      <foreignObject><div>hi</div></foreignObject><a href="https://evil.example/"><rect width="5" height="5" onclick="x()"/></a>
      <use xlink:href="#ok"/><image href="javascript:alert(3)"/><image href="data:image/png;base64,AAAA"/></svg>`;
    const s = sanitizeSvg(dirty)!;
    expect(s).not.toMatch(/script|onload|onclick|foreignObject|evil\.example|javascript/i);
    expect(s).toContain('xlink:href="#ok"');
    expect(s).toContain('data:image/png;base64,AAAA');
    expect(s.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svgSize(s)).toEqual([120, 80]);
  });

  test('files: SVG and PNG accepted, others and oversized refused with a clear message', () => {
    const a = assetFromFile('dark_tower.svg', enc('<svg width="30" height="60"><rect/></svg>'), 'mine', 'a1');
    expect(a).toMatchObject({ name: 'Dark tower', kind: 'svg', w: 30, h: 60 });
    const b = assetFromFile('ship.png', png(128, 64), 'mine', 'a2');
    expect(b).toMatchObject({ kind: 'png', w: 128, h: 64 });
    expect(b.data.startsWith('data:image/png;base64,')).toBe(true);
    expect(() => assetFromFile('notes.txt', enc('hello'), 'mine', 'a3')).toThrow(ImportError);
    const big = new Uint8Array(MAX_ASSET_BYTES + 1);
    expect(() => assetFromFile('huge.png', big, 'mine', 'a4')).toThrow(/larger than 2 MB/);
  });
});

describe('placing symbols', () => {
  test('place, pin to a hex, pick, undo, and town marks', () => {
    const m = generateMap(P);
    const s = new EditSession();
    const x = hexCenterX(20, 20) + 0.4;
    const y = hexCenterY(20) - 0.3;
    let id = -1;
    const rec = s.change(m, 'Place', () => (id = addPlacement(m, 'ink:castle', x, y, DEFAULT_PLACE, true).id), 'instant')!;
    expect(rec.symbols).toBeDefined();
    s.commit(rec, m);
    const p = m.symbols!.placements[0];
    expect(p.hex).toBe(20 * m.grid.cols + 20);
    expect(p.x).toBeCloseTo(hexCenterX(20, 20));
    // visible from Realm zoom: found there, not at World zoom
    expect(placementAt(m, p.x + 0.5, p.y, 10)?.id).toBe(id);
    expect(placementAt(m, p.x + 0.5, p.y, 2)).toBeNull();
    s.undo(m);
    expect(m.symbols?.placements.length ?? 0).toBe(0);
    s.redo(m);
    expect(m.symbols!.placements[0].id).toBe(id);

    // town marks by importance
    ensureSymbols(m).settlements.mode = 'size';
    m.symbols!.settlements.size.capital = 'ink:city';
    const capital = m.realms[0].capitalProvince;
    expect(settlementAsset(m, capital, 'capital')).toBe('ink:city');
    expect(settlementAsset(m, capital, 'town')).toBeNull();
  });

  test('own assets: save with the map, export pinned symbols, travel as sets, removal cleans up', () => {
    const m = generateMap(P);
    const sym = ensureSymbols(m);
    const a = assetFromFile('beacon.svg', enc('<svg viewBox="0 0 10 20"><circle r="3"/></svg>'), 'mine', newAssetId(m));
    sym.assets.push(a);
    addPlacement(m, a.id, hexCenterX(5, 5), hexCenterY(5), DEFAULT_PLACE, true);
    addPlacement(m, a.id, 30, 30, DEFAULT_PLACE, false);
    sym.settlements.mode = 'size';
    sym.settlements.size.town = a.id;

    const back = mapFromJSON(mapToJSON(m));
    expect(back.symbols!.assets[0].data).toBe(a.data);
    expect(back.symbols!.placements.length).toBe(2);

    const g = buildGameExport(m);
    expect(g.symbols).toHaveLength(1);
    expect(g.symbols[0]).toMatchObject({ hex: 5 * m.grid.cols + 5, symbol: 'Beacon' });
    expect(g.hexes[5 * m.grid.cols + 5].symbols).toEqual(['Beacon']);

    const file = setFile(m, 'mine');
    const m2 = generateMap(P);
    const loaded = readSetFile(file, () => newAssetId(m2));
    expect(loaded.assets).toHaveLength(1);
    expect(loaded.assets[0].data).toBe(a.data);
    expect(loaded.set.name).toBe('My symbols');
    expect(() => readSetFile('{"format":"nope"}', () => 'z')).toThrow(/not a Cartographer symbol set/);

    expect(removeAsset(m, a.id)).toBe(2);
    expect(m.symbols!.settlements.size.town).toBeUndefined();
    expect(allAssets(m).some((x) => x.id === a.id)).toBe(false);
  });
});
