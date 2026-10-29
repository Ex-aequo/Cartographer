import { Rng } from '../util/rng';

/** Phoneme palettes. Each culture draws a mutated subset of one palette, so
 *  two cultures from the same palette still sound related but distinct. */
const PALETTES = [
  {
    key: 'north',
    onsets: ['k', 'sk', 'st', 'h', 'v', 'th', 'br', 'gr', 'j', 'r', 's', 't', 'd', 'f', 'b', 'sv', 'hr', 'gn'],
    nuclei: ['a', 'e', 'i', 'o', 'u', 'ö', 'y', 'ei', 'au', 'a', 'e'],
    codas: ['r', 'n', 'ld', 'rd', 'k', 't', 'nd', 'lf', 'rn', 'ng', 's', 'rk', 'll'],
    endings: ['heim', 'vik', 'gard', 'stad', 'fjord', 'borg', 'ness', 'dal', 'holm', 'mark'],
  },
  {
    key: 'latin',
    onsets: ['v', 'c', 'l', 't', 'm', 'p', 's', 'r', 'f', 'n', 'd', 'g', 'qu', 'b', 'tr', 'pr'],
    nuclei: ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'a', 'o'],
    codas: ['n', 'r', 's', 'l', 'm', 'x', 'nt', 'rc'],
    endings: ['ia', 'ona', 'ium', 'ara', 'ensa', 'eto', 'ano', 'essa', 'ica', 'ola'],
  },
  {
    key: 'wyld',
    onsets: ['gw', 'll', 'c', 'd', 'br', 'm', 'r', 't', 'b', 'dr', 'cr', 'ff', 'gl', 'rh', 'p'],
    nuclei: ['a', 'e', 'y', 'o', 'ae', 'ei', 'i', 'a'],
    codas: ['n', 'dd', 'th', 'r', 'll', 'g', 'rn', 's', 'ch', 'nt'],
    endings: ['wyn', 'mor', 'dun', 'aeth', 'annon', 'ydd', 'wen', 'ach', 'wy', 'ion'],
  },
  {
    key: 'steppe',
    onsets: ['k', 't', 'b', 'q', 's', 'y', 'd', 'ch', 'j', 'kh', 'z', 'm', 'ar', 'or'],
    nuclei: ['a', 'u', 'i', 'e', 'o', 'ö', 'a', 'ai'],
    codas: ['n', 'r', 'l', 'sh', 'k', 't', 'z', 'q', 'm', 'y', 'rt'],
    endings: ['stan', 'kent', 'abad', 'tau', 'kul', 'dar', 'ul', 'an', 'kai', 'tag'],
  },
  {
    key: 'dune',
    onsets: ['q', 's', 'z', 'r', 'm', 'h', 'kh', 'j', 'b', 'd', 'n', 'f', 'sh', 'al-'],
    nuclei: ['a', 'i', 'u', 'aa', 'ou', 'ai', 'a', 'a'],
    codas: ['r', 'd', 'm', 'n', 'b', 'sh', 'l', 'f', 'z', 'q'],
    endings: ['ah', 'ar', 'iyya', 'aq', 'un', 'ira', 'an', 'isa', 'oum', 'adh'],
  },
  {
    key: 'isle',
    onsets: ['th', 'k', 'ph', 'd', 'l', 'm', 'n', 'p', 'x', 'ch', 's', 't', 'kr', 'pl', 'ly'],
    nuclei: ['a', 'e', 'i', 'o', 'y', 'ai', 'ei', 'ou', 'a'],
    codas: ['s', 'n', 'r', 'x', 'l', 'k', 'ss', 'nth'],
    endings: ['os', 'ia', 'polis', 'ene', 'ion', 'eia', 'ikon', 'ara', 'ope', 'is'],
  },
  {
    key: 'east',
    onsets: ['v', 'z', 'b', 'kr', 'st', 'sv', 'm', 'dr', 'g', 'j', 'r', 'l', 'br', 'pr', 'ch', 'zv'],
    nuclei: ['a', 'o', 'e', 'i', 'u', 'y', 'ia', 'o'],
    codas: ['v', 'n', 'sk', 'l', 'r', 'ch', 'k', 'm', 'd', 'sl', 'zd'],
    endings: ['grad', 'ov', 'ava', 'ice', 'nik', 'ovo', 'ska', 'in', 'yev', 'ets'],
  },
];

export interface NameCulture {
  onsets: string[];
  nuclei: string[];
  codas: string[];
  endings: string[];
  /** chance a syllable gets a coda */
  codaP: number;
  /** chance a name gets a place ending */
  endingP: number;
}

export function makeCulture(rng: Rng, paletteIndex: number): NameCulture {
  const pal = PALETTES[paletteIndex % PALETTES.length];
  const sub = <T,>(arr: T[], keep: number) => rng.shuffle(arr.slice()).slice(0, Math.max(3, Math.round(arr.length * keep)));
  return {
    onsets: sub(pal.onsets, rng.range(0.55, 0.85)),
    nuclei: sub(pal.nuclei, rng.range(0.6, 0.9)),
    codas: sub(pal.codas, rng.range(0.5, 0.8)),
    endings: sub(pal.endings, rng.range(0.4, 0.7)),
    codaP: rng.range(0.25, 0.55),
    endingP: rng.range(0.3, 0.55),
  };
}

export const PALETTE_COUNT = PALETTES.length;

export class NameForge {
  private used = new Set<string>();
  constructor(private rng: Rng) {}

  word(c: NameCulture, minSyl = 1, maxSyl = 3, endingP = c.endingP): string {
    for (let attempt = 0; attempt < 40; attempt++) {
      const syl = this.rng.int(minSyl, maxSyl);
      let s = '';
      for (let k = 0; k < syl; k++) {
        if (k > 0 || this.rng.chance(0.82)) s += this.rng.pick(c.onsets);
        s += this.rng.pick(c.nuclei);
        if (this.rng.chance(c.codaP) && k < syl - 1) s += this.rng.pick(c.codas);
      }
      if (this.rng.chance(endingP)) s += this.rng.pick(c.endings);
      else if (this.rng.chance(c.codaP + 0.15)) s += this.rng.pick(c.codas);
      s = s.replace(/(.)\1\1+/g, '$1$1').replace(/^-+|-+$/g, '');
      if (s.length < 4 || s.length > 12) continue;
      if (/[aeiouyöw]{3,}/.test(s)) continue;
      const name = capitalize(s);
      if (this.used.has(name)) continue;
      this.used.add(name);
      return name;
    }
    const fallback = capitalize(this.rng.pick(c.onsets) + this.rng.pick(c.nuclei) + this.rng.pick(c.endings)) + ' ' + this.used.size;
    this.used.add(fallback);
    return fallback;
  }
}

function capitalize(s: string): string {
  return s
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('-');
}
