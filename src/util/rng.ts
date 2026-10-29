/** Seeded random numbers. Every generator step takes its own stream so
 *  re-rolling one step never changes the others. */

export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export class Rng {
  private s: number;
  constructor(seed: number | string) {
    this.s = (typeof seed === 'string' ? hashString(seed) : seed >>> 0) || 0x9e3779b9;
  }
  /** Float in [0, 1). mulberry32. */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, bInclusive: number): number {
    return a + Math.floor(this.next() * (bInclusive - a + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  /** Approximately normal, mean 0, sd 1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
  /** Derive an independent stream for a named step. */
  fork(label: string): Rng {
    return new Rng(hashString(label + ':' + this.s));
  }
}

export function randomSeedWord(): string {
  const a = ['amber', 'ashen', 'brine', 'cinder', 'dusk', 'ember', 'fallow', 'gilded', 'hollow', 'iron', 'jade', 'kestrel', 'lapis', 'moor', 'north', 'ochre', 'pale', 'quill', 'russet', 'salt', 'thorn', 'umber', 'vale', 'wold'];
  const b = ['crown', 'reach', 'march', 'fen', 'spire', 'ford', 'mere', 'holt', 'tor', 'strand', 'barrow', 'weald', 'haven', 'cairn', 'firth', 'dale'];
  const r = Math.random;
  return `${a[Math.floor(r() * a.length)]}-${b[Math.floor(r() * b.length)]}-${Math.floor(r() * 900 + 100)}`;
}
