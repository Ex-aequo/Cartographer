# Cartographer

A standalone, browser-based fantasy map generator by Ex-Aequo Games. It draws
whole worlds, with continents, climate, rivers, provinces, regions and realms,
and renders them in a Paradox-style look: a CK3 paper map for the overview that
turns into lit terrain as you zoom in, down to individual hexes.

Every map is also game data. The hex grid is the source of truth; the art is
generated to agree with it, and both can be exported.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # generator and file-format tests
npm run build      # type-check and production build into dist/
```

Requires Node 20 or newer and a browser with WebGL 2.

## Using it

- **New world** (left panel): seed, size, shape of the land, land share,
  mountains, valleys (how deeply water has carved the land), rainfall,
  climate band, province size and number of realms.
  *Draw this world* generates it; the same seed and settings always give the
  same world.
- **Zoom levels** (right edge): World (realms on a paper map), Realm (regions
  and their names), Province (provinces, towns, farmland), Hex (individual
  hexes). Scroll, pinch or use + and − to move between them; the paper map
  crossfades into terrain, and at Hex level borders snap onto hex edges.
- **Map modes** (bottom): Political shows realm colours; Physical shows the land
  alone. Elevation, Temperature, Rainfall, Biome and Terrain type show the
  exact game value of every hex, with a legend.
- **Quality** (top bar): High, Balanced or Fast, for slower graphics cards.
- **Edit** (left panel, second tab): reshape the world by hand.
  - *Land*: Raise land, Lower land, Smooth, Flatten, Paint terrain.
  - *Water*: Draw river (from source to the sea; the land is cut so water runs
    downhill along your line), Erase river (removes it from there up to its
    sources), Fill lake, Drain.
  - After each stroke the map rebuilds: coasts, rainfall and rain shadows,
    rivers, biomes, terrain, provinces and borders. Land that rises from the
    sea joins the nearest province (or becomes a new one); a province whose land
    is all flooded is retired, and its id is never reused.
  - *Borders*: Reassign hexes (drag outward from a province to grow it), Split
    province (draw a line across it), Merge provinces (drag from one into its
    neighbour), Change region and Change realm (drag from inside one across
    others to bring them in).
  - *Words*: Move labels (drag any name; click it to resize, curve, turn or
    hide it).
  - With no tool selected, click a province: the inspector lets you rename the
    province, region and realm, change the realm's title and colour, make a
    province its own region, or make a region an independent realm.
  - Undo and redo cover every change, 100 steps deep. Edits are saved in the
    `.cartomap` file and marked in the game-data export.
- **Data** (left panel, third tab): custom game layers.
  - *New layer*: a category (one of a list, e.g. a resource), a number (e.g.
    fertility), yes/no, or a list of tags; one value per hex or per province.
    Leave the name empty for a worked example.
  - *Rules* fill a layer from the land: conditions on terrain, biome,
    elevation, temperature, rainfall, coast, river, lake and distance from a
    town, a chance, and a value or a formula (e.g. fertility = rainfall × 10 on
    plains and farmland). Results are seeded, so the same map gives the same
    values. Rules can run again after every land edit.
  - Province layers can be filled from a hex layer instead: total, average,
    highest, lowest, most common, or "any hex has it".
  - *Paint by hand* sets values with a brush; painted values stay when rules
    run again, and *Let rules decide* gives them back.
  - The eye shows a layer as a map mode (also in the mode bar at the bottom),
    with a legend, and letters the values on the map when zoomed in.
  - *Save template* / *Load template* move layer definitions and rules between
    maps. *CSV tables* downloads one table per layer.
- **Symbols** (left panel, fourth tab): pictures on the map.
  - The library starts with an ink set drawn for Cartographer (village, city,
    castle, tower, ruins, mine, port, temple, abbey, lighthouse, camp, cave,
    sea serpent, kraken, ship, mountain, hills, trees). Add your own SVG or PNG
    files (up to 2 MB each) with *Add pictures…*, *Add a folder…*, or by
    dropping them on the panel; name and tag them and group them in sets.
  - Click a symbol, then click the map to place it; hold Shift to snap it to a
    hex and pin it there (pinned symbols are exported as game data). With no
    symbol chosen, click a placed one to select it, drag to move it; size,
    turn, opacity, mirror, tint, ink look and the zoom levels it shows at are
    in the panel. Delete removes it.
  - *Town marks* replace the standard keep at every town: by importance (realm
    capitals, region seats, other towns), by realm, or by culture.
  - *Save set* / *Load set* move a set, pictures included, between maps.
    Everything is stored in the `.cartomap` file.
- **Inspector**: click any province to see its realm, region, terrain,
  neighbours, the data of the hex under the cursor, and its custom layer
  values (editable while the Edit or Data tab is open).
- **Save / Open**: `.cartomap` project files (gzip JSON) keep the full world.
- **Export → Game data**: hexes, provinces, regions, realms and rivers as JSON
  (see [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md)).
- **Export → Data layers**: one CSV per custom layer, zipped.
- **Export → Image of this view**: PNG of the current view, labels included.

Keyboard: arrow keys pan, + and − zoom, Escape puts the tool down or clears the
selection, Ctrl+Z undo, Ctrl+Shift+Z (or Ctrl+Y) redo, [ and ] brush size.
While a tool is active, right-drag or hold Space to move the map.

## How it is built

| Part | Where | Notes |
| --- | --- | --- |
| Generator | `src/gen/` | Seeded heightfield (templates, ranges, domain warp), droplet hydraulic erosion, wind-driven rainfall, priority-flood drainage, rivers and lakes, Whittaker-style biomes, provinces by weighted growth, regions and realms by graph clustering, culture-flavoured names. Runs in a Web Worker. |
| Data model | `src/model/` | Pointy-top odd-r hex grid, typed-array layers, versioned project format, game export. |
| Renderer | `src/render/` | Three.js with one full-screen GLSL shader: paper and terrain looks, biome colour, slope-following gully relief, tree canopy, farmland, water, analytic smooth borders, data map modes, meandering river ribbons, canvas lettering with collision checks. |
| Editing | `src/edit/`, `src/gen/rederive.ts` | Brushes work on the heightfield and edit layers in place (live redraw while dragging); each stroke is one undo step stored as a diff. A deterministic rebuild in the worker re-derives everything from heightfield + edits and repairs the political map without renumbering ids. |
| UI | `src/ui/` | React. |

Borders are computed in the shader from a Gaussian vote of nearby hexes, the
same rule the CPU uses for picking, so lines stay smooth at every zoom and
clicks always land on the province you see.

## Roadmap

1. **Phase 1 (done)**: generator, data model, World and Province views,
   save, open, game-data export.
2. **Phase 2 (done)**: erosion and carved mountains, Realm view with
   region names and borders, data map modes with legends, farmland around
   towns, meandering rivers that gather into networks, smaller save files,
   quality setting.
3. **Phase 3**: editing, in four steps.
   - **3a (done)**: edit panel, undo and redo, land and water tools.
   - **3b (done)**: border and naming tools (reassign hexes, split and
     merge provinces, regions and realms, names, titles, colours, labels).
   - **3c (done)**: custom data layers with auto-fill rules,
     painting, province roll-ups, templates and CSV export.
   - **3d (this release)**: symbols: the built-in ink set and your own SVG and
     PNG pictures, placing, pinning, town marks, symbol sets.
4. **Phase 4**: full export set (tiled high-resolution images, province ID
   image, heightmap and masks, CSV) and a desktop build.
