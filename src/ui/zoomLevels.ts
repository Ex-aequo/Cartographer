/** The four zoom levels, in CSS px per world unit (1 world unit = 1 hex radius). */
export const LEVELS = [
  { key: 'world', name: 'World', hint: 'Paper map of realms', from: 0, target: 0 /* fit */ },
  { key: 'realm', name: 'Realm', hint: 'Regions and terrain', from: 7, target: 10 },
  { key: 'province', name: 'Province', hint: 'Provinces and settlements', from: 16, target: 26 },
  { key: 'hex', name: 'Hex', hint: 'Individual hexes', from: 45, target: 80 },
] as const;

export function levelIndexFor(zoom: number): number {
  let k = 0;
  LEVELS.forEach((l, i) => {
    if (zoom >= l.from) k = i;
  });
  return k;
}
