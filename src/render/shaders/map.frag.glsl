precision highp float;
precision highp int;

// ---------------------------------------------------------------------------
// Cartographer map shader.
// Two looks share one set of data textures and crossfade with zoom:
//   paper   (CK3-style overview: parchment, sepia relief, inked coasts)
//   terrain (close view: lit relief, biome colour, tree canopy, water)
// Political tint and borders are layered on top of either look.
// ---------------------------------------------------------------------------

out vec4 fragColor;

uniform vec2 uViewport;      // device px
uniform vec2 uCenter;        // world units
uniform float uZoom;         // device px per world unit
uniform float uPixelRatio;
uniform vec2 uWorld;         // world size, units

uniform sampler2D tHeight;   // R: elevation (<0 water)
uniform vec2 uHeightSpan;    // world units covered by the texture (w/res, h/res)
uniform sampler2D tClimate;  // R: sea-level temperature °C, G: moisture 0..1
uniform vec2 uClimateSpan;
uniform sampler2D tHex;      // per hex: RG province+1, BA realm+1 (nearest, cols x rows)
uniform vec2 uGrid;          // cols, rows
uniform sampler2D tWarp;     // RG border warp offset, world units (linear)
uniform vec2 uWarpSize;      // texels; grid point i sits at world i / 2
uniform float uSigma2;       // border smoothing kernel (shrinks toward hex edges at hex zoom)
uniform float uWarpAmt;
uniform sampler2D tDist;     // B: coast distance
uniform vec2 uIdSpan;
uniform float uIdRes;        // texels per world unit
uniform float uCoastScale;
uniform sampler2D tPalette;  // realm colours by realm+1
uniform float uPaletteSize;

uniform float uPaperMix;     // 1 = paper, 0 = terrain
uniform float uPolitical;    // 0..1 strength of realm colouring
uniform float uSelProv;      // province+1, 0 = none
uniform float uHoverProv;
uniform float uHexGrid;      // 0..1 visibility
uniform float uLapse;

const vec3 LIGHT = normalize(vec3(-0.55, -0.65, 0.58)); // from the north-west (world y points south)

// ----------------------------------------------------------------- noise ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// pcg2d integer hash: no lattice artefacts. Inputs are cell coordinates.
uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v;
}
vec2 hash22(vec2 p) {
  return vec2(pcg2d(uvec2(ivec2(floor(p)) + 65536))) / 4294967295.0;
}
float hash12(vec2 p) { return hash22(p).x; }

// Octave weight that removes detail smaller than ~3 px (prevents shimmer).
float lod(float freq) {
  float pxPerCycle = uZoom / (freq * uPixelRatio);
  return smoothstep(3.0, 8.0, pxPerCycle);
}

float fbmLod(vec2 p, float baseFreq, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float f = baseFreq;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float w = lod(f);
    if (w <= 0.0) break;
    sum += amp * w * snoise(p * f + float(i) * 13.17);
    amp *= 0.5;
    f *= 2.07;
  }
  return sum;
}

// ------------------------------------------------------------ sampling ---
// Cubic B-spline filtering from four bilinear taps (Sigg & Hadwiger):
// iso-lines such as coasts and biome edges come out round instead of
// texel-diamond shaped.
vec4 textureBSpline(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 coord = uv * size - 0.5;
  vec2 i = floor(coord);
  vec2 f = coord - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 / 6.0) * (-f3 + 3.0 * f2 - 3.0 * f + 1.0);
  vec2 w1 = (1.0 / 6.0) * (3.0 * f3 - 6.0 * f2 + 4.0);
  vec2 w2 = (1.0 / 6.0) * (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0);
  vec2 w3 = (1.0 / 6.0) * f3;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (w1 / g0) - 0.5 + i;
  vec2 h1 = (w3 / g1) + 1.5 + i;
  vec4 t00 = texture(tex, (vec2(h0.x, h0.y) + 0.5) / size);
  vec4 t10 = texture(tex, (vec2(h1.x, h0.y) + 0.5) / size);
  vec4 t01 = texture(tex, (vec2(h0.x, h1.y) + 0.5) / size);
  vec4 t11 = texture(tex, (vec2(h1.x, h1.y) + 0.5) / size);
  float sx = g1.x / (g0.x + g1.x);
  float sy = g0.y / (g0.y + g1.y);
  return mix(mix(t01, t11, sx), mix(t00, t10, sx), sy);
}

float baseHeight(vec2 p) { return textureBSpline(tHeight, p / uHeightSpan).r; }

float detailHeight(vec2 p, float h) {
  float mtn = smoothstep(0.12, 0.6, h);
  float d = 0.0;
  float amp = 1.0;
  float f = 0.7;
  // gain < 1/lacunarity: slopes calm down at each finer octave
  for (int i = 0; i < 6; i++) {
    float w = lod(f);
    if (w <= 0.0) break;
    float n = snoise(p * f + float(i) * 7.31);
    float r = 1.0 - abs(n);
    d += amp * w * mix(n * 0.5, r * r - 0.45, mtn);
    amp *= 0.36;
    f *= 2.1;
  }
  return d * (0.0012 + 0.011 * mtn) * step(0.0, h);
}

float fullHeight(vec2 p) {
  float h = baseHeight(p);
  return h + detailHeight(p, h);
}

vec3 reliefNormal(vec2 p, float h, float exaggeration) {
  float e = max(0.6 / uZoom, 0.08);
  float hx = fullHeight(p + vec2(e, 0.0));
  float hy = fullHeight(p + vec2(0.0, e));
  float s = exaggeration / e;
  return normalize(vec3(-(hx - h) * s, -(hy - h) * s, 1.0));
}

// --------------------------------------------------------------- colour ---
struct Biome {
  vec3 color;
  float forest;   // 0..1 tree cover
  float snow;
};

Biome biome(float tempC, float moist, float h, vec2 p) {
  float cold = 1.0 - smoothstep(-3.0, 5.0, tempC);
  float hot = smoothstep(17.0, 25.0, tempC);
  float temperate = clamp(1.0 - cold - hot, 0.0, 1.0);

  float dry = 1.0 - smoothstep(0.09, 0.22, moist);
  float wet = smoothstep(0.5, 0.68, moist);
  float moistB = smoothstep(0.26, 0.42, moist) * (1.0 - wet);
  float semi = clamp(1.0 - dry - wet - moistB, 0.0, 1.0);

  vec3 cTundra = vec3(0.58, 0.57, 0.48);
  vec3 cTaiga = vec3(0.30, 0.37, 0.27);
  vec3 cColdDesert = vec3(0.66, 0.61, 0.45);
  vec3 cSteppe = vec3(0.62, 0.61, 0.36);
  vec3 cGrass = vec3(0.47, 0.54, 0.28);
  vec3 cForest = vec3(0.31, 0.40, 0.21);
  vec3 cDesert = vec3(0.84, 0.72, 0.50);
  vec3 cSavanna = vec3(0.68, 0.61, 0.34);
  vec3 cSavannaWet = vec3(0.52, 0.55, 0.28);
  vec3 cJungle = vec3(0.22, 0.36, 0.17);

  vec3 coldC = cTundra * (dry + semi) + mix(cTundra, cTaiga, 0.6) * moistB + cTaiga * wet;
  vec3 tempC3 = cColdDesert * dry + cSteppe * semi + cGrass * moistB + cForest * wet;
  vec3 hotC = cDesert * dry + cSavanna * semi + cSavannaWet * moistB + cJungle * wet;

  Biome b;
  b.color = coldC * cold + tempC3 * temperate + hotC * hot;
  b.forest = (wet + moistB * 0.35) * (cold * 0.85 + temperate + hot * 1.1);
  b.forest *= smoothstep(-4.0, 1.0, tempC);
  b.snow = 1.0 - smoothstep(-9.0, -3.0, tempC);
  return b;
}

// Tree crowns seen from above: one jittered crown per cell, lit as a dome.
// Returns rgb in .xyz, coverage in .w
vec4 canopy(vec2 p, float density, vec3 base, float cell) {
  vec2 g = p / cell;
  vec2 gi = floor(g);
  float best = 10.0;
  vec2 bestCell = vec2(0.0);
  vec2 bestOff = vec2(0.0);
  float bestR = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = gi + vec2(float(x), float(y));
      float present = step(hash22(c + vec2(4099.0, 811.0)).y, density);
      if (present < 0.5) continue;
      vec2 o = c + 0.15 + 0.7 * hash22(c);
      float r = 0.48 + 0.3 * hash22(c + vec2(17.0, 2311.0)).x;
      vec2 d = g - o;
      float dd = length(d) / r;
      if (dd < best) {
        best = dd;
        bestCell = c;
        bestOff = d / r;
        bestR = r;
      }
    }
  }
  if (best >= 1.0) return vec4(0.0);
  float z = sqrt(max(0.0, 1.0 - best * best));
  vec3 n = normalize(vec3(bestOff, z * 1.3));
  float lit = 0.45 + 0.75 * max(dot(n, LIGHT), 0.0);
  float tone = 0.82 + 0.3 * hash22(bestCell + vec2(907.0, 53.0)).y;
  vec3 c = base * tone * lit;
  float edge = 1.0 - smoothstep(0.8, 1.0, best);
  return vec4(c, edge);
}

// Self-shadow of crowns: is the point under a neighbouring crown toward the light?
float canopyShadow(vec2 p, float density, float cell) {
  vec2 q = p - LIGHT.xy * cell * 0.45;
  vec2 g = q / cell;
  vec2 gi = floor(g);
  float s = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 c = gi + vec2(float(x), float(y));
      if (hash22(c + vec2(4099.0, 811.0)).y > density) continue;
      vec2 o = c + 0.15 + 0.7 * hash22(c);
      float r = 0.48 + 0.3 * hash22(c + vec2(17.0, 2311.0)).x;
      s = max(s, 1.0 - smoothstep(0.7, 1.0, length(g - o) / r));
    }
  return s;
}

// ----------------------------------------------------------- the looks ---
vec3 terrainLook(vec2 p, float h, vec3 N, float tempC, float moist, float coastDist) {
  if (h < 0.0) {
    // ---- water
    float depth = -h;
    vec3 shallow = vec3(0.27, 0.47, 0.50);
    vec3 mid = vec3(0.14, 0.30, 0.40);
    vec3 deep = vec3(0.07, 0.15, 0.26);
    vec3 c = mix(shallow, mid, smoothstep(0.0, 0.1, depth));
    c = mix(c, deep, smoothstep(0.1, 0.65, depth));
    // seabed relief faintly visible in shallows
    float bed = clamp(dot(N, LIGHT) / LIGHT.z, 0.6, 1.3);
    c *= mix(1.0, bed, 0.2 * smoothstep(0.02, 0.06, depth) * (1.0 - smoothstep(0.06, 0.18, depth)));
    // cold seas are greyer
    c = mix(c, vec3(0.30, 0.37, 0.42) * (1.0 - depth * 0.5), (1.0 - smoothstep(-8.0, 6.0, tempC)) * 0.5);
    // waves and sun glint
    float wv = fbmLod(p, 1.6, 4);
    vec3 wn = normalize(vec3(fbmLod(p + 3.3, 2.2, 4) * 0.25, wv * 0.25, 1.0));
    float spec = pow(max(dot(reflect(-LIGHT, wn), vec3(0.0, 0.0, 1.0)), 0.0), 24.0);
    c += vec3(0.85, 0.82, 0.7) * spec * 0.08;
    c *= 0.94 + 0.08 * wv;
    // surf along the shore
    // (from depth, not the coast-distance texture, so it stays smooth up close)
    float shore = 1.0 - smoothstep(0.0, 0.012 + 0.006 * snoise(p * 3.0), depth);
    c = mix(c, vec3(0.62, 0.72, 0.70), shore * 0.35);
    return c;
  }

  // ---- land
  Biome b = biome(tempC, moist, h, p);
  vec3 c = b.color;
  // macro and micro variation so large areas never look flat
  float macro = snoise(p * 0.07) * 0.5 + snoise(p * 0.21) * 0.3;
  c *= 0.93 + 0.12 * macro;
  c = mix(c, c * vec3(1.06, 1.02, 0.86), smoothstep(0.2, 0.8, snoise(p * 0.11 + 9.0)) * 0.5);
  float grain = fbmLod(p, 6.0, 4);
  c *= 0.96 + 0.1 * grain;

  // beaches on warm coasts
  float beach = (1.0 - smoothstep(0.002, 0.009, h)) * smoothstep(8.0, 16.0, tempC) * (1.0 - b.forest * 0.6) * (1.0 - smoothstep(0.08, 0.2, 1.0 - N.z));
  c = mix(c, vec3(0.82, 0.74, 0.56), beach * 0.75);

  // rock on steep slopes and high ground
  float slope = 1.0 - N.z;
  float rockMix = smoothstep(0.3, 0.6, slope) + smoothstep(0.45, 0.72, h) * 0.75;
  rockMix = clamp(rockMix, 0.0, 1.0);
  float strata = snoise(vec2(p.x * 0.6, h * 60.0)) * 0.5 + 0.5;
  vec3 rock = mix(vec3(0.42, 0.39, 0.35), vec3(0.58, 0.53, 0.46), strata);
  c = mix(c, rock, rockMix);

  // forest canopy; fades into a dark tint when trees are smaller than a few pixels
  float clump = smoothstep(-0.35, 0.45, snoise(p * 0.35) + 0.25 * snoise(p * 1.4));
  float fd = clamp(b.forest * (0.55 + 0.6 * clump), 0.0, 1.0) * (1.0 - rockMix) * (1.0 - beach);
  vec3 treeBase = mix(vec3(0.20, 0.29, 0.15), vec3(0.15, 0.24, 0.16), smoothstep(5.0, -5.0, tempC));
  treeBase = mix(treeBase, vec3(0.13, 0.27, 0.12), smoothstep(20.0, 26.0, tempC));
  const float CELL = 0.085;
  float crownPx = CELL * uZoom;
  float detailVis = smoothstep(2.2, 4.5, crownPx);
  vec3 farForest = treeBase * 1.05 * (0.92 + 0.1 * grain);
  c = mix(c, farForest, fd * 0.85 * (1.0 - detailVis));
  if (detailVis > 0.0 && fd > 0.02) {
    vec4 tc = canopy(p, fd, treeBase, CELL);
    float sh = canopyShadow(p, fd, CELL);
    vec3 under = mix(c, treeBase * 0.5, 0.6);
    vec3 ground = mix(c, under, fd);
    ground *= 1.0 - sh * 0.3;
    vec3 near = mix(ground, tc.rgb, tc.a);
    c = mix(c, near, detailVis);
  }

  // snow: cold places and peaks; slides off the steepest faces
  float snow = b.snow * (1.0 - smoothstep(0.55, 0.85, slope) * 0.7);
  snow *= 0.85 + 0.3 * snoise(p * 2.0);
  c = mix(c, vec3(0.93, 0.95, 0.97), clamp(snow, 0.0, 1.0));

  // lighting
  float diff = max(dot(N, LIGHT), 0.0);
  float lit = 0.45 + 0.55 * diff / LIGHT.z;
  lit = clamp(lit, 0.32, 1.25);
  c *= lit;
  // cool shadows, warm light (painterly)
  c = mix(c, c * vec3(0.86, 0.92, 1.08), (1.0 - clamp(lit, 0.0, 1.0)) * 0.6);
  // darker wet edge right at the waterline
  c *= 1.0 - (1.0 - smoothstep(0.0, 0.005, h)) * 0.1;
  return c;
}

float stripe(float v, float widthFrac) {
  float f = fract(v);
  return 1.0 - smoothstep(widthFrac, widthFrac + 0.18, abs(f - 0.5) * 2.0);
}

vec3 paperBase(vec2 p) {
  vec3 c = vec3(0.86, 0.79, 0.64);
  float stain = snoise(p * 0.018) * 0.6 + snoise(p * 0.05) * 0.3 + snoise(p * 0.16) * 0.1;
  c = mix(c, vec3(0.76, 0.66, 0.48), smoothstep(0.05, 0.9, stain) * 0.55);
  c = mix(c, vec3(0.91, 0.86, 0.73), smoothstep(-0.2, -0.85, stain) * 0.45);
  // paper fibre and speckle, in world space so it travels with the map
  float fib = fbmLod(vec2(p.x * 2.5, p.y * 0.6), 1.0, 3);
  c *= 0.97 + 0.05 * fib;
  float spk = step(0.996, hash12(p * 9.0));
  c *= 1.0 - spk * 0.12 * lod(9.0);
  return c;
}

vec3 paperLook(vec2 p, float h, vec3 N, float tempC, float moist, float coastDist, float pxWorld) {
  vec3 paper = paperBase(p);
  float diff = max(dot(N, LIGHT), 0.0);
  float lit = clamp(0.35 + 0.65 * diff / LIGHT.z, 0.0, 1.3);

  if (h < 0.0) {
    float depth = -h;
    vec3 sea = mix(vec3(0.62, 0.72, 0.74), vec3(0.47, 0.58, 0.65), smoothstep(0.05, 0.7, depth));
    vec3 c = mix(paper * sea * 1.2, sea * 1.02, 0.45);
    // concentric ripple lines hugging the coast, like an engraved chart
    float lines = 0.0;
    for (int k = 0; k < 4; k++) {
      float d = 0.42 + float(k) * 0.55 + float(k * k) * 0.12;
      float wv = 0.05 * snoise(p * 0.8 + float(k));
      float a = 1.0 - smoothstep(0.0, 1.0 * pxWorld, abs(coastDist - d - wv));
      lines = max(lines, a * (0.55 - float(k) * 0.12));
    }
    c = mix(c, vec3(0.30, 0.38, 0.40), lines * 0.55);
    return c;
  }

  Biome b = biome(tempC, moist, h, p);
  // land is a slightly warmer, brighter sheet, washed with a hint of biome colour
  vec3 c = paper * vec3(1.03, 1.0, 0.94);
  vec3 wash = mix(vec3(1.0), b.color / max(max(b.color.r, b.color.g), 0.01), 0.22);
  c *= wash;
  // dry lands get an ochre wash, cold lands go pale
  c = mix(c, c * vec3(1.05, 0.95, 0.80), smoothstep(0.25, 0.08, moist) * smoothstep(8.0, 18.0, tempC) * 0.6);
  c = mix(c, vec3(0.92, 0.91, 0.86), b.snow * 0.7);

  // sepia hillshade
  c *= mix(vec3(0.62, 0.50, 0.38), vec3(1.0), clamp(lit, 0.0, 1.0));
  c *= 1.0 + max(0.0, lit - 1.0) * 0.12;

  // engraved hatching in mountain shadows (world-anchored, constant 4–8 px pitch)
  float L = log2(uZoom / 5.0);
  float f0 = exp2(floor(L));
  float t = fract(L);
  vec2 hp = vec2(p.x + p.y, p.x - p.y) * 0.7071;
  float hatch = mix(stripe(hp.x * f0, 0.22), stripe(hp.x * f0 * 2.0, 0.22), t);
  float shade = smoothstep(0.95, 0.45, lit) * smoothstep(0.18, 0.42, h);
  c = mix(c, c * vec3(0.55, 0.45, 0.36), hatch * shade * 0.75);
  float cross = mix(stripe(hp.y * f0, 0.2), stripe(hp.y * f0 * 2.0, 0.2), t);
  float shade2 = smoothstep(0.7, 0.3, lit) * smoothstep(0.35, 0.6, h);
  c = mix(c, c * vec3(0.5, 0.42, 0.34), cross * shade2 * 0.6);

  // forests as stippled dots
  float sL = log2(uZoom / 9.0);
  float sf0 = exp2(floor(sL));
  float st = fract(sL);
  float dots = 0.0;
  for (int k = 0; k < 2; k++) {
    float f = sf0 * (k == 0 ? 1.0 : 2.0);
    vec2 g = p * f * 0.5;
    vec2 gi = floor(g);
    vec2 o = gi + 0.1 + 0.8 * hash22(gi + vec2(float(k) * 1709.0, 0.0));
    float present = step(hash22(gi + vec2(77.0, float(k) * 3001.0)).y, (b.forest - 0.35) * 1.6);
    float r = (0.9 + 0.7 * hash22(gi + vec2(5.0, float(k) * 911.0)).x) * pxWorld * f * 0.5;
    float dd = length(g - o);
    float a = (1.0 - smoothstep(r * 0.6, r * 1.2, dd)) * present;
    dots = max(dots, a * (k == 0 ? 1.0 - st : st));
  }
  c = mix(c, vec3(0.33, 0.37, 0.24), dots * 0.75 * smoothstep(0.0, 0.03, h));

  // soft shadow along the land side of the coast
  c *= 1.0 - (1.0 - smoothstep(0.0, 0.45, coastDist)) * 0.12;
  return c;
}

// --------------------------------------------------------------- borders ---
float lineAA(float distPx, float halfWidthPx) {
  return 1.0 - smoothstep(halfWidthPx - 0.6, halfWidthPx + 0.6, distPx);
}

vec3 realmColor(float realmId) {
  return texture(tPalette, vec2((realmId + 0.5) / uPaletteSize, 0.5)).rgb;
}

// distance (world units) from p to the nearest hex edge
float hexEdgeDist(vec2 p) {
  vec2 q = p - vec2(0.8660254, 1.0);
  float qf = (0.57735027 * q.x - q.y / 3.0);
  float rf = (2.0 / 3.0) * q.y;
  vec3 cube = vec3(qf, -qf - rf, rf);
  vec3 r = floor(cube + 0.5);
  vec3 d = abs(r - cube);
  if (d.x > d.y && d.x > d.z) r.x = -r.y - r.z;
  else if (d.y > d.z) r.y = -r.x - r.z;
  else r.z = -r.x - r.y;
  vec2 c = vec2(1.7320508 * (r.x + r.z * 0.5), 1.5 * r.z);
  vec2 v = q - c;
  // pointy-top hex: edge normals at 0°, 60°, 120°
  float a = abs(v.x);
  float b = abs(dot(v, vec2(0.5, 0.8660254)));
  float e = abs(dot(v, vec2(-0.5, 0.8660254)));
  return 0.8660254 - max(a, max(b, e));
}

// ------------------------------------------------- analytic borders ---
// Ownership is a Gaussian vote of the hex under the (warped) point and its six
// neighbours, the same rule the CPU uses for picking. Border distance comes
// from the vote margin divided by its gradient, so lines stay smooth at any
// zoom instead of following texels.
struct Owner {
  float id;     // province+1 or realm+1, 0 = none
  float dist;   // world units to the nearest border with another owner
};

ivec2 hexOf(vec2 q) {
  vec2 v = q - vec2(0.8660254, 1.0);
  float qf = 0.57735027 * v.x - v.y / 3.0;
  float rf = (2.0 / 3.0) * v.y;
  vec3 cube = vec3(qf, -qf - rf, rf);
  vec3 r = floor(cube + 0.5);
  vec3 d = abs(r - cube);
  if (d.x > d.y && d.x > d.z) r.x = -r.y - r.z;
  else if (d.y > d.z) r.y = -r.x - r.z;
  else r.z = -r.x - r.y;
  int row = int(r.z);
  int col = int(r.x) + (row - (row & 1)) / 2;
  return ivec2(col, row);
}

vec2 hexCenter(ivec2 h) {
  return vec2(1.7320508 * (float(h.x) + 0.5 * float(h.y & 1)) + 0.8660254, 1.5 * float(h.y) + 1.0);
}

// Distance to where the two votes tie, from the log-ratio of the votes:
// exact on a straight bisector, well behaved for any kernel width.
float borderDist(float wa, vec2 ga, float wb, vec2 gb) {
  wb = max(wb, 1e-30);
  float f = log(wa / wb);
  vec2 g = ga / wa - gb / wb;
  return f / max(length(g), 1e-6);
}

void owners(vec2 p, out Owner prov, out Owner realm) {
  vec2 w = texture(tWarp, (p * 2.0 + 0.5) / uWarpSize).rg * uWarpAmt;
  vec2 q = p + w;
  ivec2 h0 = hexOf(q);
  float pid[7]; float pw[7]; vec2 pg[7];
  float rid[7]; float rw[7]; vec2 rg[7];
  int np = 0; int nr = 0;
  bool odd = (h0.y & 1) == 1;
  for (int k = 0; k < 7; k++) {
    ivec2 o = ivec2(0);
    if (k == 1) o = ivec2(1, 0);
    else if (k == 2) o = odd ? ivec2(1, -1) : ivec2(0, -1);
    else if (k == 3) o = odd ? ivec2(0, -1) : ivec2(-1, -1);
    else if (k == 4) o = ivec2(-1, 0);
    else if (k == 5) o = odd ? ivec2(0, 1) : ivec2(-1, 1);
    else if (k == 6) o = odd ? ivec2(1, 1) : ivec2(0, 1);
    ivec2 h = h0 + o;
    if (h.x < 0 || h.y < 0 || h.x >= int(uGrid.x) || h.y >= int(uGrid.y)) continue;
    vec4 t = texelFetch(tHex, h, 0) * 255.0;
    float idp = t.r + t.g * 256.0;
    if (idp < 0.5) continue;
    float idr = t.b + t.a * 256.0;
    vec2 dv = q - hexCenter(h);
    float wt = exp(-dot(dv, dv) / uSigma2);
    vec2 gr = -2.0 * dv / uSigma2 * wt;
    bool found = false;
    for (int j = 0; j < 7; j++) {
      if (j >= np) break;
      if (pid[j] == idp) { pw[j] += wt; pg[j] += gr; found = true; break; }
    }
    if (!found) { pid[np] = idp; pw[np] = wt; pg[np] = gr; np++; }
    found = false;
    for (int j = 0; j < 7; j++) {
      if (j >= nr) break;
      if (rid[j] == idr) { rw[j] += wt; rg[j] += gr; found = true; break; }
    }
    if (!found) { rid[nr] = idr; rw[nr] = wt; rg[nr] = gr; nr++; }
  }
  prov = Owner(0.0, 1e3);
  realm = Owner(0.0, 1e3);
  if (np == 0) return;
  int a = 0; int b = -1;
  for (int j = 1; j < 7; j++) { if (j >= np) break; if (pw[j] > pw[a]) a = j; }
  for (int j = 0; j < 7; j++) { if (j >= np) break; if (j != a && (b < 0 || pw[j] > pw[b])) b = j; }
  prov.id = pid[a];
  if (b >= 0) prov.dist = borderDist(pw[a], pg[a], pw[b], pg[b]);
  a = 0; b = -1;
  for (int j = 1; j < 7; j++) { if (j >= nr) break; if (rw[j] > rw[a]) a = j; }
  for (int j = 0; j < 7; j++) { if (j >= nr) break; if (j != a && (b < 0 || rw[j] > rw[b])) b = j; }
  realm.id = rid[a];
  if (b >= 0) realm.dist = borderDist(rw[a], rg[a], rw[b], rg[b]);
}

void main() {
  vec2 frag = gl_FragCoord.xy - uViewport * 0.5;
  vec2 p = uCenter + vec2(frag.x, -frag.y) / uZoom;
  float pxWorld = 1.0 / uZoom; // world units per device px

  // ---- the desk outside the sheet
  vec2 inside = min(p, uWorld - p);
  float edgeIn = min(inside.x, inside.y);
  if (edgeIn < 0.0) {
    float d = -edgeIn;
    vec3 desk = vec3(0.16, 0.12, 0.09) * (0.92 + 0.1 * snoise(p * vec2(0.08, 0.9)));
    desk *= mix(0.55, 1.0, smoothstep(0.0, 6.0 + 20.0 * pxWorld, d)); // the sheet casts a shadow
    fragColor = vec4(desk, 1.0);
    return;
  }

  float h0 = baseHeight(p);
  float h = h0 + detailHeight(p, h0);
  vec2 clim = textureBSpline(tClimate, p / uClimateSpan).rg;
  float tempC = clim.r - max(h, 0.0) * uLapse;
  float moist = clim.g;

  float coastDist = texture(tDist, p / uIdSpan).b * 255.0 / uCoastScale / uIdRes; // world units
  Owner po;
  Owner ro;
  owners(p, po, ro);
  float prov = po.id;
  float realm = ro.id;
  float provDist = po.dist;
  float realmDist = ro.dist;

  float paperMix = uPaperMix;
  vec3 col;
  vec3 N = vec3(0.0, 0.0, 1.0);
  if (paperMix < 0.999) {
    float ex = mix(4.2, 1.3, smoothstep(5.0, 40.0, uZoom / uPixelRatio));
    N = reliefNormal(p, h, h < 0.0 ? ex * 0.4 : ex);
    col = terrainLook(p, h, N, tempC, moist, coastDist);
  }
  if (paperMix > 0.001) {
    vec3 Np = paperMix < 0.999 ? N : reliefNormal(p, h, h < 0.0 ? 1.5 : 6.0);
    vec3 pc = paperLook(p, h, Np, tempC, moist, coastDist, pxWorld);
    col = paperMix < 0.999 ? mix(col, pc, paperMix) : pc;
  }

  bool land = h0 >= 0.0;
  float landA = smoothstep(-0.002, 0.002, h0);

  // ---- realm colouring
  if (realm > 0.5 && uPolitical > 0.0) {
    vec3 rc = realmColor(realm);
    // watercolour: flat wash, pooled darker toward the realm edge
    float pool = 1.0 - smoothstep(0.0, mix(0.9, 0.35, 1.0 - paperMix), realmDist);
    float washPaper = 0.5 + 0.25 * pool;
    float washTerrain = 0.16 + 0.22 * pool;
    float wash = mix(washTerrain, washPaper, paperMix) * uPolitical * landA;
    vec3 tinted = col * mix(vec3(1.0), rc * 1.4, 0.72);
    col = mix(col, tinted, wash);
  }

  // ---- province borders: hairlines, stronger when zoomed in
  float provPx = provDist * uZoom;
  float provVis = smoothstep(2.0 * uPixelRatio, 6.0 * uPixelRatio, uZoom) * landA;
  float provLine = lineAA(provPx, 0.55 * uPixelRatio) * provVis;
  vec3 provInk = mix(vec3(0.12, 0.10, 0.08), vec3(0.35, 0.26, 0.18), paperMix);
  col = mix(col, provInk, provLine * mix(0.5, 0.4, paperMix));

  // ---- realm borders: thick, two-tone (each side draws its own colour)
  float realmPx = realmDist * uZoom;
  float rw = (1.4 + 0.9 * smoothstep(3.0, 30.0, uZoom / uPixelRatio)) * uPixelRatio;
  float realmLine = lineAA(realmPx, rw) * landA;
  if (realm > 0.5 && realmLine > 0.0) {
    vec3 rc = realmColor(realm);
    vec3 edgeC = uPolitical > 0.0 ? mix(rc * 0.55, rc * 0.42, paperMix) : vec3(0.16, 0.12, 0.09);
    col = mix(col, edgeC, realmLine * 0.92);
    float core = lineAA(realmPx, 0.5 * uPixelRatio) * landA;
    col = mix(col, vec3(0.10, 0.07, 0.05), core * 0.55);
  }

  // ---- coastline ink (paper) / wet edge line (terrain)
  float hw = fwidth(h0);
  float coastLine = 1.0 - smoothstep(0.6, 1.8, abs(h0) / max(hw, 1e-5));
  col = mix(col, vec3(0.27, 0.20, 0.14), coastLine * mix(0.28, 0.85, paperMix));

  // ---- hover and selection
  if (uHoverProv > 0.5 && abs(prov - uHoverProv) < 0.5) col = mix(col, vec3(1.0, 0.97, 0.88), 0.1);
  if (uSelProv > 0.5 && abs(prov - uSelProv) < 0.5) {
    col = mix(col, vec3(1.0, 0.96, 0.84), 0.12);
    float selLine = lineAA(provPx, 1.6 * uPixelRatio);
    col = mix(col, vec3(0.95, 0.80, 0.42), selLine);
  }

  // ---- hex grid at the closest zoom
  if (uHexGrid > 0.0) {
    float he = hexEdgeDist(p) * uZoom;
    float g = lineAA(he, 0.5 * uPixelRatio) * uHexGrid;
    // ink on light ground, chalk on dark forest
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 ink = lum < 0.3 ? vec3(0.86, 0.82, 0.68) : vec3(0.1, 0.08, 0.06);
    col = mix(col, land ? ink : vec3(0.75, 0.85, 0.88), g * (land ? (lum < 0.3 ? 0.3 : 0.35) : 0.18));
  }

  // ---- sheet edge: aged darkening on paper, thin frame line
  float edgePx = edgeIn * uZoom;
  col *= mix(1.0, 0.82 + 0.18 * smoothstep(0.0, 18.0, edgeIn), paperMix);
  col = mix(col, vec3(0.22, 0.16, 0.11), lineAA(abs(edgePx - 7.0 * uPixelRatio), 0.6 * uPixelRatio) * paperMix * 0.7);

  // gentle vignette on screen
  vec2 sv = gl_FragCoord.xy / uViewport - 0.5;
  col *= 1.0 - dot(sv, sv) * 0.22;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
