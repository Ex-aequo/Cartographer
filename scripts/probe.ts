import { generateMap } from '../src/gen/generate';
import { DEFAULT_PARAMS } from '../src/model/types';
const cols = Number(process.argv[2] ?? 120), rows = Math.round(cols * 0.63);
const t0 = performance.now();
const m = generateMap({ ...DEFAULT_PARAMS, cols, rows }, (s) => console.log(s, Math.round(performance.now() - t0)));
console.log('done', Math.round(performance.now() - t0), 'provs', m.provinces.length, 'regions', m.regions.length, 'realms', m.realms.length);
