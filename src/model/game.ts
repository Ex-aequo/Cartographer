import { DEFAULT_GAME, type GameSettings, type GenParams, type Province, type Realm, type Region } from './types';

/** Columns per row of a 4X map, the same shape as the classic sizes. */
const GAME_ASPECT = 300 / 190;

export function sanitizeGame(g: GameSettings | undefined): GameSettings | undefined {
  if (!g) return undefined;
  const c = (v: number, a: number, b: number) => Math.round(Math.min(b, Math.max(a, Number.isFinite(v) ? v : a)));
  const pMin = c(g.provinces?.[0] ?? DEFAULT_GAME.provinces[0], 1, 30);
  const pMax = c(g.provinces?.[1] ?? DEFAULT_GAME.provinces[1], pMin, 40);
  const hMin = c(g.hexes?.[0] ?? DEFAULT_GAME.hexes[0], 1, 30);
  const hMax = c(g.hexes?.[1] ?? DEFAULT_GAME.hexes[1], hMin, 40);
  return {
    on: !!g.on,
    players: c(g.players, 2, 200),
    provinces: [pMin, pMax],
    hexes: [hMin, hMax],
    free: Math.min(0.8, Math.max(0, Number.isFinite(g.free) ? g.free : DEFAULT_GAME.free)),
    balanced: g.balanced !== false,
  };
}

/**
 * Grid size of a 4X map: enough land for every kingdom at its average size,
 * plus the free share, plus a margin for islets and lakes that cannot hold a
 * province, at the chosen land share.
 */
export function gameGrid(g: GameSettings, landFraction: number): { cols: number; rows: number } {
  const avgProvinces = (g.provinces[0] + g.provinces[1]) / 2;
  const avgHexes = (g.hexes[0] + g.hexes[1]) / 2;
  const kingdomLand = g.players * avgProvinces * avgHexes;
  const land = (kingdomLand / Math.max(0.2, 1 - g.free)) * 1.12;
  const total = land / Math.max(0.15, landFraction);
  const rows = Math.max(14, Math.round(Math.sqrt(total / GAME_ASPECT)));
  const cols = Math.max(22, Math.round(rows * GAME_ASPECT));
  return { cols, rows };
}

/** How each province and kingdom compares with the intervals (for the report and the inspector). */
export function gameReport(map: { meta: { params: GenParams }; provinces: Province[]; regions: Region[]; realms: Realm[] }) {
  const g = map.meta.params.game;
  if (!g?.on) return null;
  const provincesOut = map.provinces.filter((pr) => !pr.retired && (pr.hexes.length < g.hexes[0] || pr.hexes.length > g.hexes[1])).map((pr) => pr.id);
  const kingdoms = map.realms.filter((r) => !r.retired && !r.unclaimed);
  const sizeOf = (r: Realm) => r.regions.reduce((a, k) => a + map.regions[k].provinces.length, 0);
  const kingdomsOut = kingdoms.filter((r) => sizeOf(r) < g.provinces[0] || sizeOf(r) > g.provinces[1]).map((r) => r.id);
  let freeProvinces = 0;
  let allProvinces = 0;
  for (const pr of map.provinces) {
    if (pr.retired) continue;
    allProvinces++;
    const realm = map.realms[map.regions[pr.region]?.realm];
    if (realm?.unclaimed) freeProvinces++;
  }
  return { players: kingdoms.length, provincesOut, kingdomsOut, freeShare: allProvinces ? freeProvinces / allProvinces : 0, sizeOf };
}
