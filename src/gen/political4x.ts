import { activeRaces, kingdomCounts, makeupOf, suitability, type RaceDef } from '../model/races';
import type { Culture, GameSettings, GenParams, HexLayers, Province, Realm, Region, River } from '../model/types';
import { HexFlag, Relief, Terrain } from '../model/types';
import { hexCenterX, hexCenterY, type Grid } from '../model/hex';
import { Rng } from '../util/rng';
import { makeCulture, NameForge, paletteIndexOf, PALETTE_COUNT, type NameCulture } from './names';
import { assignColors, centroidOf, computeAdjacency, dist2, farthestPoints, provinceFacts, type Political } from './political';

/**
 * Political map of a 4X game: hex → province → kingdom, with no region level.
 *
 * 1. Land is cut into provinces of `hexes[0]..hexes[1]` hexes. Islets too
 *    small for a province of their own join the nearest coast across the water.
 * 2. One kingdom per player starts on good land, spread evenly, and takes
 *    provinces in turns (the poorest kingdom picks first when balanced) until
 *    it has its share, within `provinces[0]..provinces[1]`. Kingdoms may reach
 *    across narrow water.
 * 3. Whatever is left is free land: one "unclaimed" realm holds it, grouped
 *    into regions by connected area.
 *
 * In the data the region level still exists (one region per kingdom), so
 * every editing tool, save file and export keeps working unchanged.
 */

/** Unclaimed land: drawn as plain land, with no realm wash. */
export const FREE_COLOR: [number, number, number] = [196, 186, 160];

export function buildGamePolitical(p: GenParams, grid: Grid, hex: HexLayers, nbr: Int32Array, rivers: River[], rngRoot: Rng): Political {
  const g = p.game!;
  const rng = rngRoot.fork('political-4x');
  const n = grid.cols * grid.rows;
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / grid.cols);
    cx[i] = hexCenterX(i % grid.cols, row);
    cy[i] = hexCenterY(row);
  }

  // ---------- Provinces ----------
  const of = partitionProvinces(g, hex, nbr, cx, cy, rng.fork('prov'));
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const k = of[i];
    if (k < 0) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  // stable ids: top-left first
  const order = [...groups.values()].sort((a, b) => a[0] - b[0]);
  hex.province.fill(-1);
  order.forEach((hs, id) => {
    for (const h of hs) hex.province[h] = id;
  });
  const provinces: Province[] = order.map((hs, id) => {
    const f = provinceFacts(hex, hs, cx, cy, -1);
    hex.flags[f.capitalHex] |= HexFlag.Capital;
    return { id, name: '', hexes: hs, region: -1, neighbors: [], seaNeighbors: [], ...f };
  });
  computeAdjacency(provinces, hex, nbr);
  const P = provinces.length;

  // ---------- Kingdoms ----------
  const worth = provinces.map((pr) => provinceWorth(hex, pr));
  const races = activeRaces(p.races);
  const players = Math.min(g.players, Math.max(1, Math.floor(P / Math.max(1, g.provinces[0]))));
  const targets = kingdomTargets(g, players, P, rng.fork('targets'));
  const slotRace: (RaceDef | null)[] = new Array(players).fill(null);
  if (races.length) {
    const counts = kingdomCounts(races, players);
    let k = 0;
    for (const race of races) for (let c = 0; c < (counts.get(race.id) ?? 0) && k < players; c++) slotRace[k++] = race;
  }
  const suitCache = new Map<string, number[]>();
  const suitOf = (race: RaceDef) => {
    if (!suitCache.has(race.id)) suitCache.set(race.id, provinces.map((pr) => suitability(race, makeupOf({ hex }, neighbourhood(provinces, pr.id)))));
    return suitCache.get(race.id)!;
  };
  const owner = new Int32Array(P).fill(-1);
  // typical distance between capitals
  const spacingK = Math.sqrt((grid.cols * grid.rows * 2.6) / Math.max(1, players)) * 0.6;
  const capitals = pickCapitals(provinces, worth, targets, slotRace, suitOf, rng.fork('capitals'));
  capitals.forEach((c, k) => (owner[c] = k));
  const size = new Int32Array(players).fill(1);
  const value = capitals.map((c) => worth[c]);
  // provinces take turns: in balanced mode the poorest kingdom chooses first
  for (let round = 0; round < 200; round++) {
    let grew = false;
    const turn = Array.from({ length: players }, (_, k) => k);
    if (g.balanced) turn.sort((a, b) => value[a] / size[a] - value[b] / size[b] || size[a] - size[b]);
    else rng.shuffle(turn);
    for (const k of turn) {
      if (size[k] >= targets[k]) continue;
      const pick = bestFrontier(k, owner, provinces, worth, capitals[k], slotRace[k] ? suitOf(slotRace[k]!) : null);
      if (pick < 0) continue;
      owner[pick] = k;
      size[k]++;
      value[k] += worth[pick];
      grew = true;
    }
    if (!grew) break;
  }
  // kingdoms boxed in by their neighbours: pass provinces along a chain of kingdoms to them
  shortKingdoms(owner, size, targets, capitals, provinces, g.provinces[0], (k) => {
    const pick = bestFrontier(k, owner, provinces, worth, capitals[k], slotRace[k] ? suitOf(slotRace[k]!) : null);
    if (pick >= 0) {
      owner[pick] = k;
      size[k]++;
      value[k] += worth[pick];
    }
    return pick >= 0;
  }, (k) => {
    // the open stretch of free land with the most room, as far from other capitals as possible
    const comp = new Int32Array(P).fill(-1);
    const compSize: number[] = [];
    for (let q = 0; q < P; q++) {
      if (owner[q] >= 0 || comp[q] >= 0) continue;
      const id = compSize.length;
      let c = 0;
      const st = [q];
      comp[q] = id;
      while (st.length) {
        const a = st.pop()!;
        c++;
        for (const b of [...provinces[a].neighbors, ...provinces[a].seaNeighbors]) if (owner[b] < 0 && comp[b] < 0) (comp[b] = id, st.push(b));
      }
      compSize.push(c);
    }
    let best = -1;
    let bs = -Infinity;
    for (let q = 0; q < P; q++) {
      if (owner[q] >= 0 || compSize[comp[q]] < targets[k]) continue;
      let dmin = Infinity;
      for (let o = 0; o < players; o++) if (o !== k) dmin = Math.min(dmin, dist2(provinces[capitals[o]].center, provinces[q].center));
      // inland of the free area, on good land: count free neighbours and what they are worth
      const freeNb = provinces[q].neighbors.filter((r) => owner[r] < 0);
      const local = worth[q] + freeNb.reduce((a, r) => a + worth[r], 0);
      const spread = Math.min(1.5, Math.sqrt(dmin) / spacingK);
      const score = spread * 3 + freeNb.length * 1.2 + local * 1.2;
      if (score > bs) {
        bs = score;
        best = q;
      }
    }
    if (best < 0) return false;
    for (let q = 0; q < P; q++) if (owner[q] === k) owner[q] = -1;
    owner[best] = k;
    capitals[k] = best;
    size[k] = 1;
    value[k] = worth[best];
    while (size[k] < targets[k]) {
      const pick = bestFrontier(k, owner, provinces, worth, best, slotRace[k] ? suitOf(slotRace[k]!) : null);
      if (pick < 0) break;
      owner[pick] = k;
      size[k]++;
      value[k] += worth[pick];
    }
    return true;
  });
  // a kingdom left one over (a chain that broke off) hands its outermost province back
  for (let k = 0; k < players; k++) {
    const limit = g.balanced ? targets[k] : g.provinces[1];
    for (let guard = 0; size[k] > limit && guard < 20; guard++) {
      let drop = -1;
      let far = -1;
      for (let q = 0; q < P; q++) {
        if (owner[q] !== k || q === capitals[k]) continue;
        owner[q] = -2;
        const ok = connectedFrom(capitals[k], k, owner, provinces) === size[k] - 1;
        owner[q] = k;
        const d = dist2(provinces[q].center, provinces[capitals[k]].center);
        if (ok && d > far) {
          far = d;
          drop = q;
        }
      }
      if (drop < 0) break;
      owner[drop] = -1;
      size[k]--;
      value[k] -= worth[drop];
    }
  }
  // balanced: the poorest kingdoms trade a poor province for a better free one beside them
  if (g.balanced) {
    for (let it = 0; it < players * 6; it++) {
      const mean = value.reduce((a, b) => a + b, 0) / players;
      const k = value.indexOf(Math.min(...value));
      if (value[k] >= mean * 0.9) break;
      let best: [number, number] | null = null;
      let gain = 0;
      for (let q = 0; q < P; q++) {
        if (owner[q] !== k || q === capitals[k]) continue;
        for (let f = 0; f < P; f++) {
          if (owner[f] >= 0 || worth[f] - worth[q] <= gain) continue;
          // f must touch the kingdom without q, and the kingdom must stay in one piece
          owner[q] = -2;
          const touches = [...provinces[f].neighbors, ...provinces[f].seaNeighbors].some((r) => owner[r] === k);
          let ok = false;
          if (touches) {
            owner[f] = k;
            ok = connectedFrom(capitals[k], k, owner, provinces) === size[k];
            owner[f] = -1;
          }
          owner[q] = k;
          if (ok) {
            gain = worth[f] - worth[q];
            best = [q, f];
          }
        }
      }
      if (!best) {
        value[k] = mean * 0.9; // nothing better nearby: stop trying this one
        continue;
      }
      owner[best[0]] = -1;
      owner[best[1]] = k;
      value[k] += gain;
    }
  }
  // with no free land asked for, leftovers join kingdoms that still have room
  if (g.free <= 0.001) {
    for (let pass = 0; pass < 4; pass++)
      for (let q = 0; q < P; q++) {
        if (owner[q] >= 0) continue;
        let best = -1;
        for (const r of [...provinces[q].neighbors, ...provinces[q].seaNeighbors]) {
          const k = owner[r];
          if (k >= 0 && size[k] < g.provinces[1] && (best < 0 || size[k] < size[best])) best = k;
        }
        if (best >= 0) {
          owner[q] = best;
          size[best]++;
        }
      }
  }

  // the capital moves to the kingdom's best province, well inside its borders
  for (let k = 0; k < players; k++) {
    let best = capitals[k];
    let bs = -Infinity;
    for (let q = 0; q < P; q++) {
      if (owner[q] !== k) continue;
      const inner = [...provinces[q].neighbors, ...provinces[q].seaNeighbors].filter((r) => owner[r] === k).length;
      const score = worth[q] + inner * 0.5 + (q === capitals[k] ? 0.01 : 0);
      if (score > bs) {
        bs = score;
        best = q;
      }
    }
    capitals[k] = best;
  }

  // ---------- Realms and regions ----------
  // kingdoms numbered top-left first, so player slots read like the map
  const kOrder = Array.from({ length: players }, (_, k) => k).sort((a, b) => capitals[a] - capitals[b]);
  const kId = new Int32Array(players);
  kOrder.forEach((k, id) => (kId[k] = id));
  const hasFree = owner.some((o) => o < 0);
  const freeId = players;
  const realmOfProv = Array.from(owner, (o) => (o >= 0 ? kId[o] : freeId));

  const regions: Region[] = [];
  const realms: Realm[] = [];
  for (let id = 0; id < players; id++) {
    const k = kOrder[id];
    realms.push({ id, name: '', title: 'Kingdom', culture: 0, color: [0, 0, 0], regions: [id], capitalProvince: capitals[k], player: id + 1, ...(slotRace[k] ? { race: slotRace[k]!.id } : {}) });
    regions.push({ id, name: '', provinces: [], realm: id, capitalProvince: capitals[k] });
  }
  provinces.forEach((pr, q) => {
    if (realmOfProv[q] !== freeId) {
      pr.region = realmOfProv[q];
      regions[pr.region].provinces.push(q);
    }
  });
  if (hasFree) {
    realms.push({ id: freeId, name: 'Free lands', title: 'Free lands', culture: 0, color: FREE_COLOR, regions: [], capitalProvince: -1, unclaimed: true });
    // one region per connected stretch of free land
    const seen = new Uint8Array(P);
    for (let q = 0; q < P; q++) {
      if (realmOfProv[q] !== freeId || seen[q]) continue;
      const id = regions.length;
      const members: number[] = [];
      const st = [q];
      seen[q] = 1;
      while (st.length) {
        const a = st.pop()!;
        members.push(a);
        for (const b of provinces[a].neighbors)
          if (!seen[b] && realmOfProv[b] === freeId) {
            seen[b] = 1;
            st.push(b);
          }
      }
      members.sort((a, b) => a - b);
      for (const m of members) provinces[m].region = id;
      const c = centroidOf(members.map((m) => provinces[m].center));
      const cap = members.reduce((best, m) => (dist2(provinces[m].center, c) < dist2(provinces[best].center, c) ? m : best), members[0]);
      regions.push({ id, name: '', provinces: members, realm: freeId, capitalProvince: cap });
      realms[freeId].regions.push(id);
    }
    realms[freeId].capitalProvince = regions[realms[freeId].regions[0]].capitalProvince;
  }

  // ---------- Cultures and names ----------
  const cultureRng = rng.fork('cultures');
  const centers = realms.slice(0, players).map((r) => provinces[r.capitalProvince].center);
  const cultureCount = Math.max(2, Math.min(7, Math.round(players / 4)));
  const seeds = farthestPoints(centers, cultureCount, cultureRng);
  const paletteOrder = cultureRng.shuffle(Array.from({ length: PALETTE_COUNT }, (_, k) => k));
  const nameCultures: NameCulture[] = seeds.map((_, k) => makeCulture(cultureRng, paletteOrder[k % PALETTE_COUNT]));
  const forge = new NameForge(rng.fork('names'));
  const cultures: Culture[] = nameCultures.map((c, id) => ({ id, name: forge.word(c, 2, 2, 0), palette: paletteOrder[id % PALETTE_COUNT] }));
  centers.forEach((c, id) => {
    let best = 0;
    for (let s = 1; s < seeds.length; s++) if (dist2(c, centers[seeds[s]]) < dist2(c, centers[seeds[best]])) best = s;
    realms[id].culture = best;
  });
  const raceCulture = new Map<string, number>();
  for (const race of races) {
    if (race.names === 'auto') continue;
    const pal = paletteIndexOf(race.names);
    raceCulture.set(race.id, cultures.length);
    nameCultures.push(makeCulture(cultureRng, pal));
    cultures.push({ id: cultures.length, name: race.name, palette: pal });
  }
  for (const r of realms) if (r.race && raceCulture.has(r.race)) r.culture = raceCulture.get(r.race)!;
  // free land takes the naming style of its nearest kingdom
  const nearestKingdom = (pt: [number, number]) => {
    let best = 0;
    for (let k = 1; k < centers.length; k++) if (dist2(pt, centers[k]) < dist2(pt, centers[best])) best = k;
    return best;
  };
  if (hasFree) realms[freeId].culture = realms[nearestKingdom(provinces[realms[freeId].capitalProvince].center)].culture;
  const cultureOfProv = (q: number) => (realmOfProv[q] === freeId ? realms[nearestKingdom(provinces[q].center)].culture : realms[realmOfProv[q]].culture);

  for (const r of realms) if (!r.unclaimed) r.name = forge.word(nameCultures[r.culture], 2, 3, 0.4);
  for (const rg of regions) rg.name = rg.realm === freeId ? forge.word(nameCultures[cultureOfProv(rg.capitalProvince)], 1, 2, 0.6) : realms[rg.realm].name;
  provinces.forEach((pr, q) => (pr.name = forge.word(nameCultures[cultureOfProv(q)], 1, 2)));
  for (const rv of rivers) {
    const src = hex.province[rv.hexes[0]];
    rv.name = forge.word(nameCultures[src >= 0 ? cultureOfProv(src) : 0], 1, 2, 0);
  }

  assignColors(realms, regions, provinces, rng.fork('colors'));
  if (hasFree) realms[freeId].color = FREE_COLOR;
  return { provinces, regions, realms, cultures };
}

// ------------------------------------------------------------- provinces ---

/**
 * Cuts the land into connected provinces of `min..max` hexes. Provinces are
 * grown from the edges of the land inward (the hex with the fewest free
 * neighbours starts the next one), which leaves very few stranded hexes; a
 * repair pass then merges, trades or re-splits whatever is still too small.
 */
export function partitionProvinces(g: GameSettings, hex: HexLayers, nbr: Int32Array, cx: Float32Array, cy: Float32Array, rng: Rng): Int32Array {
  const n = hex.province.length;
  const [hMin, hMax] = g.hexes;
  const isLand = (i: number) => (hex.flags[i] & HexFlag.Land) !== 0;

  // land components
  const comp = new Int32Array(n).fill(-1);
  const compSize: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!isLand(s) || comp[s] >= 0) continue;
    const id = compSize.length;
    let count = 0;
    const st = [s];
    comp[s] = id;
    while (st.length) {
      const i = st.pop()!;
      count++;
      for (let d = 0; d < 6; d++) {
        const j = nbr[i * 6 + d];
        if (j >= 0 && comp[j] < 0 && isLand(j)) {
          comp[j] = id;
          st.push(j);
        }
      }
    }
    compSize.push(count);
  }

  // islets too small for a province: a link across the water to the nearest other land
  const extra = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (!extra.has(a)) extra.set(a, []);
    if (!extra.has(b)) extra.set(b, []);
    extra.get(a)!.push(b);
    extra.get(b)!.push(a);
  };
  const small = compSize.map((s) => s < hMin);
  if (small.some(Boolean)) {
    const done = new Uint8Array(compSize.length);
    for (let s = 0; s < n; s++) {
      const c = comp[s];
      if (c < 0 || !small[c] || done[c]) continue;
      done[c] = 1;
      // breadth-first over water from every hex of the islet
      const members: number[] = [];
      for (let i = s; i < n; i++) if (comp[i] === c) members.push(i);
      const from = new Int32Array(n).fill(-1);
      const steps = new Int32Array(n).fill(-1);
      let frontier = members.slice();
      for (const m of members) {
        from[m] = m;
        steps[m] = 0;
      }
      // nearest land big enough for a province; another islet only if there is nothing else
      let found: [number, number] | null = null;
      let fallback: [number, number] | null = null;
      for (let step = 1; step <= 10 && frontier.length && !found; step++) {
        const next: number[] = [];
        for (const i of frontier) {
          for (let d = 0; d < 6 && !found; d++) {
            const j = nbr[i * 6 + d];
            if (j < 0 || steps[j] >= 0) continue;
            steps[j] = step;
            from[j] = from[i];
            if (isLand(j) && comp[j] !== c) {
              if (!small[comp[j]]) found = [from[i], j];
              else {
                fallback ??= [from[i], j];
                next.push(j); // look past the other islet
              }
            } else if (!isLand(j)) next.push(j);
          }
          if (found) break;
        }
        frontier = next;
      }
      const pair = found ?? fallback;
      if (pair) link(pair[0], pair[1]);
    }
  }
  const neighboursOf = (i: number): number[] => {
    const out: number[] = [];
    for (let d = 0; d < 6; d++) {
      const j = nbr[i * 6 + d];
      if (j >= 0 && isLand(j)) out.push(j);
    }
    const e = extra.get(i);
    if (e) out.push(...e);
    return out;
  };
  const adj: number[][] = new Array(n);
  for (let i = 0; i < n; i++) if (isLand(i)) adj[i] = neighboursOf(i);

  // ---- grow from the edges inward
  const of = new Int32Array(n).fill(-1);
  const freeDeg = new Int32Array(n);
  for (let i = 0; i < n; i++) if (adj[i]) freeDeg[i] = adj[i].length;
  // buckets by free degree (lazy: entries are checked when popped)
  const buckets: number[][] = Array.from({ length: 16 }, () => []);
  const land: number[] = [];
  for (let i = 0; i < n; i++) if (adj[i]) land.push(i);
  rng.shuffle(land);
  for (const i of land) buckets[Math.min(15, freeDeg[i])].push(i);
  const take = (i: number, k: number) => {
    of[i] = k;
    for (const j of adj[i]) {
      if (of[j] >= 0) continue;
      freeDeg[j]--;
      buckets[Math.min(15, Math.max(0, freeDeg[j]))].push(j);
    }
  };
  const nextStart = (): number => {
    for (let b = 0; b < 16; b++) {
      const list = buckets[b];
      while (list.length) {
        const i = list.pop()!;
        if (of[i] < 0 && Math.min(15, freeDeg[i]) === b) return i;
      }
    }
    return -1;
  };
  let count = 0;
  for (;;) {
    const s = nextStart();
    if (s < 0) break;
    const k = count++;
    const target = rng.int(hMin, hMax);
    const members = [s];
    take(s, k);
    while (members.length < target) {
      // the free neighbour most enclosed by the province, then the one with fewest free neighbours
      let best = -1;
      let bs = -Infinity;
      for (const m of members)
        for (const j of adj[m]) {
          if (of[j] >= 0) continue;
          let inside = 0;
          for (const q of adj[j]) if (of[q] === k) inside++;
          const d = Math.hypot(cx[j] - cx[s], cy[j] - cy[s]);
          const score = inside * 2 - freeDeg[j] - d * 0.35 + rng.next() * 0.1;
          if (score > bs) {
            bs = score;
            best = j;
          }
        }
      if (best < 0) break;
      members.push(best);
      take(best, k);
    }
  }

  // across the water from a set of hexes: the nearest land hex of each other province within a few hexes
  const bridges = (hexes: number[]): [number, number][] => {
    const inside = new Set(hexes);
    const steps = new Map<number, number>();
    const from = new Map<number, number>();
    let frontier = hexes.slice();
    for (const h of hexes) {
      steps.set(h, 0);
      from.set(h, h);
    }
    const out: [number, number][] = [];
    const reached = new Set<number>();
    for (let step = 1; step <= 5 && frontier.length; step++) {
      const next: number[] = [];
      for (const i of frontier)
        for (let d = 0; d < 6; d++) {
          const j = nbr[i * 6 + d];
          if (j < 0 || steps.has(j)) continue;
          steps.set(j, step);
          from.set(j, from.get(i)!);
          if (isLand(j)) {
            if (!inside.has(j) && !reached.has(of[j])) {
              reached.add(of[j]);
              out.push([from.get(i)!, j]);
            }
          } else next.push(j);
        }
      frontier = next;
    }
    return out;
  };
  repairProvinces(of, adj, hMin, hMax, cx, cy, bridges);
  return of;
}

/** Merges, trades and re-splits provinces until every one is inside `min..max` (where the land allows it). */
function repairProvinces(of: Int32Array, adj: number[][], hMin: number, hMax: number, cx: Float32Array, cy: Float32Array, bridges: (hexes: number[]) => [number, number][]): void {
  const members = new Map<number, Set<number>>();
  for (let i = 0; i < of.length; i++) {
    if (of[i] < 0) continue;
    if (!members.has(of[i])) members.set(of[i], new Set());
    members.get(of[i])!.add(i);
  }
  const neighbourProvinces = (k: number) => {
    const out = new Set<number>();
    for (const i of members.get(k)!) for (const j of adj[i]) if (of[j] !== k) out.add(of[j]);
    return [...out];
  };
  const connectedWithout = (set: Set<number>, drop: number) => {
    const start = [...set].find((x) => x !== drop);
    if (start === undefined) return true;
    const seen = new Set([start]);
    const st = [start];
    while (st.length) {
      const a = st.pop()!;
      for (const b of adj[a]) if (b !== drop && set.has(b) && !seen.has(b)) (seen.add(b), st.push(b));
    }
    return seen.size === set.size - 1;
  };
  const move = (i: number, to: number) => {
    members.get(of[i])!.delete(i);
    of[i] = to;
    members.get(to)!.add(i);
  };
  const merge = (from: number, to: number) => {
    for (const i of [...members.get(from)!]) move(i, to);
    members.delete(from);
  };

  for (let pass = 0; pass < 6; pass++) {
    let bad = 0;
    const ids = [...members.keys()].sort((a, b) => members.get(a)!.size - members.get(b)!.size);
    for (const k of ids) {
      const set = members.get(k);
      if (!set || set.size >= hMin) continue;
      bad++;
      const nbs = neighbourProvinces(k);
      // a) merge into a neighbour with room
      const room = nbs.filter((q) => members.get(q)!.size + set.size <= hMax).sort((a, b) => members.get(a)!.size - members.get(b)!.size);
      if (room.length) {
        merge(k, room[0]);
        continue;
      }
      // b) take border hexes from neighbours that can spare them
      let progress = true;
      while (set.size < hMin && progress) {
        progress = false;
        for (const q of nbs) {
          const qs = members.get(q);
          if (!qs || qs.size <= hMin) continue;
          const cand = [...qs].find((h) => adj[h].some((x) => of[x] === k) && connectedWithout(qs, h));
          if (cand !== undefined) {
            move(cand, k);
            progress = true;
            if (set.size >= hMin) break;
          }
        }
      }
      if (set.size >= hMin) continue;
      // c) join a neighbour and cut the pair into two provinces that both fit
      let fixed = false;
      for (const q of nbs) {
        const union = new Set([...set, ...members.get(q)!]);
        const parts = splitInTwo(union, adj, hMin, hMax, cx, cy);
        if (!parts) continue;
        for (const h of parts[0]) if (of[h] !== k) move(h, k);
        for (const h of parts[1]) if (of[h] !== q) move(h, q);
        fixed = true;
        break;
      }
      if (fixed) continue;
      // d) cut the province and all its neighbours again, from scratch, until every piece fits
      // the province, its neighbours and theirs: room to move the cut lines
      const ring2 = new Set([k, ...nbs]);
      for (const q of nbs) for (const r of neighbourProvinces(q)) if (ring2.size < 12) ring2.add(r);
      const patchIds = [...ring2];
      let patch = patchIds.flatMap((q) => [...members.get(q)!]);
      let parts = repartition(patch, adj, hMin, hMax, pass * 7919 + k);
      if (!parts) {
        // a land mass that cannot be cut evenly: reach across the water to the nearest provinces
        for (const [a, b] of bridges(patch)) {
          adj[a].push(b);
          adj[b].push(a);
          if (!patchIds.includes(of[b])) patchIds.push(of[b]);
        }
        patch = patchIds.flatMap((q) => [...members.get(q)!]);
        parts = repartition(patch, adj, hMin, hMax, pass * 7919 + k + 1);
      }
      if (parts) {
        let nextId = Math.max(...members.keys()) + 1;
        parts.forEach((part, idx) => {
          const id = idx < patchIds.length ? patchIds[idx] : nextId++;
          if (!members.has(id)) members.set(id, new Set());
          for (const h of part) if (of[h] !== id) move(h, id);
        });
        for (const q of patchIds) if (members.get(q)!.size === 0) members.delete(q);
      }
    }
    // too-large provinces (only from merges of last resort): split them
    for (const k of [...members.keys()]) {
      const set = members.get(k)!;
      if (set.size <= hMax) continue;
      bad++;
      const parts = splitInTwo(set, adj, hMin, hMax, cx, cy);
      if (!parts) continue;
      const id = Math.max(...members.keys()) + 1;
      members.set(id, new Set());
      for (const h of parts[1]) move(h, id);
    }
    if (!bad) break;
  }
}

/**
 * Cuts a small patch of hexes into connected pieces of `min..max`, trying
 * many random growth orders. Returns null when no attempt worked.
 */
function repartition(patch: number[], adj: number[][], hMin: number, hMax: number, seed: number): number[][] | null {
  const inPatch = new Set(patch);
  let state = (seed * 2654435761) >>> 0 || 1;
  const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let attempt = 0; attempt < 400; attempt++) {
    const taken = new Set<number>();
    const parts: number[][] = [];
    let ok = true;
    while (taken.size < patch.length && ok) {
      // start at a hex with the fewest free neighbours, ties broken at random
      let start = -1;
      let bd = Infinity;
      for (const h of patch) {
        if (taken.has(h)) continue;
        const d = adj[h].filter((x) => inPatch.has(x) && !taken.has(x)).length + rand() * 0.9;
        if (d < bd) {
          bd = d;
          start = h;
        }
      }
      const left = patch.length - taken.size;
      const hi = Math.min(hMax, left);
      const target = left <= hMax ? left : hMin + Math.floor(rand() * (hi - hMin + 1));
      const part = [start];
      taken.add(start);
      while (part.length < target) {
        let best = -1;
        let bs = -Infinity;
        for (const m of part)
          for (const j of adj[m]) {
            if (!inPatch.has(j) || taken.has(j)) continue;
            const score = adj[j].filter((x) => part.includes(x)).length * 2 - adj[j].filter((x) => inPatch.has(x) && !taken.has(x)).length + rand();
            if (score > bs) {
              bs = score;
              best = j;
            }
          }
        if (best < 0) break;
        part.push(best);
        taken.add(best);
      }
      if (part.length < hMin) ok = false;
      parts.push(part);
    }
    if (ok) return parts;
  }
  return null;
}

/** Two connected parts of a hex set, each `min..max` hexes, compact if possible. */
function splitInTwo(set: Set<number>, adj: number[][], hMin: number, hMax: number, cx: Float32Array, cy: Float32Array): [number[], number[]] | null {
  const total = set.size;
  if (total < 2 * hMin || total > 2 * hMax) return null;
  const list = [...set];
  // try each hex as the far end of part A, sizes nearest an even split first
  const sizes: number[] = [];
  for (let a = hMin; a <= hMax; a++) if (total - a >= hMin && total - a <= hMax) sizes.push(a);
  sizes.sort((a, b) => Math.abs(a - total / 2) - Math.abs(b - total / 2));
  for (const a of sizes)
    for (const start of list) {
      const part = new Set([start]);
      while (part.size < a) {
        let best = -1;
        let bd = Infinity;
        for (const m of part)
          for (const j of adj[m]) {
            if (!set.has(j) || part.has(j)) continue;
            const d = Math.hypot(cx[j] - cx[start], cy[j] - cy[start]);
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
        if (best < 0) break;
        part.add(best);
      }
      if (part.size !== a) continue;
      const rest = list.filter((h) => !part.has(h));
      if (isConnected(rest, adj)) return [[...part], rest];
    }
  return null;
}

function isConnected(hs: number[], adj: number[][]): boolean {
  if (!hs.length) return true;
  const set = new Set(hs);
  const seen = new Set([hs[0]]);
  const st = [hs[0]];
  while (st.length) {
    const a = st.pop()!;
    for (const b of adj[a]) if (set.has(b) && !seen.has(b)) (seen.add(b), st.push(b));
  }
  return seen.size === hs.length;
}

// -------------------------------------------------------------- kingdoms ---

/** What a hex is worth to a ruler: farmland and plains most, peaks and ice least. */
const TERRAIN_WORTH: Partial<Record<Terrain, number>> = {
  [Terrain.Plains]: 1,
  [Terrain.Farmland]: 1.15,
  [Terrain.Forest]: 0.8,
  [Terrain.Jungle]: 0.55,
  [Terrain.Hills]: 0.8,
  [Terrain.Mountains]: 0.4,
  [Terrain.Peaks]: 0.15,
  [Terrain.Desert]: 0.35,
  [Terrain.Steppe]: 0.7,
  [Terrain.Tundra]: 0.35,
  [Terrain.Glacier]: 0.05,
  [Terrain.Marsh]: 0.45,
  [Terrain.Taiga]: 0.55,
};

export function provinceWorth(hex: HexLayers, pr: Province): number {
  let w = 0;
  for (const h of pr.hexes) {
    w += TERRAIN_WORTH[hex.terrain[h] as Terrain] ?? 0.5;
    if (hex.flags[h] & HexFlag.River) w += 0.15;
    if (hex.relief[h] === Relief.Peaks) w -= 0.05;
  }
  return w + (pr.coastal ? 0.25 : 0);
}

/** Provinces per kingdom: equal when balanced, otherwise spread over the interval. */
function kingdomTargets(g: GameSettings, players: number, P: number, rng: Rng): number[] {
  const [kMin, kMax] = g.provinces;
  const share = (P * (1 - g.free)) / players;
  if (g.balanced) {
    const k = Math.max(kMin, Math.min(kMax, Math.round(share)));
    return new Array(players).fill(Math.min(k, Math.max(kMin, Math.floor(P / players))));
  }
  const out = Array.from({ length: players }, () => rng.int(kMin, kMax));
  // nudge the total toward the share of land the kingdoms should hold
  const want = Math.round(share * players);
  let sum = out.reduce((a, b) => a + b, 0);
  for (let guard = 0; guard < players * 40 && sum !== want; guard++) {
    const k = rng.int(0, players - 1);
    if (sum > want && out[k] > kMin) (out[k]--, sum--);
    else if (sum < want && out[k] < kMax) (out[k]++, sum++);
  }
  return out;
}

/** A province and its neighbours: the land a capital would rule first. */
function neighbourhood(provinces: Province[], q: number): number[] {
  const out = [...provinces[q].hexes];
  for (const r of provinces[q].neighbors) out.push(...provinces[r].hexes);
  return out;
}

/**
 * Capitals: good land with room around it, as far from each other as the
 * land allows. Race kingdoms also want land that suits them.
 */
function pickCapitals(provinces: Province[], worth: number[], targets: number[], slotRace: (RaceDef | null)[], suitOf: (r: RaceDef) => number[], rng: Rng): number[] {
  const P = provinces.length;
  // room: provinces within two steps (land or sea); home worth: the best kingdom that could grow there
  const reach = provinces.map((pr) => {
    const seen = new Set([pr.id]);
    let frontier = [pr.id];
    for (let s = 0; s < 2; s++) {
      const next: number[] = [];
      for (const a of frontier) for (const b of [...provinces[a].neighbors, ...provinces[a].seaNeighbors]) if (!seen.has(b)) (seen.add(b), next.push(b));
      frontier = next;
    }
    return [...seen];
  });
  const room = reach.map((r) => r.length);
  const kAvg = Math.max(1, Math.round(targets.reduce((a, b) => a + b, 0) / Math.max(1, targets.length)));
  const home = reach.map((r, q) => worth[q] + r.filter((x) => x !== q).map((x) => worth[x]).sort((a, b) => b - a).slice(0, kAvg - 1).reduce((a, b) => a + b, 0));
  const sortedHome = home.slice().sort((a, b) => a - b);
  // poor homelands (ice, desert, bare peaks) are left out while enough good ones remain
  const homeFloor = sortedHome[Math.floor(sortedHome.length * 0.3)] ?? 0;
  const avgWorth = worth.reduce((a, b) => a + b, 0) / Math.max(1, P);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pr of provinces) {
    minX = Math.min(minX, pr.center[0]);
    maxX = Math.max(maxX, pr.center[0]);
    minY = Math.min(minY, pr.center[1]);
    maxY = Math.max(maxY, pr.center[1]);
  }
  const spacing = Math.sqrt(((maxX - minX) * (maxY - minY)) / Math.max(1, targets.length));
  // land masses (provinces linked by land or narrow sea) and how many more provinces each can still give
  const mass = new Int32Array(P).fill(-1);
  const capacity: number[] = [];
  for (let q = 0; q < P; q++) {
    if (mass[q] >= 0) continue;
    const id = capacity.length;
    let count = 0;
    const st = [q];
    mass[q] = id;
    while (st.length) {
      const a = st.pop()!;
      count++;
      for (const b of [...provinces[a].neighbors, ...provinces[a].seaNeighbors]) if (mass[b] < 0) (mass[b] = id, st.push(b));
    }
    capacity.push(count);
  }
  const chosen: number[] = [];
  const taken = new Uint8Array(P);
  // race kingdoms choose first (they are the pickiest), then everyone else
  const order = targets.map((_, k) => k).sort((a, b) => (slotRace[b] ? 1 : 0) - (slotRace[a] ? 1 : 0));
  const result: number[] = new Array(targets.length).fill(-1);
  for (const k of order) {
    const race = slotRace[k];
    const suit = race ? suitOf(race) : null;
    let best = -1;
    let bs = -Infinity;
    // only where the land mass still has room for a whole kingdom (if any has)
    const roomFor = capacity.some((c) => c >= targets[k]) ? targets[k] : 1;
    // good homelands first; poor ones only once the good ones are gone
    for (let pass = 0; pass < 2 && best < 0; pass++)
    for (let q = 0; q < P; q++) {
      if (taken[q] || capacity[mass[q]] < roomFor) continue;
      if (pass === 0 && home[q] < homeFloor) continue;
      let dmin = Infinity;
      for (const c of chosen) dmin = Math.min(dmin, Math.sqrt(dist2(provinces[c].center, provinces[q].center)));
      const spread = chosen.length ? Math.min(1.25, dmin / spacing) : 1;
      const good = Math.min(1.5, home[q] / Math.max(0.1, avgWorth * kAvg));
      const roomy = Math.min(1, room[q] / Math.max(1, targets[k] + 1));
      const fit = suit ? Math.min(1.2, suit[q]) : 1;
      const score = spread * 1.6 + good * 0.5 + roomy * 0.8 + fit * (suit ? 1.2 : 0) + rng.next() * 0.05;
      if (score > bs) {
        bs = score;
        best = q;
      }
    }
    if (best < 0) break;
    taken[best] = 1;
    capacity[mass[best]] -= targets[k];
    chosen.push(best);
    result[k] = best;
  }
  return result;
}

/** The free province a kingdom takes next: close to its capital, land before sea, good land first. */
function bestFrontier(k: number, owner: Int32Array, provinces: Province[], worth: number[], capital: number, suit: number[] | null): number {
  let best = -1;
  let bc = Infinity;
  const c0 = provinces[capital].center;
  for (let q = 0; q < provinces.length; q++) {
    if (owner[q] !== k) continue;
    const pr = provinces[q];
    const consider = (r: number, sea: boolean) => {
      if (owner[r] >= 0) return;
      const d = Math.sqrt(dist2(c0, provinces[r].center));
      const cost = d * (sea ? 1.8 : 1) * (suit ? 0.8 + 1.6 * (1 - Math.min(1, suit[r])) : 1) - worth[r] * 0.6;
      if (cost < bc) {
        bc = cost;
        best = r;
      }
    };
    for (const r of pr.neighbors) consider(r, false);
    for (const r of pr.seaNeighbors) consider(r, true);
  }
  return best;
}

/**
 * A kingdom that could not reach its size (every free province near it was
 * taken) gets one from a neighbouring kingdom, which takes one from the next,
 * and so on along the shortest chain to a kingdom that borders free land.
 * Capitals never move and every kingdom stays in one piece.
 */
function shortKingdoms(owner: Int32Array, size: Int32Array, targets: number[], capitals: number[], provinces: Province[], kMin: number, grow: (k: number) => boolean, relocate: (k: number) => boolean): void {
  const K = size.length;
  const links = (q: number) => [...provinces[q].neighbors, ...provinces[q].seaNeighbors];
  const intact = (k: number, without: number) => {
    const start = capitals[k];
    const seen = new Set([start]);
    const st = [start];
    while (st.length) {
      const a = st.pop()!;
      for (const b of links(a)) if (b !== without && owner[b] === k && !seen.has(b)) (seen.add(b), st.push(b));
    }
    return seen.size === size[k] - 1;
  };
  /** a province of `giver` touching `taker` that the giver can spare */
  const spare = (giver: number, taker: number): number => {
    if (size[giver] <= kMin) return -1;
    for (let q = 0; q < provinces.length; q++) {
      if (owner[q] !== giver || q === capitals[giver]) continue;
      if (!links(q).some((r) => owner[r] === taker)) continue;
      if (intact(giver, q)) return q;
    }
    return -1;
  };
  const freeNext = (k: number): number => {
    for (let q = 0; q < provinces.length; q++) if (owner[q] === k) for (const r of links(q)) if (owner[r] < 0) return r;
    return -1;
  };
  for (let guard = 0; guard < K * 8; guard++) {
    // anyone short with free land beside it simply takes it
    let grew = false;
    for (let k = 0; k < K; k++) if (size[k] < targets[k] && grow(k)) grew = true;
    if (grew) continue;
    const k0 = Array.from({ length: K }, (_, k) => k).find((k) => size[k] < targets[k] && freeNext(k) < 0);
    if (k0 === undefined) break;
    // breadth-first over kingdoms: who can hand a province toward k0
    const prev = new Int32Array(K).fill(-2);
    prev[k0] = -1;
    const queue = [k0];
    let end = -1;
    while (queue.length && end < 0) {
      const a = queue.shift()!;
      const nb = new Set<number>();
      for (let q = 0; q < provinces.length; q++) if (owner[q] === a) for (const r of links(q)) if (owner[r] >= 0 && owner[r] !== a) nb.add(owner[r]);
      for (const b of nb) {
        if (prev[b] !== -2 || spare(b, a) < 0) continue;
        prev[b] = a;
        if (freeNext(b) >= 0 || size[b] > targets[b]) {
          end = b;
          break;
        }
        queue.push(b);
      }
    }
    if (end < 0) {
      // boxed in for good: the kingdom moves to open land, if there is any
      if (!relocate(k0)) targets[k0] = size[k0];
      continue;
    }
    // shift along the chain, from the far end back to k0
    if (size[end] <= targets[end]) {
      const f = freeNext(end);
      owner[f] = end;
      size[end]++;
    }
    let b = end;
    while (prev[b] >= 0) {
      const a = prev[b];
      const q = spare(b, a);
      if (q < 0) break;
      owner[q] = a;
      size[b]--;
      size[a]++;
      b = a;
    }
  }
}

function connectedFrom(start: number, k: number, owner: Int32Array, provinces: Province[]): number {
  const seen = new Set([start]);
  const st = [start];
  while (st.length) {
    const a = st.pop()!;
    for (const b of [...provinces[a].neighbors, ...provinces[a].seaNeighbors]) if (owner[b] === k && !seen.has(b)) (seen.add(b), st.push(b));
  }
  return seen.size;
}

