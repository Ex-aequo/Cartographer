import * as THREE from 'three';
import type { MapData } from '../model/types';
import type { RenderAssets } from './assets';
import { BORDER_SIGMA2, COAST_SCALE, ID_RES } from './assets';
import { LAPSE } from '../gen/biomes';
import mapFrag from './shaders/map.frag.glsl?raw';
import { riverFrag, riverVert } from './shaders/river';

export interface View {
  /** world units */
  cx: number;
  cy: number;
  /** CSS pixels per world unit */
  zoom: number;
}

export type MapMode = 'political' | 'terrain';

export interface RenderState {
  view: View;
  mode: MapMode;
  selectedProvince: number; // -1 none
  hoveredProvince: number;
}

/** Zoom thresholds in CSS px per world unit. */
export const ZOOM = {
  paperEnd: 5.5,
  terrainStart: 12,
  hexStart: 38,
  hexFull: 60,
  min: 0.6,
  max: 220,
};

export function hexFactor(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - ZOOM.hexStart) / (ZOOM.hexFull - ZOOM.hexStart)));
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
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mapMat: THREE.RawShaderMaterial;
  private riverMat: THREE.RawShaderMaterial;
  private riverMesh: THREE.Mesh | null = null;
  private textures: THREE.Texture[] = [];
  private world = { width: 1, height: 1 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x1d1610);

    const common = {
      uViewport: { value: new THREE.Vector2(1, 1) },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uZoom: { value: 1 },
      uPixelRatio: { value: 1 },
      uPaperMix: { value: 1 },
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
        tHeight: { value: null },
        uHeightSpan: { value: new THREE.Vector2(1, 1) },
        tClimate: { value: null },
        uClimateSpan: { value: new THREE.Vector2(1, 1) },
        tHex: { value: null },
        uGrid: { value: new THREE.Vector2(1, 1) },
        tWarp: { value: null },
        uWarpSize: { value: new THREE.Vector2(1, 1) },
        uSigma2: { value: BORDER_SIGMA2 },
        uWarpAmt: { value: 1 },
        tDist: { value: null },
        uIdSpan: { value: new THREE.Vector2(1, 1) },
        uIdRes: { value: ID_RES },
        uCoastScale: { value: COAST_SCALE },
        tPalette: { value: null },
        uPaletteSize: { value: 1 },
        uPolitical: { value: 1 },
        uSelProv: { value: 0 },
        uHoverProv: { value: 0 },
        uHexGrid: { value: 0 },
        uLapse: { value: LAPSE },
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
    const u = this.mapMat.uniforms;
    u.uWorld.value.set(map.world.width, map.world.height);

    const height = new THREE.DataTexture(map.height.data, map.height.w, map.height.h, THREE.RedFormat, THREE.FloatType);
    linear(height);
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
    const warp = new THREE.DataTexture(a.warp, a.warpW, a.warpH, THREE.RGFormat, THREE.FloatType);
    linear(warp);
    u.tWarp.value = warp;
    u.uWarpSize.value.set(a.warpW, a.warpH);
    const dist = new THREE.DataTexture(a.distData, a.idW, a.idH, THREE.RGBAFormat, THREE.UnsignedByteType);
    linear(dist);
    u.tDist.value = dist;
    u.uIdSpan.value.set(a.idW / ID_RES, a.idH / ID_RES);

    const palCount = a.realmPalette.length / 4;
    const pal = new THREE.DataTexture(a.realmPalette, palCount, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    pal.minFilter = pal.magFilter = THREE.NearestFilter;
    pal.needsUpdate = true;
    u.tPalette.value = pal;
    u.uPaletteSize.value = palCount;
    this.textures.push(height, climate, hexTex, warp, dist, pal);

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
    const u = this.mapMat.uniforms;
    u.uViewport.value.copy(size);
    u.uCenter.value.set(s.view.cx, s.view.cy);
    u.uZoom.value = s.view.zoom * pr;
    u.uPixelRatio.value = pr;
    u.uPaperMix.value = paperMixFor(s.view.zoom);
    u.uPolitical.value = s.mode === 'political' ? 1 : 0;
    u.uSelProv.value = s.selectedProvince + 1;
    u.uHoverProv.value = s.hoveredProvince + 1;
    const hz = hexFactor(s.view.zoom);
    u.uHexGrid.value = hz;
    // at hex zoom, borders tighten onto hex edges so they agree with the grid
    u.uSigma2.value = BORDER_SIGMA2 + (0.04 - BORDER_SIGMA2) * hz;
    u.uWarpAmt.value = 1 - hz;
    this.renderer.render(this.scene, this.camera);
  }

  get worldSize() {
    return this.world;
  }

  private disposeTextures(): void {
    this.textures.forEach((t) => t.dispose());
    this.textures = [];
  }

  dispose(): void {
    this.disposeTextures();
    this.riverMesh?.geometry.dispose();
    this.mapMat.dispose();
    this.riverMat.dispose();
    this.renderer.dispose();
  }
}

function linear(t: THREE.DataTexture): void {
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false;
  t.needsUpdate = true;
}
