import { describe, expect, test } from 'vitest';
import { generateMap } from '../src/gen/generate';
import { rederive } from '../src/gen/rederive';
import { EditSession } from '../src/edit/session';
import { createLayer, layerColors, layerCsv, newLayerDef, readTemplate, refreshLayers, runRules, templateOf, type DataLayer } from '../src/model/layers';
import { DEFAULT_PARAMS, HexFlag, Terrain, type GenParams, type MapData } from '../src/model/types';
import { hexCenterX, hexCenterY } from '../src/model/hex';
import { mapFromJSON, mapToJSON } from '../src/model/serialize';
import { buildGameExport } from '../src/model/exportGame';

const P: GenParams = { ...DEFAULT_PARAMS, cols: 110, rows: 70, realmCount: 10, seed: 'layer-tests' };
const fresh = () => rederive(generateMap(P));
const center = (m: MapData, h: number): [number, number] => {
  const row = Math.floor(h / m.grid.cols);
  return [hexCenterX(h % m.grid.cols, row), hexCenterY(row)];
};

function addLayer(m: MapData, type: Parameters<typeof newLayerDef>[1], scope: Parameters<typeof newLayerDef>[2]): DataLayer {
  const l = createLayer(m, newLayerDef(m.layers.map((x) => x.def), type, scope));
  m.layers.push(l);
  runRules(m, l);
  return l;
}

describe('data layers', () => {
  test('rules are seeded: same map, same values; only matching land gets a value', () => {
    const a = fresh();
    const b = fresh();
    const la = addLayer(a, 'category', 'hex');
    const lb = addLayer(b, 'category', 'hex');
    expect(Array.from(la.values)).toEqual(Array.from(lb.values));
    let iron = 0;
    for (let h = 0; h < la.values.length; h++) {
      const v = la.values[h];
      if (!(a.hex.flags[h] & HexFlag.Land)) expect(v).toBe(-1);
      if (v === 0) {
        iron++;
        expect([Terrain.Hills, Terrain.Mountains]).toContain(a.hex.terrain[h]);
      }
    }
    // about 15% of hills and mountains, minus the 4% of mountains that became gold
    let hills = 0;
    for (let h = 0; h < a.hex.terrain.length; h++) if (a.hex.terrain[h] === Terrain.Hills || a.hex.terrain[h] === Terrain.Mountains) hills++;
    expect(iron / hills).toBeGreaterThan(0.09);
    expect(iron / hills).toBeLessThan(0.2);
  });

  test('a number rule with a formula: fertility = rainfall × 10 on open land', () => {
    const m = fresh();
    const l = addLayer(m, 'number', 'hex');
    for (let h = 0; h < l.values.length; h++) {
      if ([Terrain.Plains, Terrain.Farmland, Terrain.Steppe].includes(m.hex.terrain[h]) && m.hex.flags[h] & HexFlag.Land) expect(l.values[h]).toBe(Math.min(10, Math.max(0, Math.round(m.hex.moisture[h] * 10))));
    }
  });

  test('hand-set values survive re-running the rules and rebuilding after an edit', () => {
    const m = fresh();
    const l = addLayer(m, 'category', 'hex');
    const land = m.provinces[4].hexes[0];
    const s = new EditSession();
    s.begin(m, { tool: 'layer', radius: 0.5, strength: 1, terrain: 0, layer: l.def.id, layerValue: 1 }, ...center(m, land));
    const rec = s.end()!;
    expect(rec.kind).toBe('instant');
    s.commit(rec, m);
    expect(l.values[land]).toBe(1);
    expect(l.locked[land]).toBe(1);
    runRules(m, l);
    expect(l.values[land]).toBe(1);
    // a land edit elsewhere: rules re-run, the hand value stays
    const out = rederive(m);
    const l2 = out.layers.find((x) => x.def.id === l.def.id)!;
    expect(l2.values[land]).toBe(1);
    // undo restores the rule value
    s.undo(m);
    expect(m.layers[0].locked[land]).toBe(0);
  });

  test('province roll-up follows the hexes, and follows splits', () => {
    const m = fresh();
    const hexL = addLayer(m, 'number', 'hex');
    const def = newLayerDef(m.layers.map((x) => x.def), 'number', 'province', 'Total fertility');
    def.rollUp = { source: hexL.def.id, how: 'sum' };
    def.max = 100000;
    const prov = createLayer(m, def);
    m.layers.push(prov);
    refreshLayers(m);
    const p = m.provinces[7];
    expect(prov.values[7]).toBe(p.hexes.reduce((a, h) => a + hexL.values[h], 0));
    // more provinces after an edit: the province layer grows with them
    m.provinces.push({ ...p, id: m.provinces.length, hexes: [], retired: true });
    refreshLayers(m);
    expect(prov.values.length).toBe(m.provinces.length);
  });

  test('layers save and open, export to game data and CSV, and travel as templates', () => {
    const m = fresh();
    const l = addLayer(m, 'category', 'hex');
    addLayer(m, 'flag', 'province');
    const back = mapFromJSON(mapToJSON(m));
    expect(back.layers.length).toBe(2);
    expect(Array.from(back.layers[0].values)).toEqual(Array.from(l.values));
    const g = buildGameExport(m);
    expect(g.layers.map((x: { id: string }) => x.id)).toEqual(m.layers.map((x) => x.def.id));
    const someIron = l.values.findIndex((v) => v === 0);
    expect(g.hexes[someIron].data[l.def.id]).toBe(0);
    expect(g.provinces[0].data[m.layers[1].def.id]).toBeDefined();
    const csv = layerCsv(m, l);
    expect(csv.split('\n')[0]).toBe('hex_id,col,row,q,r,value,label,set_by_hand');
    expect(csv).toContain(',Iron,');
    const defs = readTemplate(templateOf(m.layers.map((x) => x.def)));
    expect(defs[0].rules.length).toBe(3);
    expect(() => readTemplate('{"x":1}')).toThrow(/not a Cartographer layer template/);
  });

  test('layer colours: values become colours, water stays clear', () => {
    const m = fresh();
    const l = addLayer(m, 'category', 'hex');
    const c = layerColors(m, l);
    const iron = l.values.findIndex((v) => v === 0);
    expect(Array.from(c.slice(iron * 4, iron * 4 + 3))).toEqual([120, 120, 130]);
    const sea = m.hex.flags.findIndex((f) => !(f & HexFlag.Land));
    expect(c[sea * 4 + 3]).toBe(0);
  });

  test('adding and deleting a layer are undoable', () => {
    const m = fresh();
    const s = new EditSession();
    const rec = s.change(m, 'add', () => addLayer(m, 'tags', 'hex'), 'instant')!;
    s.commit(rec, m);
    expect(m.layers.length).toBe(1);
    const rec2 = s.change(m, 'delete', () => m.layers.splice(0, 1), 'instant')!;
    s.commit(rec2, m);
    expect(m.layers.length).toBe(0);
    s.undo(m);
    expect(m.layers.length).toBe(1);
    expect(m.layers[0].values.length).toBe(m.grid.cols * m.grid.rows);
    s.undo(m);
    expect(m.layers.length).toBe(0);
    s.redo(m);
    expect(m.layers[0].def.type).toBe('tags');
  });
});
