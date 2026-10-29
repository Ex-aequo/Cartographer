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
  mountains, rainfall, climate band, province size and number of realms.
  *Draw this world* generates it; the same seed and settings always give the
  same world.
- **Zoom levels** (right edge): World, Realm, Province, Hex. Scroll, pinch or
  use + and − to move between them; the paper map crossfades into terrain, and
  at Hex level borders snap onto hex edges.
- **Map modes** (bottom): Political shows realm colours; Terrain shows the land
  alone.
- **Inspector**: click any province to see its realm, region, terrain,
  neighbours, and the data of the hex under the cursor.
- **Save / Open**: `.cartomap` project files (gzip JSON) keep the full world.
- **Export → Game data**: hexes, provinces, regions, realms and rivers as JSON
  (see [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md)).
- **Export → Image of this view**: PNG of the current view, labels included.

Keyboard: arrow keys pan, + and − zoom, Escape clears the selection.

## How it is built

| Part | Where | Notes |
| --- | --- | --- |
| Generator | `src/gen/` | Seeded heightfield (templates, ranges, domain warp), wind-driven rainfall, priority-flood drainage, rivers and lakes, Whittaker-style biomes, provinces by weighted growth, regions and realms by graph clustering, culture-flavoured names. Runs in a Web Worker. |
| Data model | `src/model/` | Pointy-top odd-r hex grid, typed-array layers, versioned project format, game export. |
| Renderer | `src/render/` | Three.js with one full-screen GLSL shader: paper and terrain looks, biome colour, tree canopy, water, relief lighting, analytic smooth borders, river ribbons, canvas lettering. |
| UI | `src/ui/` | React. |

Borders are computed in the shader from a Gaussian vote of nearby hexes, the
same rule the CPU uses for picking, so lines stay smooth at every zoom and
clicks always land on the province you see.

## Roadmap

1. **Phase 1 (this release)**: generator, data model, World and Province views,
   save, open, game-data export.
2. **Phase 2**: Realm view with region (duchy) names, data map modes
   (elevation, temperature, rainfall, biome, terrain), richer close-up terrain
   (farmland, erosion detail).
3. **Phase 3**: editing: terrain and height brushes, province split and merge,
   realm recolouring, symbol and label placement, custom data layers with
   auto-fill rules, and your own SVG and PNG assets.
4. **Phase 4**: full export set (tiled high-resolution images, province ID
   image, heightmap and masks, CSV) and a desktop build.
