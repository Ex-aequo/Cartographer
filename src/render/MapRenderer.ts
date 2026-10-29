import * as THREE from 'three';
import { isGameMap, type MapData } from '../model/types';
import type { RenderAssets } from './assets';
import { BORDER_SIGMA2, COAST_SCALE, borderBase } from './assets';
import { LAPSE } from '../gen/biomes';
import { categoriesFor, modeDef, rampFor, type MapMode } from './mapModes';
export type { MapMode } from './mapModes';
import mapFrag from './shaders/map.frag.glsl?raw';
import { riverFrag, riverVert } from './shaders/river';

import { basisFor, is3d, type View } from './camera';
export type { View } from './camera';


export interface RenderState {
  view: View;
  mode: MapMode;
  selectedProvince: number; // -1 none
  hoveredProvince: number;
}

/** Zoom thresholds in CSS px per world unit, for classic maps. */
const ZOOM_CLASSIC = {
  paperEnd: 5.5,
  terrainStart: 12,
  hexStart: 38,
  hexFull: 60,
  /** realm names fade out between these */
  realmFade0: 6,
  realmFade1: 8.5,
  /** towns and province names fade in between these */
  townFade0: 13,
  townFade1: 18,
  /** borders tighten onto hex edges between these */
  snapStart: 38,
  snapFull: 60,
  min: 0.6,
  max: 220,
};

/**
 * Zoom thresholds in CSS px per world unit for the map on screen. Small 4X
 * maps (few, big hexes) fill the screen at a much higher zoom, so the paper
 * map and terrain steps move up with the zoom that shows the whole world;
 * classic maps keep the fixed values above.
 */
export const ZOOM = { ...ZOOM_CLASSIC };

export function applyZoomProfile(world: { width: number }, game = false): void {
  const fit = 1300 / Math.max(1, world.width); // whole world on a typical screen
  const paperEnd = Math.max(ZOOM_CLASSIC.paperEnd, 1.4 * fit);
  const terrainStart = Math.max(ZOOM_CLASSIC.terrainStart, 2.3 * fit);
  const hexStart = Math.max(ZOOM_CLASSIC.hexStart, 3.4 * fit);
  const realmFade0 = Math.max(ZOOM_CLASSIC.realmFade0, paperEnd * 1.09);
  const townFade0 = Math.max(ZOOM_CLASSIC.townFade0, terrainStart * 0.85);
  Object.assign(ZOOM, {
    paperEnd,
    terrainStart,
    hexStart,
    hexFull: hexStart * (ZOOM_CLASSIC.hexFull / ZOOM_CLASSIC.hexStart),
    realmFade0,
    realmFade1: realmFade0 * (ZOOM_CLASSIC.realmFade1 / ZOOM_CLASSIC.realmFade0),
    townFade0,
    townFade1: townFade0 * (ZOOM_CLASSIC.townFade1 / ZOOM_CLASSIC.townFade0),
    max: Math.max(ZOOM_CLASSIC.max, hexStart * 5),
  });
  // 4X maps: frontiers follow hex edges from the Kingdom level inward; classic maps only at Hex zoom
  ZOOM.snapStart = game ? paperEnd : ZOOM.hexStart;
  ZOOM.snapFull = game ? paperEnd * 1.3 : ZOOM.hexFull;
}

export type Quality = 'high' | 'balanced' | 'fast';

export function pixelRatioFor(q: Quality): number {
  const dpr = window.devicePixelRatio || 1;
  if (q === 'high') return Math.min(dpr, 2);
  if (q === 'balanced') return Math.min(dpr, 1.25);
  return Math.min(dpr, 1) * 0.7;
}

export function hexFactor(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - ZOOM.hexStart) / (ZOOM.hexFull - ZOOM.hexStart)));
  return t * t * (3 - 2 * t);
}

/** How far borders have tightened onto hex edges at a zoom (0 = smooth, 1 = on the edges). */
export function borderSnap(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - ZOOM.snapStart) / Math.max(1e-6, ZOOM.snapFull - ZOOM.snapStart)));
  return t * t * (3 - 2 * t);
}

export function paperMixFor(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - ZOOM.paperEnd) / (ZOOM.terrainStart - ZOOM.paperEnd)));
  return 1 - t * t * (3 - 2 * t);
}

const quadVert = `
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class MapRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private border = { sigma2: BORDER_SIGMA2, warp: 1 };
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mapMat: THREE.RawShaderMaterial;
  private riverMat: THREE.RawShaderMaterial;
  private riverMesh: THREE.Mesh | null = null;
  private textures: THREE.Texture[] = [];
  private world = { width: 1, height: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(pixelRatioFor('high'));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x1d1610);

    const common = {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uZoom: { value: 1 },
      uPixelRatio: { value: 1 },
      uPaperMix: { value: 1 },
      u3D: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uCamR: { value: new THREE.Vector3(1, 0, 0) },
      uCamUp: { value: new THREE.Vector3(0, -1, 0) },
      uCamF: { value: new THREE.Vector3(0, 0, -1) },
      uFocal: { value: 1 },
      uReliefH: { value: 0 },
      uMarchSteps: { value: 48 },
      tHeight: { value: null },
      uHeightSpan: { value: new THREE.Vector2(1, 1) },
    };
    this.mapMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: quadVert,
      fragmentShader: mapFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...common,
        uWorld: { value: new THREE.Vector2(1, 1) },
        tClimate: { value: null },
        uClimateSpan: { value: new THREE.Vector2(1, 1) },
        tHex: { value: null },
        uGrid: { value: new THREE.Vector2(1, 1) },
        tHexAux: { value: null },
        tFarm: { value: null },
        tPaint: { value: null },
        uFarmSpan: { value: new THREE.Vector2(1, 1) },
        tHexData: { value: null },
        tHexLayer: { value: null },
        tWarp: { value: null },
        uWarpSize: { value: new THREE.Vector2(1, 1) },
        uSigma2: { value: BORDER_SIGMA2 },
        uWarpAmt: { value: 1 },
        tDist: { value: null },
        uIdSpan: { value: new THREE.Vector2(1, 1) },
        uIdRes: { value: 3 },
        uCoastScale: { value: COAST_SCALE },
        tPalette: { value: null },
        uPaletteSize: { value: 1 },
        uPolitical: { value: 1 },
        uSelProv: { value: 0 },
        uHoverProv: { value: 0 },
        uHexGrid: { value: 0 },
        uLapse: { value: LAPSE },
        uRelief: { value: 1 },
        uDebug: { value: 0 },
        uDataMode: { value: 0 },
        uSource: { value: 0 },
        uRampN: { value: 0 },
        uRampPos: { value: new Array(9).fill(0) },
        uRampCol: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
        uCatCol: { value: Array.from({ length: 16 }, () => new THREE.Vector3()) },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mapMat);
    quad.frustumCulled = false;
    this.scene.add(quad);

    this.riverMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: riverVert,
      fragmentShader: riverFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: common, // shared uniform objects: one update drives both
    });
  }

  setMap(map: MapData, a: RenderAssets): void {
    this.disposeTextures();
    this.world = map.world;
    applyZoomProfile(map.world, isGameMap(map.meta.params));
    this.border = borderBase(map);
    const u = this.mapMat.uniforms;
    u.uWorld.value.set(map.world.width, map.world.height);

    const height = new THREE.DataTexture(map.height.data, map.height.w, map.height.h, THREE.RedFormat, THREE.FloatType);
    linear(height);
    this.heightTex = height;
    u.tHeight.value = height;
    u.uHeightSpan.value.set(map.height.w / map.height.res, map.height.h / map.height.res);

    const cw = map.baseTemp.w;
    const ch = map.baseTemp.h;
    const clim = new Float32Array(cw * ch * 2);
    for (let i = 0; i < cw * ch; i++) {
      clim[i * 2] = map.baseTemp.data[i];
      clim[i * 2 + 1] = map.moisture.data[i];
    }
    const climate = new THREE.DataTexture(clim, cw, ch, THREE.RGFormat, THREE.FloatType);
    linear(climate);
    u.tClimate.value = climate;
    u.uClimateSpan.value.set(cw / map.baseTemp.res, ch / map.baseTemp.res);

    const hexTex = new THREE.DataTexture(a.hexOwners, map.grid.cols, map.grid.rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    hexTex.minFilter = hexTex.magFilter = THREE.NearestFilter;
    hexTex.needsUpdate = true;
    u.tHex.value = hexTex;
    u.uGrid.value.set(map.grid.cols, map.grid.rows);
    const hexAux = new THREE.DataTexture(a.hexAux, map.grid.cols, map.grid.rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    hexAux.minFilter = hexAux.magFilter = THREE.NearestFilter;
    hexAux.needsUpdate = true;
    u.tHexAux.value = hexAux;
    const farm = new THREE.DataTexture(a.farm, a.farmW, a.farmH, THREE.RedFormat, THREE.FloatType);
    linear(farm);
    u.tFarm.value = farm;
    u.uFarmSpan.value.set(a.farmW, a.farmH);
    const hexData = new THREE.DataTexture(a.hexData, map.grid.cols, map.grid.rows, THREE.RGBAFormat, THREE.FloatType);
    hexData.minFilter = hexData.magFilter = THREE.NearestFilter;
    hexData.needsUpdate = true;
    u.tHexData.value = hexData;
    const warp = new THREE.DataTexture(a.warp, a.warpW, a.warpH, THREE.RGFormat, THREE.FloatType);
    linear(warp);
    u.tWarp.value = warp;
    u.uWarpSize.value.set(a.warpW, a.warpH);
    const dist = new THREE.DataTexture(a.coast, a.coastW, a.coastH, THREE.RedFormat, THREE.UnsignedByteType);
    dist.unpackAlignment = 1;
    linear(dist);
    u.tDist.value = dist;
    u.uIdSpan.value.set(a.coastW / a.coastRes, a.coastH / a.coastRes);
    u.uIdRes.value = a.coastRes;
    const paint = new THREE.DataTexture(a.paint, a.farmW, a.farmH, THREE.RGBAFormat, THREE.FloatType);
    linear(paint);
    u.tPaint.value = paint;

    const palCount = a.realmPalette.length / 4;
    const pal = new THREE.DataTexture(a.realmPalette, palCount, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    pal.minFilter = pal.magFilter = THREE.NearestFilter;
    pal.needsUpdate = true;
    u.tPalette.value = pal;
    u.uPaletteSize.value = palCount;
    this.textures.push(height, climate, hexTex, hexAux, hexData, farm, paint, warp, dist, pal);

    if (this.riverMesh) {
      this.scene.remove(this.riverMesh);
      this.riverMesh.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.river.position, 2));
    g.setAttribute('aNormal', new THREE.BufferAttribute(a.river.normal, 2));
    g.setAttribute('aWidth', new THREE.BufferAttribute(a.river.width, 1));
    g.setIndex(new THREE.BufferAttribute(a.river.index, 1));
    // 2D positions: give the geometry explicit bounds instead of letting three compute them
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-Infinity, -Infinity, -1), new THREE.Vector3(Infinity, Infinity, 1));
    this.riverMesh = new THREE.Mesh(g, this.riverMat);
    this.riverMesh.frustumCulled = false;
    this.riverMesh.renderOrder = 1;
    this.scene.add(this.riverMesh);
  }

  resize(cssW: number, cssH: number): void {
    this.renderer.setSize(cssW, cssH, false);
  }

  render(s: RenderState): void {
    const pr = this.renderer.getPixelRatio();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.draw(s, size.x, size.y, pr);
  }

  /**
   * Renders into a drawing buffer of exactly w × h pixels with `pr` device
   * pixels per CSS pixel (the look follows view.zoom, the sharpness follows pr).
   * Used for tiled high-resolution export.
   */
  renderExact(s: RenderState, w: number, h: number, pr: number): void {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.draw(s, w, h, pr);
  }

  private draw(s: RenderState, bw: number, bh: number, pr: number): void {
    const u = this.mapMat.uniforms;
    u.uViewport.value.set(bw, bh);
    u.uCenter.value.set(s.view.cx, s.view.cy);
    u.uZoom.value = s.view.zoom * pr;
    u.uPixelRatio.value = pr;
    u.uPaperMix.value = paperMixFor(s.view.zoom);
    u.uPolitical.value = s.mode === 'political' ? 1 : 0;
    if (s.mode !== this.lastMode) this.applyMode(s.mode);
    u.uSelProv.value = s.selectedProvince + 1;
    u.uHoverProv.value = s.hoveredProvince + 1;
    const hz = hexFactor(s.view.zoom);
    u.uHexGrid.value = hz;
    // at hex zoom, borders tighten onto hex edges so they agree with the grid
    const snap = borderSnap(s.view.zoom);
    u.uSigma2.value = this.border.sigma2 + (0.04 - this.border.sigma2) * snap;
    u.uWarpAmt.value = this.border.warp * (1 - snap);
    // the 3D camera (same maths as render/camera.ts, in device px)
    const v = s.view;
    u.u3D.value = is3d(v) ? 1 : 0;
    if (is3d(v)) {
      const b = basisFor({ ...v, zoom: v.zoom * pr }, bh);
      u.uCamPos.value.set(b.pos[0], b.pos[1], b.pos[2]);
      u.uCamR.value.set(b.right[0], b.right[1], b.right[2]);
      u.uCamUp.value.set(b.up[0], b.up[1], b.up[2]);
      u.uCamF.value.set(b.fwd[0], b.fwd[1], b.fwd[2]);
      u.uFocal.value = b.focal;
      u.uReliefH.value = v.relief ?? 0;
    }
    this.renderer.render(this.scene, this.camera);
  }

  private lastMode: MapMode | null = null;
  private heightTex: THREE.DataTexture | null = null;

  /** The heightfield was edited in place: upload it again before the next frame. */
  heightChanged(): void {
    if (this.heightTex) this.heightTex.needsUpdate = true;
  }

  private layerTex: THREE.DataTexture | null = null;

  /** Colours of the custom layer shown in a `layer:` mode (RGBA8 per hex). */
  setLayerColors(colors: Uint8Array | null, cols: number, rows: number): void {
    const u = this.mapMat.uniforms;
    const data = colors ?? new Uint8Array(cols * rows * 4);
    if (!this.layerTex || this.layerTex.image.width !== cols || this.layerTex.image.height !== rows) {
      this.layerTex?.dispose();
      this.layerTex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
      this.layerTex.minFilter = this.layerTex.magFilter = THREE.NearestFilter;
    } else {
      (this.layerTex.image.data as Uint8Array).set(data);
    }
    this.layerTex.needsUpdate = true;
    u.tHexLayer.value = this.layerTex;
  }

  private applyMode(m: MapMode): void {
    this.lastMode = m;
    const u = this.mapMat.uniforms;
    const d = modeDef(m);
    u.uDataMode.value = d.shader;
    u.uSource.value = d.source ?? 0;
    const ramp = rampFor(m);
    if (ramp) {
      u.uRampN.value = ramp.stops.length;
      ramp.stops.forEach((v, i) => {
        u.uRampPos.value[i] = v;
        u.uRampCol.value[i].set(ramp.colors[i][0] / 255, ramp.colors[i][1] / 255, ramp.colors[i][2] / 255);
      });
    }
    const cats = categoriesFor(m);
    if (cats) for (const c of cats) u.uCatCol.value[c.code].set(c.color[0] / 255, c.color[1] / 255, c.color[2] / 255);
  }

  setQuality(q: Quality): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setPixelRatio(pixelRatioFor(q));
    this.renderer.setSize(size.x, size.y, false);
    // fewer gully octaves on the fastest setting
    this.mapMat.uniforms.uRelief.value = q === 'fast' ? 0.85 : 1;
    this.mapMat.uniforms.uMarchSteps.value = q === 'high' ? 64 : q === 'balanced' ? 44 : 28;
  }

  /** Debug and test hook: override a shader uniform. */
  setUniform(name: string, value: number): void {
    const u = this.mapMat.uniforms[name];
    if (u) u.value = value;
  }

  get worldSize() {
    return this.world;
  }

  private disposeTextures(): void {
    this.textures.forEach((t) => t.dispose());
    this.textures = [];
  }

  /** `loseContext` frees the WebGL context at once (offscreen export renderers). */
  dispose(loseContext = false): void {
    this.disposeTextures();
    this.layerTex?.dispose();
    this.riverMesh?.geometry.dispose();
    this.mapMat.dispose();
    this.riverMat.dispose();
    this.renderer.dispose();
    if (loseContext) this.renderer.forceContextLoss();
  }
}

function linear(t: THREE.DataTexture): void {
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
}
