import { useSyncExternalStore } from 'react';
import { PT } from './pt';

/**
 * Interface languages. Strings are written in English in the code and looked
 * up by their English text; a missing translation falls back to English.
 * `{name}` placeholders are filled from `vars`.
 */

export type Lang = 'en' | 'pt';
export const LANGS: { key: Lang; name: string; htmlLang: string }[] = [
  { key: 'en', name: 'English', htmlLang: 'en' },
  { key: 'pt', name: 'Português', htmlLang: 'pt-PT' },
];

const TABLES: Record<Lang, Record<string, string> | null> = { en: null, pt: PT };

function load(): Lang {
  try {
    const v = localStorage.getItem('carto.lang');
    if (v === 'en' || v === 'pt') return v;
  } catch {
    /* storage unavailable */
  }
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('pt')) return 'pt';
  return 'en';
}

let current: Lang = typeof window === 'undefined' ? 'en' : load();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  if (l === current) return;
  current = l;
  try {
    localStorage.setItem('carto.lang', l);
  } catch {
    /* not remembered */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = LANGS.find((x) => x.key === l)!.htmlLang;
  listeners.forEach((f) => f());
}

/** Re-renders the caller when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => current,
    () => current,
  );
}

export function t(s: string, vars?: Record<string, string | number>): string {
  const table = TABLES[current];
  let out = (table && table[s]) || s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Singular or plural by count; `{n}` is the count. */
export function tn(one: string, many: string, n: number, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n: n.toLocaleString(locale()), ...vars });
}

export function locale(): string {
  return current === 'pt' ? 'pt-PT' : 'en-GB';
}

/** Formats a number in the interface language. */
export const num = (n: number) => n.toLocaleString(locale());

if (typeof document !== 'undefined') document.documentElement.lang = LANGS.find((x) => x.key === current)!.htmlLang;
