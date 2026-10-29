import { BIOME_NAMES, HexFlag, TERRAIN_NAMES, Terrain, type MapData } from '../model/types';
import { buildNeighbors, hexAt, hexCenterX, hexCenterY, sampleField, toAxial } from '../model/hex';
import { ownerAt, buildWarp } from '../render/assets';
import { TERRAIN_COLORS } from '../render/mapModes';
import { DEPTH_METRES, ELEVATION_METRES } from '../gen/biomes';
import type { RawImage } from './png';
import { assetById } from '../model/symbols';

/**
 * Game-engine maps: the province ID image (one unique colour per province and
 * sea zone, as Paradox games use), heightmaps, terrain index and masks, water
 * and river masks, and plain CSV tables. Pure functions over MapData, run in
 * the export worker.
 */

export type Progress = (fraction: number) => void;

// ------------------------------------------------------------ sea zones

export interface SeaZone {
  /** id in the province image and definition.csv (land provinces keep their own ids) */
  id: number;
  index: number;
  kind: 'sea' | 'lake';
  name: string;
  hexes: number[];
  /** land provinces touching this zone */
  coast: number[];
}

/** Sea zones and lakes are numbered from here, clear of any land province id. */
export const SEA_ID_BASE = 100000;

/**
 * Splits the water into zones of roughly `size` × `size` hexes (each lake is
 * one zone), so the sea can be sailed province by province. Deterministic.
 */
export function seaZones(map: MapData, size = 11): { zones: SeaZone[]; zoneOf: Int32Array } {
  const { cols, rows } = map.grid;
  const n = cols * rows;
  const nbr = buildNeighbors(map.grid);
  const water = (h: number) => !(map.hex.flags[h] & HexFlag.Land);
  const lake = (h: number) => (map.hex.flags[h] & HexFlag.Lake) !== 0;
  const zoneOf = new Int32Array(n).fill(-1);
  const zones: SeaZone[] = [];
  const add = (kind: 'sea' | 'lake') => {
    const index = zones.length;
    zones.push({ id: SEA_ID_BASE + index, index, kind, name: '', hexes: [], coast: [] });
    return index;
  };
  // lakes: one zone each
  for (let h = 0; h < n; h++) {
    if (!lake(h) || zoneOf[h] >= 0) continue;
    const z = add('lake');
    const q = [h];
    zoneOf[h] = z;
    for (let i = 0; i < q.length; i++)
      for (let d = 0; d < 6; d++) {
        const j = nbr[q[i] * 6 + d];
        if (j >= 0 && lake(j) && zoneOf[j] < 0) {
          zoneOf[j] = z;
          q.push(j);
        }
      }
  }
  // sea: one seed per grid cell, then grow from all seeds at once
  const frontier: number[] = [];
  for (let cy = 0; cy < rows; cy += size)
    for (let cx = 0; cx < cols; cx += size) {
      // a seeded nudge per cell, so zones are irregular rather than a grid
      const jx = (hash2(cx, cy, 1) - 0.5) * size * 0.8;
      const jy = (hash2(cx, cy, 2) - 0.5) * size * 0.8;
      const mx = Math.min(cols - 1, cx + (size >> 1) + jx);
      const my = Math.min(rows - 1, cy + (size >> 1) + jy);
      let best = -1;
      let bd = Infinity;
      for (let y = cy; y < Math.min(rows, cy + size); y++)
        for (let x = cx; x < Math.min(cols, cx + size); x++) {
          const h = y * cols + x;
          if (!water(h) || lake(h)) continue;
          const d = (x - mx) ** 2 + (y - my) ** 2;
          if (d < bd) {
            bd = d;
            best = h;
          }
        }
      if (best >= 0) {
        zoneOf[best] = add('sea');
        frontier.push(best);
      }
    }
  // grow all zones at once; each hex costs a little noise to cross, so the
  // borders between zones wander instead of running straight
  const grow = (start: number[]) => {
    const cost = new Float64Array(n).fill(Infinity);
    const heap = new MinHeap();
    for (const h of start) {
      cost[h] = 0;
      heap.push(h, 0);
    }
    while (heap.size) {
      const [h, c] = heap.pop();
      if (c > cost[h]) continue;
      for (let d = 0; d < 6; d++) {
        const j = nbr[h * 6 + d];
        if (j < 0 || !water(j) || lake(j)) continue;
        if (zoneOf[j] >= 0 && (cost[j] <= c || cost[j] === Infinity)) continue;
        const nc = c + 0.6 + 0.8 * hash2(j % cols, Math.floor(j / cols), 7);
        if (nc < cost[j]) {
          cost[j] = nc;
          zoneOf[j] = zoneOf[h];
          heap.push(j, nc);
        }
      }
    }
  };
  grow(frontier);
  // enclosed bits of sea no seed reached
  for (let h = 0; h < n; h++)
    if (water(h) && zoneOf[h] < 0) {
      zoneOf[h] = add('sea');
      grow([h]);
    }
  for (let h = 0; h < n; h++) if (zoneOf[h] >= 0) zones[zoneOf[h]].hexes.push(h);
  // coasts and names
  for (const z of zones) {
    const coast = new Map<number, number>();
    for (const h of z.hexes)
      for (let d = 0; d < 6; d++) {
        const j = nbr[h * 6 + d];
        const p = j >= 0 ? map.hex.province[j] : -1;
        if (p >= 0) coast.set(p, (coast.get(p) ?? 0) + 1);
      }
    z.coast = [...coast.keys()].sort((a, b) => a - b);
    let main = -1;
    let most = 0;
    coast.forEach((c, p) => {
      if (c > most) {
        most = c;
        main = p;
      }
    });
    const near = main >= 0 ? map.provinces[main]?.name : null;
    z.name = z.kind === 'lake' ? (near ? `Lake of ${near}` : `Lake ${z.index + 1}`) : near ? `Waters of ${near}` : `Open sea ${z.index + 1}`;
  }
  return { zones, zoneOf };
}

function hash2(x: number, y: number, k: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + k * 2246822519, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** A small binary min-heap of (hex, cost). */
class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    const a = this.ids;
    const k = this.keys;
    a.push(id);
    k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]];
      [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.ids;
    const k = this.keys;
    const top: [number, number] = [a[0], k[0]];
    const lastId = a.pop()!;
    const lastKey = k.pop()!;
    if (a.length) {
      a[0] = lastId;
      k[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}

// ------------------------------------------------------------ colours

/**
 * A unique, stable colour per id: the id is spread over 24 bits by an odd
 * multiplier (a bijection), so neighbouring ids get unlike colours and no two
 * ids ever share one. Black is never used.
 */
export function idColor(id: number): [number, number, number] {
  let v = (Math.imul(id + 1, 0x9e3779) >>> 0) & 0xffffff;
  if (v === 0) v = 0x010101;
  return [v >> 16, (v >> 8) & 255, v & 255];
}

// ------------------------------------------------------------ rasters

/** The hex at a point, or the nearest edge hex for points past the ragged grid border. */
export function hexNear(map: MapData, x: number, y: number): number {
  const h = hexAt(map.grid, x, y);
  if (h >= 0) return h;
  const { cols, rows } = map.grid;
  const row = Math.max(0, Math.min(rows - 1, Math.round((y - 1) / 1.5)));
  const col = Math.max(0, Math.min(cols - 1, Math.round((x - Math.sqrt(3) / 2) / Math.sqrt(3) - 0.5 * (row & 1))));
  return row * cols + col;
}

/** Output size for a world width in pixels. */
export function sizeFor(map: MapData, width: number): { width: number; height: number; scale: number } {
  const scale = width / map.world.width;
  return { width, height: Math.round(map.world.height * scale), scale };
}

export interface ProvinceMap {
  image: RawImage;
  definition: string;
}

/**
 * The province ID image: every pixel the colour of its land province or sea
 * zone. `smooth` follows the drawn (curved) borders and coastline; otherwise
 * pixels follow hex edges exactly.
 */
export function provinceMap(map: MapData, width: number, smooth: boolean, onProgress?: Progress): ProvinceMap {
  const { height, scale } = sizeFor(map, width);
  const { zones, zoneOf } = seaZones(map);
  const data = new Uint8Array(width * height * 3);
  const warp = smooth ? buildWarp(map) : null;
  const colorOfProvince = map.provinces.map((p) => idColor(p.id));
  const colorOfZone = zones.map((z) => idColor(z.id));
  const nbr = smooth ? buildNeighbors(map.grid) : null;
  const waterZoneNear = (h: number): number => {
    if (zoneOf[h] >= 0) return zoneOf[h];
    for (let d = 0; d < 6; d++) {
      const j = nbr![h * 6 + d];
      if (j >= 0 && zoneOf[j] >= 0) return zoneOf[j];
    }
    return 0;
  };
  for (let y = 0; y < height; y++) {
    const wy = (y + 0.5) / scale;
    for (let x = 0; x < width; x++) {
      const wx = (x + 0.5) / scale;
      const h = hexNear(map, wx, wy);
      let c: [number, number, number] = [0, 0, 0];
      {
        if (smooth) {
          const p = ownerAt(map, warp!, wx, wy);
          if (p >= 0) c = colorOfProvince[p];
          else if (zones.length) c = colorOfZone[waterZoneNear(h)];
        } else {
          const p = map.hex.province[h];
          if (p >= 0) c = colorOfProvince[p];
          else if (zoneOf[h] >= 0) c = colorOfZone[zoneOf[h]];
        }
      }
      const o = (y * width + x) * 3;
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
    }
    if (onProgress && y % 64 === 0) onProgress(y / height);
  }
  const lines = ['province;red;green;blue;name;type;x;y'];
  for (const p of map.provinces) {
    if (p.retired) continue;
    const [r, g, b] = colorOfProvince[p.id];
    lines.push([p.id, r, g, b, csvSafe(p.name, ';'), 'land', Math.round(p.center[0] * scale), Math.round(p.center[1] * scale)].join(';'));
  }
  for (const z of zones) {
    const [r, g, b] = colorOfZone[z.index];
    const h = z.hexes[Math.floor(z.hexes.length / 2)];
    const row = Math.floor(h / map.grid.cols);
    lines.push([z.id, r, g, b, csvSafe(z.name, ';'), z.kind, Math.round(hexCenterX(h % map.grid.cols, row) * scale), Math.round(hexCenterY(row) * scale)].join(';'));
  }
  return { image: { width, height, channels: 3, depth: 8, data }, definition: lines.join('\n') + '\n' };
}

/**
 * Heightmaps from the continuous heightfield. 16-bit: 0 = deepest sea,
 * 32768 = sea level, 65535 = highest peak. 8-bit: sea 0–95, sea level 96,
 * land 96–255.
 */
export function heightmaps(map: MapData, width: number): { h16: RawImage; h8: RawImage } {
  const { height, scale } = sizeFor(map, width);
  const d16 = new Uint16Array(width * height);
  const d8 = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const e = Math.max(-1, Math.min(1, sampleField(map.height, (x + 0.5) / scale, (y + 0.5) / scale)));
      const i = y * width + x;
      d16[i] = e < 0 ? Math.round((e + 1) * 32767) : 32768 + Math.round(e * 32767);
      d8[i] = e < 0 ? Math.round((e + 1) * 95) : 96 + Math.round(e * 159);
    }
  return { h16: { width, height, channels: 1, depth: 16, data: d16 }, h8: { width, height, channels: 1, depth: 8, data: d8 } };
}

/** Terrain colour index image and one black-and-white mask per terrain in use. */
export function terrainMaps(map: MapData, width: number): { index: RawImage; masks: { name: string; code: number; image: RawImage }[]; water: RawImage } {
  const { height, scale } = sizeFor(map, width);
  const idx = new Uint8Array(width * height * 3);
  const codes = new Uint8Array(width * height);
  const water = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const wx = (x + 0.5) / scale;
      const wy = (y + 0.5) / scale;
      const t = map.hex.terrain[hexNear(map, wx, wy)] as Terrain;
      const i = y * width + x;
      codes[i] = t;
      const c = TERRAIN_COLORS[t as Terrain];
      idx[i * 3] = c[0];
      idx[i * 3 + 1] = c[1];
      idx[i * 3 + 2] = c[2];
      // the coastline follows the drawn shore, not hex edges
      water[i] = sampleField(map.height, wx, wy) < 0 ? 255 : 0;
    }
  const present = [...new Set(codes)].sort((a, b) => a - b);
  const masks = present.map((code) => {
    const m = new Uint8Array(width * height);
    for (let i = 0; i < m.length; i++) m[i] = codes[i] === code ? 255 : 0;
    return { code, name: slugName(TERRAIN_NAMES[code as Terrain]), image: { width, height, channels: 1 as const, depth: 8 as const, data: m } };
  });
  return { index: { width, height, channels: 3, depth: 8, data: idx }, masks, water: { width, height, channels: 1, depth: 8, data: water } };
}

/** River mask: white lines along every river, wider downstream. */
export function riverMask(map: MapData, width: number): RawImage {
  const { height, scale } = sizeFor(map, width);
  const data = new Uint8Array(width * height);
  const { cols } = map.grid;
  let maxFlux = 1;
  for (const r of map.rivers) for (const h of r.hexes) maxFlux = Math.max(maxFlux, map.hex.flux[h] || 0);
  const centre = (h: number): [number, number] => {
    const row = Math.floor(h / cols);
    return [hexCenterX(h % cols, row) * scale, hexCenterY(row) * scale];
  };
  for (const r of map.rivers) {
    for (let k = 0; k + 1 < r.hexes.length; k++) {
      const a = centre(r.hexes[k]);
      const b = centre(r.hexes[k + 1]);
      const f = Math.sqrt(Math.max(0, map.hex.flux[r.hexes[k]] || 0) / maxFlux);
      const w = Math.max(0.6, (0.12 + 0.35 * f) * scale);
      stamp(data, width, height, a, b, w);
    }
  }
  return { width, height, channels: 1, depth: 8, data };
}

function stamp(data: Uint8Array, w: number, h: number, a: [number, number], b: [number, number], r: number): void {
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - r - 1));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0]) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - r - 1));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1]) + r + 1));
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a[0];
      const py = y + 0.5 - a[1];
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const d = Math.hypot(px - t * dx, py - t * dy);
      const v = Math.round(255 * Math.max(0, Math.min(1, r + 0.5 - d)));
      const i = y * w + x;
      if (v > data[i]) data[i] = v;
    }
}

// ------------------------------------------------------------ tables

export function csvSafe(s: string, sep = ','): string {
  return s.includes(sep) || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tables(map: MapData): Record<string, string> {
  const row = (vals: (string | number | boolean)[]) => vals.map((v) => (typeof v === 'string' ? csvSafe(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v)).join(',');
  const { cols, rows } = map.grid;
  const { zoneOf, zones } = seaZones(map);
  const hexes = ['hex_id,col,row,q,r,land,elevation,elevation_m,temperature_c,rainfall,biome,terrain,coastal,lake,river,province,sea_zone'];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const f = map.hex.flags[i];
      const e = map.hex.elevation[i];
      const [q, r] = toAxial(x, y);
      hexes.push(
        row([
          i,
          x,
          y,
          q,
          r,
          !!(f & HexFlag.Land),
          Math.round(e * 10000) / 10000,
          Math.round(e >= 0 ? e * ELEVATION_METRES : e * DEPTH_METRES),
          Math.round(map.hex.temperature[i] * 10) / 10,
          Math.round(map.hex.moisture[i] * 1000) / 1000,
          BIOME_NAMES[map.hex.biome[i] as 0],
          TERRAIN_NAMES[map.hex.terrain[i] as 0],
          !!(f & HexFlag.Coastal),
          !!(f & HexFlag.Lake),
          !!(f & HexFlag.River),
          map.hex.province[i],
          zoneOf[i] >= 0 ? zones[zoneOf[i]].id : -1,
        ]),
      );
    }
  const provinces = ['province_id,name,region_id,region,realm_id,realm,terrain,coastal,hex_count,capital_hex,x,y,neighbors,sea_neighbors,sea_zones'];
  const zonesOf = new Map<number, number[]>();
  for (const z of zones) for (const p of z.coast) zonesOf.set(p, [...(zonesOf.get(p) ?? []), z.id]);
  for (const p of map.provinces) {
    if (p.retired) continue;
    const g = map.regions[p.region];
    const r = map.realms[g.realm];
    provinces.push(row([p.id, p.name, g.id, g.name, r.id, r.name, TERRAIN_NAMES[p.terrain], p.coastal, p.hexes.length, p.capitalHex, Math.round(p.center[0] * 1000) / 1000, Math.round(p.center[1] * 1000) / 1000, p.neighbors.join(' '), p.seaNeighbors.join(' '), (zonesOf.get(p.id) ?? []).join(' ')]));
  }
  const regions = ['region_id,name,realm_id,capital_province,provinces'];
  for (const g of map.regions) if (!g.retired) regions.push(row([g.id, g.name, g.realm, g.capitalProvince, g.provinces.join(' ')]));
  const realms = ['realm_id,name,title,culture,color,capital_province,regions'];
  for (const r of map.realms) if (!r.retired) realms.push(row([r.id, r.name, r.title, map.cultures[r.culture]?.name ?? '', '#' + r.color.map((c) => c.toString(16).padStart(2, '0')).join(''), r.capitalProvince, r.regions.join(' ')]));
  const seas = ['sea_zone_id,name,kind,hex_count,coastal_provinces'];
  for (const z of zones) seas.push(row([z.id, z.name, z.kind, z.hexes.length, z.coast.join(' ')]));
  const out: Record<string, string> = {
    'hexes.csv': hexes.join('\n') + '\n',
    'provinces.csv': provinces.join('\n') + '\n',
    'regions.csv': regions.join('\n') + '\n',
    'realms.csv': realms.join('\n') + '\n',
    'sea_zones.csv': seas.join('\n') + '\n',
  };
  const pins = (map.symbols?.placements ?? []).filter((p) => p.hex >= 0);
  if (pins.length) {
    const s = ['symbol_id,hex_id,col,row,symbol,asset_id,x,y'];
    for (const p of pins) s.push(row([p.id, p.hex, p.hex % cols, Math.floor(p.hex / cols), assetById(map, p.asset)?.name ?? p.asset, p.asset, Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]));
    out['symbols.csv'] = s.join('\n') + '\n';
  }
  return out;
}

function slugName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
