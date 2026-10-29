import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { PT } from '../src/i18n/pt';
import { BIOME_NAMES, RELIEF_NAMES, TERRAIN_NAMES } from '../src/model/types';
import { CONDITION_NAMES, FORMULA_NAMES, TYPE_NAMES } from '../src/model/layers';
import { LEVEL_NAMES } from '../src/model/symbols';
import { INK_ASSETS, INK_SET } from '../src/symbols/inkSet';
import { REALM_TITLES } from '../src/edit/political';
import { TOOL_LABELS } from '../src/edit/session';
import { MODES, ELEVATION_RAMP, TEMPERATURE_RAMP, RAINFALL_RAMP } from '../src/render/mapModes';
import { LEVELS } from '../src/ui/zoomLevels';
import { LOOKS } from '../src/export/highres';
import { RACE_PRESETS } from '../src/model/races';
import { COAST_NAMES, SIZE_NAMES, STYLE_NAMES } from '../src/ui/RacesSection';

/** Arguments of every call to `fn(` in the source, split at top-level commas. */
function allArgs(src: string, fn: string): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`(?<![\\w.])${fn}\\(`, 'g');
  for (const m of src.matchAll(re)) {
    let i = m.index! + m[0].length;
    let depth = 0;
    let cur = '';
    const args: string[] = [];
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
        cur += src.slice(i, j + 1);
        i = j;
        continue;
      }
      if (c === '(' || c === '{' || c === '[') depth++;
      if (c === ')' || c === '}' || c === ']') {
        if (depth === 0) break;
        depth--;
      }
      if (c === ',' && depth === 0) {
        args.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    args.push(cur);
    out.push(args);
  }
  return out;
}
const firstArgs = (src: string, fn: string) => allArgs(src, fn).map((a) => a[0]);
/** String literals in an expression, leaving out the ones it only compares against. */
function literals(expr: string): string[] {
  const e = expr.replace(/(===|!==|==|!=)\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, '').replace(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*(===|!==)/g, '');
  return [...e.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((s) => (s[1] ?? s[2]).replace(/\\'/g, "'"));
}

/** Every string the interface shows: t()/tn() literals in the source plus the name tables. */
export function allKeys(): Set<string> {
  const keys = new Set<string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !p.includes('i18n')) {
        const src = readFileSync(p, 'utf8');
        for (const arg of firstArgs(src, 't')) for (const lit of literals(arg)) keys.add(lit);
        for (const arg of allArgs(src, 'tn')) for (const lit of arg.slice(0, 2).flatMap(literals)) keys.add(lit);
      }
    }
  };
  walk(join(__dirname, '../src'));
  const tables: string[] = [
    ...Object.values(TERRAIN_NAMES),
    ...Object.values(BIOME_NAMES),
    ...Object.values(RELIEF_NAMES),
    ...Object.values(TYPE_NAMES),
    ...Object.values(CONDITION_NAMES),
    ...Object.values(FORMULA_NAMES),
    ...LEVEL_NAMES,
    ...REALM_TITLES,
    ...Object.values(TOOL_LABELS),
    ...MODES.map((m) => m.label),
    ...[ELEVATION_RAMP, TEMPERATURE_RAMP, RAINFALL_RAMP].flatMap((r) => r.ticks.map((x) => x.label)),
    ...LEVELS.flatMap((l) => [l.name, l.hint]),
    ...LOOKS.flatMap((l) => [l.name, l.hint]),
    INK_SET.name,
    ...RACE_PRESETS.map((r) => r.name),
    ...Object.values(STYLE_NAMES),
    ...Object.values(SIZE_NAMES),
    ...Object.values(COAST_NAMES),
    ...INK_ASSETS.flatMap((a) => [a.name, ...a.tags]),
    'Raising continents',
    'Carving valleys',
    'Setting the winds',
    'Carving rivers and lakes',
    'Drawing borders',
    'Inking borders',
    'Measuring coasts',
    'Fields',
    'Lettering',
    'Rivers',
    'Unrolling the map',
    'Drawing the province map',
    'Compressing the province map',
    'Writing heightmaps',
    'Writing terrain masks',
    'Writing tables',
    'Writing game data',
  ];
  for (const s of tables) keys.add(s);
  // UI tables that live in component files
  for (const f of ['ui/EditPanel.tsx', 'ui/DataPanel.tsx', 'ui/SymbolsPanel.tsx', 'ui/WorldPanel.tsx', 'ui/ExportDialog.tsx']) {
    const src = readFileSync(join(__dirname, '../src', f), 'utf8');
    for (const block of src.matchAll(/export const (HINTS|GROUPS|AGG_NAMES|MODE_NAMES|SIZES|SHAPES|CLIMATES|TABS|PARTS)[^=]*=\s*([\[{][\s\S]*?\n[\]}];)/g))
      for (const s of block[2].matchAll(/(?:label|name|files|^\s*[\w'-]+):\s*'((?:[^'\\]|\\.)*)'/gm)) keys.add(s[1]);
  }
  // degree labels need no translation
  for (const k of [...keys]) if (!/[A-Za-z]/.test(k) || /^[\d\s°Ckm−.-]+$/.test(k) || /^[\w./*-]+\.(json|png|csv)$/.test(k)) keys.delete(k);
  return keys;
}

describe('Portuguese interface', () => {
  test('every interface string has a translation', () => {
    const missing = [...allKeys()].filter((k) => !PT[k]);
    if (missing.length) console.log(JSON.stringify(missing, null, 1));
    expect(missing).toEqual([]);
  });

  test('placeholders survive translation', () => {
    for (const [en, pt] of Object.entries(PT)) {
      const a = [...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const b = [...pt.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(b, `${en} → ${pt}`).toEqual(a);
    }
  });
});
