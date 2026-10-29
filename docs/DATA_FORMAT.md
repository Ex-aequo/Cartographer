# Cartographer data formats

Two files come out of Cartographer:

- **Project file** (`.cartomap`): everything needed to reopen a map exactly.
  Gzip-compressed JSON with typed arrays stored as base64. Meant for the app,
  not for games; its internals may grow between versions (`version` field).
  Version 2 stores the art heightfield as 16-bit integers (about 40% smaller);
  version 1 files still open.
- **Game data** (`*-gamedata.json`): a readable, stable export for engines and
  tools. Documented below.

## Coordinates

- Hexes are **pointy-top**, laid out in **odd-r offset** rows: odd rows are
  shifted right by half a hex.
- `id = row * cols + col`. Ids never change for a given grid size.
- Axial coordinates: `q = col - (row - (row & 1)) / 2`, `r = row`.
- World units: hex circumradius = 1. Hex centre:
  `x = √3 · (col + 0.5 · (row & 1)) + √3/2`, `y = 1.5 · row + 1`.
  `y` grows southward, so the top of the map is north.
- Neighbour order (direction index 0–5) for an even row:
  `(+1,0) (0,−1) (−1,−1) (−1,0) (−1,+1) (0,+1)`; for an odd row:
  `(+1,0) (+1,−1) (0,−1) (−1,0) (0,+1) (+1,+1)` as `(dcol, drow)`.

## Game data, version 1

```jsonc
{
  "schema": "cartographer-game-data",
  "version": 1,
  "name": "The Known World",
  "seed": "amber-reach-417",
  "grid": { "cols": 300, "rows": 190, "layout": "pointy-odd-r", "hexRadius": 1,
            "worldWidth": 520.48, "worldHeight": 285.5 },
  "terrainTypes": [{ "code": 3, "name": "Plains" }, ...],
  "biomeTypes":   [{ "code": 6, "name": "Grassland" }, ...],
  "realms":   [ ... ],
  "regions":  [ ... ],
  "provinces":[ ... ],
  "cultures": [ ... ],
  "rivers":   [ ... ],
  "hexes":    [ ... ],
  "layers":   []          // custom data layers (Phase 3)
}
```

### hexes[]

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `col`, `row`, `q`, `r` | int | See coordinates above. |
| `x`, `y` | number | Hex centre in world units. |
| `land` | bool | False for ocean and lakes. |
| `elevation` | number | −1 (deepest) … 0 (sea level) … 1 (highest peak). |
| `elevationMetres` | int | Elevation in metres (negative = depth). |
| `temperatureC` | number | Mean temperature at the hex's altitude. |
| `moisture` | number | Rainfall 0 (arid) … 1 (very wet). |
| `biome`, `biomeCode` | string, int | Climate class. |
| `relief`, `reliefCode` | string, int | Deep/shallow water, flat, hills, mountains, peaks. |
| `terrain`, `terrainCode` | string, int | Gameplay terrain combining relief and biome (e.g. Forest, Hills, Farmland). |
| `coastal` | bool | Land hex touching water. |
| `lake` | bool | Lake hex. |
| `river` | bool | A river runs through this hex. |
| `riverFlow` | number | Accumulated flow where `river` is true. |
| `flowsTo` | int | Downstream hex id, −1 for water. Every land hex drains to the sea. |
| `province` | int | Province id, −1 for water. |

Codes are stable: a code is never renumbered, new codes are only added.

### provinces[]

| Field | Meaning |
| --- | --- |
| `id`, `name` | Stable id (dense, from 0) and generated name. |
| `region`, `realm` | Owning region (duchy level) and realm. |
| `capitalHex` | Hex id of the settlement. |
| `center` | Centroid `[x, y]` in world units. |
| `terrain`, `terrainCode` | Dominant terrain. |
| `coastal`, `hexCount`, `hexes` | Coast flag, size, and the member hex ids. |
| `neighbors` | Provinces sharing a land border. |
| `seaNeighbors` | Provinces across at most four hexes of water (for naval movement). |

### regions[], realms[], cultures[], rivers[]

- **regions**: `id`, `name`, `realm`, `capitalProvince`, `provinces`.
- **realms**: `id`, `name`, `title` (Empire, Kingdom, Grand Duchy, Duchy,
  County), `culture`, `color` (`#rrggbb`), `capitalProvince`, `regions`.
- **cultures**: `id`, `name`.
- **rivers**: `id`, `name`, `hexes` from source to the water or river it joins.
