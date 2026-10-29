import type { SymbolAsset, SymbolSet } from '../model/symbols';

/**
 * The built-in ink set: original pen-and-wash map symbols drawn for
 * Cartographer. Brown ink on parchment so they sit on the paper map; the
 * paper fill hides whatever is behind them.
 */

export const INK_SET: SymbolSet = { id: 'ink', name: 'Ink set (built in)' };

const INK = '#2a1d13';
const PAPER = '#efe3c4';
const SHADE = '#d8c69c';

function svg(body: string, w = 64, h = 64): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><g fill="${PAPER}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
}
const hatch = (d: string) => `<path d="${d}" fill="none" stroke-width="1"/>`;
const ink = (d: string) => `<path d="${d}" fill="${INK}" stroke="none"/>`;
/** a stroked body: ink outline with a paper core, for serpents and tentacles */
const body = (d: string, w = 7) => `<path d="${d}" fill="none" stroke-width="${w}"/><path d="${d}" fill="none" stroke="${PAPER}" stroke-width="${w - 3.4}"/>`;
const waves = (y: number) => `<path d="M2 ${y} q6 -4 12 0 t12 0 t12 0 t12 0 t12 0" fill="none" stroke-width="1.6"/>`;

const DEFS: [string, string, string[], string, number?, number?][] = [
  [
    'village',
    'Village',
    ['settlement', 'town'],
    `<path d="M24 52 V30 L36 18 L48 30 V52 Z"/>${hatch('M36 22 L28 30 M39 25 L33 31')}<rect x="33" y="34" width="6" height="6"/>
     <path d="M6 52 V37 L16 27 L26 37 V52 Z"/><path d="M14 52 V45 H18 V52" fill="${INK}"/>
     <path d="M44 52 V41 L51 34 L58 41 V52 Z"/>${hatch('M51 38 L47 42')}<path d="M3 53 H61" fill="none"/>`,
  ],
  [
    'city',
    'City',
    ['settlement', 'town', 'walls'],
    `<path d="M30 34 L34 8 L38 34 Z"/>${hatch('M34 12 L32 30')}<path d="M16 36 V24 L23 18 L30 24 V36"/><path d="M40 36 V26 A6 6 0 0 1 52 26 V36"/>
     <path d="M12 56 V38 H52 V56 Z"/><path d="M12 38 V34 H16 V38 M20 38 V34 H24 V38 M28 38 V34 H32 V38 M36 38 V34 H40 V38 M44 38 V34 H48 V38" fill="none"/>
     <path d="M4 56 V30 H7 V27 H10 V30 H13 V27 H16 V30 V56 Z"/><path d="M48 56 V30 H51 V27 H54 V30 H57 V27 H60 V30 V56 Z"/>
     ${ink('M27 56 V48 A5 5 0 0 1 37 48 V56 Z')}${ink('M9 38 h3 v6 h-3 z M52 38 h3 v6 h-3 z')}`,
  ],
  [
    'castle',
    'Castle',
    ['settlement', 'fortress', 'military'],
    `<path d="M32 18 V5" fill="none"/><path d="M32 5 L43 8 L32 11 Z" fill="${INK}"/>
     <path d="M20 54 V22 H24 V18 H28 V22 H32 V18 H36 V22 H40 V18 H44 V22 V54 Z"/>${hatch('M42 26 V50 M39 26 V50')}
     <path d="M7 54 V30 H10 V26 H13 V30 H16 V26 H19 V30 H21 V54 Z"/><path d="M43 54 V30 H45 V26 H48 V30 H51 V26 H54 V30 H57 V54 Z"/>
     ${ink('M27 54 V46 A5 5 0 0 1 37 46 V54 Z')}${ink('M30.5 28 h3 v7 h-3 z M12.5 35 h2.5 v6 h-2.5 z M49 35 h2.5 v6 h-2.5 z')}<path d="M3 55 H61" fill="none"/>`,
  ],
  [
    'tower',
    'Tower',
    ['fortress', 'military', 'watch'],
    `<path d="M24 56 V18 H26 V13 H30 V18 H34 V13 H38 V18 H40 V56 Z"/>${hatch('M37 22 V52 M34.5 22 V52')}
     ${ink('M30.5 25 h3 v8 h-3 z M28.5 56 V49 A3.5 3.5 0 0 1 35.5 49 V56 Z')}<path d="M18 57 H46" fill="none"/>`,
  ],
  [
    'ruins',
    'Ruins',
    ['ruin', 'dungeon', 'history'],
    `<path d="M12 54 V24 L14.5 21 L17 25 L21 20 V54 Z"/>${hatch('M15 28 V52 M18 28 V52')}
     <path d="M38 54 V35 L41 31 L43 35 L46 32 V54 Z"/>${hatch('M41 38 V52')}
     <path d="M23 54 V41 Q30 32 37 41 V54 H34 V44 Q30 39 26 44 V54 Z"/>
     <path d="M49 48 L58 46 L59.5 52 L50.5 54 Z"/><circle cx="8" cy="53" r="2"/><circle cx="54" cy="44" r="1.5"/><path d="M3 55 H61" fill="none"/>`,
  ],
  [
    'mine',
    'Mine',
    ['resource', 'industry'],
    `<path d="M3 55 Q14 32 32 30 Q50 32 61 55 Z"/>${hatch('M46 38 L42 44 M52 44 L47 50 M14 42 L18 46')}
     ${ink('M24 55 V44 Q32 36 40 44 V55 Z')}<path d="M23 55 V42 M41 55 V42 M20.5 41 H43.5" fill="none" stroke-width="3"/>
     <path d="M22 6 L40 24 M42 6 L24 24" fill="none" stroke-width="2.6"/><path d="M15 12 Q20 3 29 4" fill="none" stroke-width="3"/><path d="M38 3 L46 1 L48 8 L41 10 Z" fill="${INK}"/>`,
  ],
  [
    'port',
    'Port',
    ['harbour', 'sea', 'trade'],
    `<circle cx="32" cy="10" r="5" fill="none"/><path d="M32 15 V53 M21 22 H43" fill="none" stroke-width="3"/>
     <path d="M12 38 Q14 54 32 54 Q50 54 52 38" fill="none" stroke-width="3"/><path d="M8 43 L12 35 L17 42 Z M47 42 L52 35 L56 43 Z" fill="${INK}"/>`,
  ],
  [
    'temple',
    'Temple',
    ['holy', 'religion'],
    `<path d="M8 24 L32 10 L56 24 Z"/>${hatch('M28 20 H36')}<rect x="9" y="24" width="46" height="4"/>
     <rect x="12" y="28" width="5" height="22"/><rect x="23" y="28" width="5" height="22"/><rect x="36" y="28" width="5" height="22"/><rect x="47" y="28" width="5" height="22"/>
     <rect x="8" y="50" width="48" height="4"/><rect x="5" y="54" width="54" height="4"/>`,
  ],
  [
    'abbey',
    'Abbey',
    ['holy', 'religion', 'settlement'],
    `<path d="M38 54 V24 L44 8 L50 24 V54 Z"/>${hatch('M46 14 L48 22 M47 28 V50')}<path d="M44 8 V2 M41.5 4.5 H46.5" fill="none" stroke-width="1.6"/>
     <path d="M8 54 V34 L22 24 L38 34 V54 Z"/>${hatch('M22 28 L14 34')}<circle cx="23" cy="38" r="3.5"/>
     ${ink('M41.5 54 V47 A2.5 2.5 0 0 1 46.5 47 V54 Z M12 44 h3 v6 h-3 z M30 44 h3 v6 h-3 z')}<path d="M3 55 H61" fill="none"/>`,
  ],
  [
    'lighthouse',
    'Lighthouse',
    ['sea', 'harbour'],
    `<path d="M25 57 L28 22 H36 L39 57 Z"/><path d="M26.5 40 L37.5 40 M26 48 H38 M27.5 30 H36.5" fill="none" stroke-width="1.6"/>
     <rect x="27" y="14" width="10" height="8"/><path d="M25 14 L32 7 L39 14 Z" fill="${INK}"/>
     <path d="M19 15 L11 12 M19 19 L10 21 M45 15 L53 12 M45 19 L54 21" fill="none" stroke-width="1.4"/>${waves(59)}`,
  ],
  [
    'camp',
    'Camp',
    ['military', 'nomad'],
    `<path d="M32 16 V8" fill="none"/><path d="M32 8 L40 10 L32 12 Z" fill="${INK}"/><path d="M6 54 L32 16 L58 54 Z"/>
     ${hatch('M36 22 L48 46 M39 22 L52 48')}${ink('M32 30 L26 54 H38 Z')}<path d="M3 55 H61" fill="none"/>`,
  ],
  [
    'cave',
    'Cave',
    ['dungeon', 'monster'],
    `<path d="M4 56 Q7 32 22 25 Q38 15 52 27 Q61 37 60 56 Z"/>${hatch('M48 30 L44 36 M54 38 L49 44 M12 38 L16 42 M28 22 L24 27')}
     ${ink('M20 56 Q22 38 32 36 Q42 38 44 56 Z')}`,
  ],
  [
    'serpent',
    'Sea serpent',
    ['monster', 'sea'],
    `${body('M14 46 C14 30 28 30 28 46')}${body('M34 46 C34 34 46 34 46 46')}${body('M50 46 C52 40 57 38 60 30', 6)}
     ${body('M6 46 C4 36 6 26 14 22')}<path d="M12 17 C18 13 24 16 23 21 C22 25 15 25 11 24 Z"/><circle cx="18" cy="19.5" r="1.3" fill="${INK}"/>
     <path d="M17 31 L20 28 L22 32 M37 35 L40 32 L42 36" fill="none" stroke-width="1.6"/>${waves(48)}${waves(54)}`,
  ],
  [
    'kraken',
    'Kraken',
    ['monster', 'sea'],
    `${body('M14 50 C10 36 22 30 18 20 C16 14 10 16 12 20')}${body('M32 50 C32 34 42 30 38 16 C36 10 30 12 32 16')}${body('M48 50 C52 38 44 32 50 22 C54 16 58 20 56 24')}
     ${waves(50)}${waves(56)}`,
  ],
  [
    'ship',
    'Ship',
    ['sea', 'trade', 'military'],
    `<path d="M32 40 V8" fill="none"/><path d="M32 8 L41 6 L32 4" fill="${INK}" stroke-width="1.2"/>
     <path d="M19 12 H45 Q49 25 45 36 H19 Q15 25 19 12 Z"/>${hatch('M41 16 Q44 25 41 33 M37 16 Q39 25 37 33')}
     <path d="M6 40 H58 L51 52 H15 Z"/>${hatch('M10 44 H55 M13 48 H52')}${waves(56)}`,
  ],
  [
    'mountain',
    'Mountain',
    ['terrain', 'decoration'],
    `<path d="M2 58 L24 16 L33 30 L41 22 L62 58 Z"/><path d="M24 16 L20 26 L26 24 L28 30 L33 30" fill="#fbf6ea" stroke-width="1.4"/>
     ${hatch('M28 24 L40 56 M33 34 L46 56 M37 28 L52 56 M44 30 L57 56 M24 30 L32 56')}`,
  ],
  [
    'hills',
    'Hills',
    ['terrain', 'decoration'],
    `<path d="M26 56 Q42 30 62 56 Z"/>${hatch('M46 40 Q52 46 54 54 M50 44 Q55 49 57 55')}<path d="M2 56 Q18 28 36 56 Z"/>${hatch('M22 38 Q28 44 30 54 M26 42 Q31 48 33 55')}`,
  ],
  [
    'tree',
    'Tree',
    ['terrain', 'forest', 'decoration'],
    `<path d="M29 58 V40 H35 V58" fill="${SHADE}"/><path d="M32 8 C42 8 46 16 44 22 C52 24 52 36 44 38 C42 44 22 44 20 38 C12 36 12 24 20 22 C18 14 24 8 32 8 Z"/>
     ${hatch('M38 16 Q44 22 40 30 M42 28 Q46 34 40 38')}`,
  ],
  [
    'pine',
    'Pine',
    ['terrain', 'forest', 'decoration'],
    `<path d="M30 58 V48 H34 V58" fill="${SHADE}"/><path d="M32 6 L21 26 H26 L16 40 H23 L13 50 H51 L41 40 H48 L38 26 H43 Z"/>${hatch('M36 18 L40 25 M38 31 L44 39 M40 43 L47 49')}`,
  ],
];

export const INK_ASSETS: SymbolAsset[] = DEFS.map(([key, name, tags, b, w = 64, h = 64]) => ({
  id: `ink:${key}`,
  name,
  set: INK_SET.id,
  tags,
  kind: 'svg' as const,
  data: svg(b.replace(/\n\s*/g, ''), w, h),
  w,
  h,
}));
