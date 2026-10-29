# Cartographer data formats

Two files come out of Cartographer:

- **Project file** (`.cartomap`): everything needed to reopen a map exactly.
  Gzip-compressed JSON with typed arrays stored as base64. Meant for the app,
  not for games; its internals may grow between versions (`version` field).
  Version 2 stores the art heightfield as 16-bit integers (about 35% smaller).
  Version 3 adds hand edits (painted terrain, erased and drawn rivers, which
  hexes were edited) and retired ids. Versions 1 and 2 still open.
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
  "seaZones": [ ... ]     // the water, split into navigable zones
  "symbols":  [ ... ]     // symbols pinned to hexes
  "layers":   [ ... ]     // definitions of your custom data layers
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
| `seaZone` | int | Sea zone or lake id (from 100000) for water hexes, −1 on land. |
| `edited` | bool | Changed by hand in the editor (height, terrain or river). |
| `paintedTerrain` | bool | `terrain` was set by hand and overrides the climate. |
| `data` | object | Values of every per-hex custom layer, keyed by layer id (see *Custom data layers*). |
| `symbols` | string[] | Names of the symbols pinned to this hex (see *Symbols*). |

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

Each province also carries `retired` (see below) and `data`, the values of every
per-province custom layer keyed by layer id.

### Retired ids

Editing can remove a province entirely (its land flooded). Its id is then
**retired**: it stays in the list with `retired: true` and no hexes, and is
never reused, so ids a game has stored stay valid. Regions and realms work the
same way. The top-level `retired` object lists the retired ids of each kind:

```jsonc
"retired": { "provinces": [17], "regions": [], "realms": [] }
```

### regions[], realms[], cultures[], rivers[]

- **regions**: `id`, `retired`, `name`, `realm`, `capitalProvince`, `provinces`.
- **realms**: `id`, `retired`, `name`, `title` (Empire, Kingdom, Grand Duchy, Duchy,
  County), `culture`, `color` (`#rrggbb`), `capitalProvince`, `regions`.
- **cultures**: `id`, `name`.
- **rivers**: `id`, `name`, `hexes` from source to the water or river it joins.

## Custom data layers

Layers you define in the Data tab (resources, fertility, danger, holy sites …)
are listed in `layers[]` and their values sit under `data` on each hex or
province:

```jsonc
"layers": [
  { "id": "resource", "name": "Resource", "type": "category", "scope": "hex",
    "categories": [{ "id": 0, "name": "Iron", "color": "#787882" }, ...] },
  { "id": "fertility", "name": "Fertility", "type": "number", "scope": "hex",
    "min": 0, "max": 10, "decimals": 0 },
  { "id": "harvest", "name": "Harvest", "type": "number", "scope": "province",
    "rollUp": { "source": "fertility", "how": "sum" } }
],
"hexes": [ { "id": 0, ..., "data": { "resource": 0, "fertility": 7 } }, ... ],
"provinces": [ { "id": 0, ..., "data": { "harvest": 212 } }, ... ]
```

| `type` | Value in `data` |
| --- | --- |
| `category` | Category id, or `null` for none. |
| `number` | Number, rounded to `decimals`. |
| `flag` | `true` or `false`. |
| `tags` | Array of tag (category) ids, possibly empty. |

Layer ids are stable once created (renaming a layer keeps its id). Category
ids are never renumbered; removing a category clears its values.

`rollUp.how` is one of `sum`, `average`, `max`, `min`, `mode` (most common
value) or `any` (1 if any hex has a value).

### Layer CSV tables

*Export → Data layers* (or *CSV tables* in the Data tab) downloads a zip with
one CSV per layer, named `<layer id>.csv`:

- per-hex layers: `hex_id,col,row,q,r,value,label,set_by_hand`, one row per land hex;
- per-province layers: `province_id,province,value,label,set_by_hand`, one row
  per live province.

`value` is the raw value (tags as a bit mask: bit *n* set = tag id *n*),
`label` the readable form, and `set_by_hand` is 1 where the value was painted.

### Layer templates

*Save template* writes the layer definitions and rules without any map's
values (`format: "cartographer-layer-template"`), so the same layers can be
loaded onto other maps, where the rules fill them from that map's land.

## Symbols

Symbols placed on the map either float (pure decoration, only in images) or
are **pinned** to a hex (Shift-click when placing, or the *Pinned* box). Pinned
symbols are game data:

```jsonc
"symbols": [
  { "id": 2, "hex": 6127, "symbol": "Ship", "assetId": "ink:ship",
    "set": "Ink set (built in)", "tags": ["sea", "trade", "military"] }
]
```

`id` is stable for the life of the placement. Each hex also lists the names of
its pinned symbols in `hexes[].symbols`. Use tags on your own pictures (for
example `dungeon`, `lair`) so a game can treat whole groups alike.

### Symbol set files

*Save set* writes a set with its pictures (`format: "cartographer-symbol-set"`,
SVG text or PNG data URLs) so it can be loaded into other maps. SVGs are
cleaned on import and on load: scripts, event handlers, embedded HTML and links
to other files are removed.

## Sea zones

The water is split into **sea zones** of roughly 100 hexes each (every lake is
one zone), so ships can move zone by zone the way armies move province by
province. Zone ids start at **100000** so they never collide with land
province ids. `seaZones[]` in the game data:

```jsonc
{ "id": 100004, "name": "Waters of Thiho", "kind": "sea", "hexCount": 112,
  "coastalProvinces": [3, 17, 18] }
```

Sea zones are worked out from the map when it is exported (they follow the
coastline, so editing the land can change them).

## Export set

*Export → Export set…* writes any of these (several come as one zip with a
`README.txt`). Every image covers the whole world: pixel (x, y) is the world
point ((x + 0.5) / s, (y + 0.5) / s), where s = image width ÷ world width.

| File | Contents |
| --- | --- |
| `map.png` | The rendered map, up to 16,384 px wide, in World, Realm or Province style. |
| `provinces.png` | 8-bit RGB. Each land province and each sea zone has a unique colour (never black); borders along hex edges or as drawn. |
| `definition.csv` | `province;red;green;blue;name;type;x;y` (semicolons, as Paradox games expect). `type` is `land`, `sea` or `lake`; x, y is a pixel inside it. |
| `heightmap.png` | 16-bit greyscale: 0 = deepest sea, 32768 = sea level, 65535 = highest peak. |
| `heightmap_8bit.png` | 8-bit: sea 0–95, sea level 96, land 96–255. |
| `terrain.png` | Terrain type colours, hex-exact. |
| `masks/<terrain>.png` | White where that terrain is, black elsewhere; exactly one mask is white at each pixel. |
| `water.png` | White over sea and lakes, following the drawn coastline. |
| `rivers.png` | River lines through hex centres, wider downstream. |
| `csv/*.csv` | `hexes`, `provinces`, `regions`, `realms`, `sea_zones`, and `symbols` (pinned) — one row per item, ids as in the game data. Lists inside a cell are space-separated. |
| `layers/*.csv` | One table per custom data layer (see above). |
| `gamedata.json` | The game data described in this document. |

Heightmaps and masks share one size (1,024 to 8,192 px wide); the province
map has its own (2,048 to 8,192 px).
