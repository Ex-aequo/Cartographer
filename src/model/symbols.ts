import type { MapData } from './types';
import { hexAt, hexCenterX, hexCenterY } from './hex';
import { INK_ASSETS, INK_SET } from '../symbols/inkSet';

/**
 * Symbols: pictures placed on the map (towns, castles, ships, monsters …).
 * Assets are SVG or PNG files, either the built-in ink set or the user's own,
 * grouped in named sets. Placements put an asset somewhere on the map, free
 * or pinned to a hex (pinned symbols are part of the game data).
 */

export interface SymbolAsset {
  /** stable id; built-in ones start with "ink:" */
  id: string;
  name: string;
  set: string;
  tags: string[];
  kind: 'svg' | 'png';
  /** SVG text, or a PNG data URL */
  data: string;
  /** natural size in px, for the aspect ratio */
  w: number;
  h: number;
}

export interface SymbolSet {
  id: string;
  name: string;
}

/** The four zoom levels: 0 World, 1 Realm, 2 Province, 3 Hex. */
export type Level = 0 | 1 | 2 | 3;

export interface Placement {
  id: number;
  asset: string;
  /** centre, world units */
  x: number;
  y: number;
  /** width in world units (1 = one hex radius) */
  size: number;
  /** degrees, clockwise */
  rotation: number;
  flip: boolean;
  tint: [number, number, number] | null;
  opacity: number;
  /** redraw in the map's ink and paper colours */
  ink: boolean;
  /** pinned to this hex (−1 = floats freely) */
  hex: number;
  /** shown from this zoom level to that one */
  minLevel: Level;
  maxLevel: Level;
}

export type SettlementMode = 'keep' | 'size' | 'realm' | 'culture';

export interface SettlementIcons {
  mode: SettlementMode;
  /** by size: realm capital, region seat, other towns */
  size: { capital?: string; seat?: string; town?: string };
  realm: Record<number, string>;
  culture: Record<number, string>;
  /** size multiplier for the town marks */
  scale: number;
  ink: boolean;
}

export interface SymbolData {
  sets: SymbolSet[];
  assets: SymbolAsset[];
  placements: Placement[];
  nextId: number;
  settlements: SettlementIcons;
}

export const MAX_ASSET_BYTES = 2 * 1024 * 1024;
export const LEVEL_NAMES = ['World', 'Realm', 'Province', 'Hex'] as const;
/** CSS px per world unit at which each level begins (mirrors ui/zoomLevels). */
export const LEVEL_FROM = [0, 7, 16, 45];

export const levelOf = (zoom: number): Level => (zoom >= LEVEL_FROM[3] ? 3 : zoom >= LEVEL_FROM[2] ? 2 : zoom >= LEVEL_FROM[1] ? 1 : 0);

export function emptySymbols(): SymbolData {
  return {
    sets: [{ id: 'mine', name: 'My symbols' }],
    assets: [],
    placements: [],
    nextId: 1,
    settlements: { mode: 'keep', size: {}, realm: {}, culture: {}, scale: 1, ink: false },
  };
}

export function ensureSymbols(map: MapData): SymbolData {
  return (map.symbols ??= emptySymbols());
}

export function allSets(map: MapData): SymbolSet[] {
  return [INK_SET, ...(map.symbols?.sets ?? [])];
}

export function allAssets(map: MapData): SymbolAsset[] {
  return [...INK_ASSETS, ...(map.symbols?.assets ?? [])];
}

const builtIn = new Map(INK_ASSETS.map((a) => [a.id, a]));
export function assetById(map: MapData, id: string): SymbolAsset | undefined {
  return builtIn.get(id) ?? map.symbols?.assets.find((a) => a.id === id);
}

export interface PlaceOptions {
  size: number;
  rotation: number;
  flip: boolean;
  tint: [number, number, number] | null;
  opacity: number;
  ink: boolean;
  minLevel: Level;
  maxLevel: Level;
}

export const DEFAULT_PLACE: PlaceOptions = { size: 2.6, rotation: 0, flip: false, tint: null, opacity: 1, ink: false, minLevel: 1, maxLevel: 3 };

/** Places an asset. With `snap`, it sits on the hex centre and is pinned to the hex. */
export function addPlacement(map: MapData, asset: string, x: number, y: number, opts: PlaceOptions, snap: boolean): Placement {
  const s = ensureSymbols(map);
  const p: Placement = { id: s.nextId++, asset, x, y, ...opts, tint: opts.tint ? [...opts.tint] as [number, number, number] : null, hex: -1 };
  if (snap) pinToHex(map, p, x, y);
  s.placements.push(p);
  return p;
}

export function pinToHex(map: MapData, p: Placement, x: number, y: number): void {
  const h = hexAt(map.grid, x, y);
  if (h < 0) return;
  const row = Math.floor(h / map.grid.cols);
  p.hex = h;
  p.x = hexCenterX(h % map.grid.cols, row);
  p.y = hexCenterY(row);
}

/** Height of a placement in world units, from its asset's aspect ratio. */
export function heightOf(map: MapData, p: Placement): number {
  const a = assetById(map, p.asset);
  return a && a.w > 0 ? (p.size * a.h) / a.w : p.size;
}

export function visibleAt(p: Placement, level: Level): boolean {
  return level >= p.minLevel && level <= p.maxLevel;
}

/** Topmost visible placement under a world point. */
export function placementAt(map: MapData, x: number, y: number, zoom: number): Placement | null {
  const ps = map.symbols?.placements ?? [];
  const level = levelOf(zoom);
  const pad = 4 / zoom;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    if (!visibleAt(p, level)) continue;
    // test in the symbol's own frame (rotation)
    const a = (-p.rotation * Math.PI) / 180;
    const dx = x - p.x;
    const dy = y - p.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= p.size / 2 + pad && Math.abs(ly) <= heightOf(map, p) / 2 + pad) return p;
  }
  return null;
}

/** Which asset marks a province's town, or null for the default keep. */
export function settlementAsset(map: MapData, province: number, kind: 'capital' | 'seat' | 'town'): string | null {
  const st = map.symbols?.settlements;
  if (!st || st.mode === 'keep') return null;
  if (st.mode === 'size') return st.size[kind] ?? null;
  const p = map.provinces[province];
  const realmId = map.regions[p.region]?.realm;
  if (st.mode === 'realm') return st.realm[realmId] ?? null;
  const culture = map.realms[realmId]?.culture;
  return culture === undefined ? null : (st.culture[culture] ?? null);
}

/** Removes an asset and everything that uses it. Returns how many placements went. */
export function removeAsset(map: MapData, id: string): number {
  const s = map.symbols;
  if (!s) return 0;
  const before = s.placements.length;
  s.assets = s.assets.filter((a) => a.id !== id);
  s.placements = s.placements.filter((p) => p.asset !== id);
  const st = s.settlements;
  for (const k of ['capital', 'seat', 'town'] as const) if (st.size[k] === id) delete st.size[k];
  for (const rec of [st.realm, st.culture]) for (const k of Object.keys(rec)) if (rec[Number(k)] === id) delete rec[Number(k)];
  return before - s.placements.length;
}

export function usageOf(map: MapData, id: string): number {
  return (map.symbols?.placements ?? []).filter((p) => p.asset === id).length;
}

// ------------------------------------------------------------ importing

export class ImportError extends Error {}

/**
 * Turns a file into an asset. SVGs are cleaned of scripts, event handlers,
 * embedded HTML and links to other files, so a symbol can only ever be a
 * picture. Files over 2 MB are refused.
 */
export function assetFromFile(name: string, bytes: Uint8Array, set: string, id: string): SymbolAsset {
  const base = name.replace(/^.*[\\/]/, '');
  if (bytes.length > MAX_ASSET_BYTES) throw new ImportError(`${base} is larger than 2 MB (${(bytes.length / 1048576).toFixed(2)} MB), the limit for a symbol. Shrink or simplify it and try again.`);
  const label = prettyName(base);
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const w = dv.getUint32(16);
    const h = dv.getUint32(20);
    if (!w || !h) throw new ImportError(`${base} is not a readable PNG image.`);
    return { id, name: label, set, tags: [], kind: 'png', data: `data:image/png;base64,${toBase64(bytes)}`, w, h };
  }
  const text = new TextDecoder().decode(bytes);
  if (/\.svg$/i.test(base) || /<svg[\s>]/i.test(text)) {
    const svg = sanitizeSvg(text);
    if (!svg) throw new ImportError(`${base} does not contain an SVG picture.`);
    const [w, h] = svgSize(svg);
    return { id, name: label, set, tags: [], kind: 'svg', data: svg, w, h };
  }
  throw new ImportError(`${base} is not an SVG or PNG file.`);
}

export function sanitizeSvg(text: string): string | null {
  const start = text.search(/<svg[\s>]/i);
  const end = text.toLowerCase().lastIndexOf('</svg>');
  if (start < 0 || end < start) return null;
  let s = text.slice(start, end + 6);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|foreignObject|iframe|object|embed|audio|video)[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(script|foreignObject|iframe|object|embed|audio|video)\b[^>]*\/>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // links may only point inside the file or at embedded images
  s = s.replace(/\s+(xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _x, _q, a, b) => {
    const v = (a ?? b ?? '').trim();
    return v.startsWith('#') || /^data:image\/(png|jpeg|gif|webp);/i.test(v) ? m : '';
  });
  s = s.replace(/javascript:/gi, '');
  // the <img> loader needs the SVG namespace
  if (!/xmlns\s*=/.test(s.slice(0, s.indexOf('>')))) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

export function svgSize(svg: string): [number, number] {
  const head = svg.slice(0, svg.indexOf('>') + 1);
  const vb = /viewBox\s*=\s*["']\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/i.exec(head);
  if (vb && Number(vb[3]) > 0 && Number(vb[4]) > 0) return [Number(vb[3]), Number(vb[4])];
  const w = /\swidth\s*=\s*["']([\d.]+)/i.exec(head);
  const h = /\sheight\s*=\s*["']([\d.]+)/i.exec(head);
  if (w && h) return [Number(w[1]), Number(h[1])];
  return [64, 64];
}

function prettyName(file: string): string {
  const n = file
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return n ? n[0].toUpperCase() + n.slice(1) : 'Symbol';
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------ set files

export const SET_FORMAT = 'cartographer-symbol-set';

export function setFile(map: MapData, setId: string): string {
  const set = allSets(map).find((s) => s.id === setId);
  const assets = allAssets(map).filter((a) => a.set === setId);
  return JSON.stringify({ format: SET_FORMAT, version: 1, set, assets });
}

/** Reads a symbol-set file; ids are renewed so they never clash with this map's. */
export function readSetFile(text: string, newId: () => string): { set: SymbolSet; assets: SymbolAsset[] } {
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new ImportError('That file is not a Cartographer symbol set.');
  }
  if (obj?.format !== SET_FORMAT || !Array.isArray(obj.assets)) throw new ImportError('That file is not a Cartographer symbol set.');
  const setId = newId();
  const set: SymbolSet = { id: setId, name: String(obj.set?.name ?? 'Imported symbols') };
  const assets: SymbolAsset[] = [];
  for (const a of obj.assets) {
    if (a?.kind === 'svg' && typeof a.data === 'string') {
      const svg = sanitizeSvg(a.data);
      if (!svg) continue;
      const [w, h] = svgSize(svg);
      assets.push({ id: newId(), name: String(a.name ?? 'Symbol'), set: setId, tags: Array.isArray(a.tags) ? a.tags.map(String) : [], kind: 'svg', data: svg, w, h });
    } else if (a?.kind === 'png' && typeof a.data === 'string' && a.data.startsWith('data:image/png;base64,')) {
      assets.push({ id: newId(), name: String(a.name ?? 'Symbol'), set: setId, tags: Array.isArray(a.tags) ? a.tags.map(String) : [], kind: 'png', data: a.data, w: Number(a.w) || 64, h: Number(a.h) || 64 });
    }
  }
  return { set, assets };
}

export function newAssetId(map: MapData): string {
  const s = ensureSymbols(map);
  return `a${s.nextId++}`;
}

// ------------------------------------------------------------ undo

export interface SymbolSnapshot {
  json: string;
  data: Map<string, string>;
}

/** Cheap snapshot: asset pictures are kept by reference, everything else as JSON. */
export function snapshotSymbols(map: MapData): SymbolSnapshot {
  const s = map.symbols;
  if (!s) return { json: 'null', data: new Map() };
  return {
    json: JSON.stringify({ ...s, assets: s.assets.map(({ data: _d, ...rest }) => rest) }),
    data: new Map(s.assets.map((a) => [a.id, a.data])),
  };
}

export function restoreSymbols(map: MapData, snap: SymbolSnapshot): void {
  const o = JSON.parse(snap.json);
  if (!o) {
    delete map.symbols;
    return;
  }
  o.assets = o.assets.map((a: Omit<SymbolAsset, 'data'>) => ({ ...a, data: snap.data.get(a.id) ?? '' }));
  map.symbols = o;
}

// ------------------------------------------------------------ export

/** Pinned symbols for the game export, by hex. */
export function pinnedForExport(map: MapData) {
  return (map.symbols?.placements ?? [])
    .filter((p) => p.hex >= 0)
    .map((p) => {
      const a = assetById(map, p.asset);
      return { id: p.id, hex: p.hex, symbol: a?.name ?? p.asset, assetId: p.asset, set: a ? (allSets(map).find((s) => s.id === a.set)?.name ?? a.set) : '', tags: a?.tags ?? [] };
    });
}
