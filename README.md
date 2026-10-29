# Cartographer

A standalone fantasy map generator by Ex-Aequo Games, for the browser and the
desktop (Windows, macOS, Linux). It draws
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

### Install it like an app

- **From the browser**: open the built site (`npm run build`, then serve
  `dist/` anywhere, or `npx vite preview`) in Chrome or Edge and choose
  *Install Cartographer* in the address bar. It then opens in its own window
  and works offline.
- **Desktop app** (Tauri): `npm run desktop` runs it in a native window;
  `npm run desktop:build` builds the installer for the computer you are on
  (needs Rust, and on Linux the WebKitGTK libraries listed in
  [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/)). Saving
  and exporting use the system's Save dialog. The *Desktop apps* workflow on
  GitHub builds Windows (.msi, .exe), macOS (.dmg) and Linux (.deb, .AppImage)
  installers: run it from the Actions tab, or push a tag such as `v0.4.0` to
  attach them to a draft release.

## Using it

- **New world** (left panel): seed, size, shape of the land, land share,
  mountains, valleys (how deeply water has carved the land), rainfall,
  climate band, province size and number of realms.
  *Draw this world* generates it; the same seed and settings always give the
  same world.
- **Races** (in *New world*): tick the peoples of the world (Humans, Dwarves,
  Elves, Auroch, Orcs, Lizardfolk, Nomads, Frost folk, or your own) and set
  each one's homeland: lines like "at least 50 % of the kingdom is Mountains /
  Hills", "at most 5 % Desert", a climate range, coast or inland, how many
  kingdoms (a number or a share of all realms), kingdom size, name style and
  town mark. Drawing the world founds each race's kingdoms on the land that
  suits it and grows their borders toward it. *Kingdoms in this world* then
  checks every race kingdom against its targets; *Fit borders* trades border
  provinces to close the gaps, and for races allowed to change the land,
  paints terrain where borders are not enough. Races can be saved and loaded
  as a set. The *Races* map mode shows who lives where; the inspector shows and
  changes a realm's race.
- **Zoom levels** (right edge): World (realms on a paper map), Realm (regions
  and their names), Province (provinces, towns, farmland), Hex (individual
  hexes). Scroll, pinch or use + and − to move between them; the paper map
  crossfades into terrain, and at Hex level borders snap onto hex edges.
- **3D** (button above the zoom levels): tilts the map and raises the land, at
  every zoom. The World map stays a flat sheet of paper (tilted, no relief);
  relief rises as the terrain appears. Turn the map by dragging the compass
  (a click faces north again), with right-drag or Ctrl/⌘ + drag (sideways
  turns, up and down tilts), with Q and E, or with a two-finger twist. The
  sliders set the tilt (0–62°) and the height of the land (0–200 %). Names
  lie on the land and turn with it; towns and symbols stand up. Every tool
  works in 3D: brushes, lines and clicks land on the hill under the cursor.
  Middle-drag or Space + drag moves the map while a tool is active.
  *Image of this view* saves the 3D view; the high-resolution and game
  exports are always top-down.
- **Map modes** (bottom): Political shows realm colours; Physical shows the land
  alone. Elevation, Temperature, Rainfall, Biome and Terrain type show the
  exact game value of every hex, with a legend.
- **Quality** (top bar): High, Balanced or Fast, for slower graphics cards.
- **Language** (flag in the left panel): English or Portuguese (pt-PT). The
  choice is remembered; on first start it follows the browser's language.
  Generated place names and your own names are not translated. Exported data
  (JSON, CSV, README) stays in English so game code can rely on it.
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
- **Export → High-resolution image…**: the whole world as one PNG up to 16,384
  pixels wide, in the style of the World, Realm or Province view (paper map
  with realm names, terrain with region names, or provinces with towns), in
  the current map mode, with symbols. It is painted in tiles and lettered in
  one pass, so nothing is cut at the seams.
- **Export → All map modes…**: one image per map mode (Political, Physical,
  Elevation, Temperature, Rainfall, Biome, Terrain type) and per data layer,
  zipped; pick which modes, the style and the size.
- **Export → Export set…**: any mix of
  - the high-resolution image;
  - all map modes (as above);
  - a **province map** (`provinces.png` + `definition.csv`): one unique colour
    per province and per sea zone, as Paradox games use, with borders along
    hex edges or as drawn;
  - **heightmaps**: 16-bit and 8-bit greyscale;
  - **terrain** index colours, one black-and-white mask per terrain, a water
    mask and a river mask;
  - **tables**: CSV for hexes, provinces, regions, realms, sea zones, pinned
    symbols and every data layer;
  - the **game data** JSON.

  One part downloads as a single file; several come as a zip with a README
  explaining the conventions (see [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md)).

Keyboard: arrow keys pan, + and − zoom, Escape puts the tool down or clears the
selection, Ctrl+Z undo, Ctrl+Shift+Z (or Ctrl+Y) redo, [ and ] brush size.
While a tool is active, right-drag or hold Space to move the map.

## How it is built

| Part | Where | Notes |
| --- | --- | --- |
| Generator | `src/gen/` | Seeded heightfield (templates, ranges, domain warp), droplet hydraulic erosion, wind-driven rainfall, priority-flood drainage, rivers and lakes, Whittaker-style biomes, provinces by weighted growth, regions and realms by graph clustering, culture-flavoured names. Runs in a Web Worker. |
| Data model | `src/model/` | Pointy-top odd-r hex grid, typed-array layers, versioned project format, game export. |
| Renderer | `src/render/` | Three.js with one full-screen GLSL shader (in 3D each pixel marches a ray down onto the heightfield; `camera.ts` does the same on the CPU for lettering, symbols and clicks): paper and terrain looks, biome colour, slope-following gully relief, tree canopy, farmland, water, analytic smooth borders, data map modes, meandering river ribbons, canvas lettering with collision checks. |
| Editing | `src/edit/`, `src/gen/rederive.ts` | Brushes work on the heightfield and edit layers in place (live redraw while dragging); each stroke is one undo step stored as a diff. A deterministic rebuild in the worker re-derives everything from heightfield + edits and repairs the political map without renumbering ids. |
| Exports | `src/export/`, `src/worker/exportWorker.ts` | Tiled high-resolution rendering with a second offscreen renderer; province ID image with generated sea zones, heightmaps, masks and tables built in a worker; an exact PNG encoder (8/16-bit) and a zip writer with no dependencies. |
| UI | `src/ui/`, `src/i18n/` | React. Interface strings are written in English and looked up in `src/i18n/pt.ts`; a test fails if any string shown in the interface has no translation. |
| Desktop | `src-tauri/`, `src/platform.ts`, `public/sw.js` | Tauri 2 shell with native Save dialogs; the web build is an installable offline app. |

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
   - **3d (done)**: symbols: the built-in ink set and your own SVG and
     PNG pictures, placing, pinning, town marks, symbol sets.
4. **Phase 4 (done)**: full export set (tiled high-resolution
   images, province ID image with sea zones, heightmaps and masks, CSV) and
   the desktop app.
5. **0.5 (done)**: races with homeland biases.
6. **0.6 (this release)**: 3D view with turn, tilt and relief, full editing in 3D.
