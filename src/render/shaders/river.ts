export const riverVert = /* glsl */ `
precision highp float;
in vec2 position;
in vec2 aNormal;
in float aWidth;
uniform vec2 uCenter;
uniform float uZoom;
uniform vec2 uViewport;
uniform float uPixelRatio;
uniform float u3D;
uniform vec3 uCamPos;
uniform vec3 uCamR;
uniform vec3 uCamUp;
uniform vec3 uCamF;
uniform float uFocal;
uniform float uReliefH;
uniform sampler2D tHeight;
uniform vec2 uHeightSpan;
out float vAcross;
out float vHalf;
out float vAlpha;
void main() {
  // local scale: px per world unit where this vertex is
  float zoomL = uZoom;
  float zc = 1.0;
  vec3 P = vec3(position, 0.0);
  if (u3D > 0.5) {
    P.z = max(texture(tHeight, position / uHeightSpan).r, 0.0) * uReliefH + 0.02;
    zc = max(dot(P - uCamPos, uCamF), 1e-3);
    zoomL = uFocal / zc;
  }
  float wpx = aWidth * zoomL;
  float minPx = 1.1 * uPixelRatio;
  // up close, rivers stop growing with the map so hexes stay readable
  float maxPx = (8.5 + 0.06 * wpx / uPixelRatio) * uPixelRatio;
  float half_ = clamp(wpx, minPx, maxPx) * 0.5;
  float side = (gl_VertexID % 2 == 0) ? -1.0 : 1.0;
  float ext = half_ + 1.2 * uPixelRatio;
  vec2 world = position + aNormal * (ext / zoomL);
  if (u3D > 0.5) {
    vec3 d = vec3(world, P.z) - uCamPos;
    float z = max(dot(d, uCamF), 1e-3);
    vec2 s = vec2(dot(d, uCamR), dot(d, uCamUp)) * uFocal;
    gl_Position = vec4(s.x / (uViewport.x * 0.5), s.y / (uViewport.y * 0.5), 0.0, z);
  } else {
    vec2 s = (world - uCenter) * uZoom;
    gl_Position = vec4(s.x / (uViewport.x * 0.5), -s.y / (uViewport.y * 0.5), 0.0, 1.0);
  }
  vAcross = side * ext;
  vHalf = half_;
  // small streams fade out when they would be thinner than a pixel
  vAlpha = smoothstep(0.25 * uPixelRatio, 0.9 * uPixelRatio, wpx);
}
`;

export const riverFrag = /* glsl */ `
precision highp float;
in float vAcross;
in float vHalf;
in float vAlpha;
out vec4 fragColor;
uniform float uPaperMix;
uniform float uPixelRatio;
void main() {
  float d = abs(vAcross);
  float a = 1.0 - smoothstep(vHalf - 0.55 * uPixelRatio, vHalf + 0.55 * uPixelRatio, d);
  float core = 1.0 - smoothstep(vHalf * 0.15, vHalf * 0.95, d);
  vec3 water = mix(vec3(0.20, 0.36, 0.42), vec3(0.30, 0.48, 0.52), core);
  vec3 ink = vec3(0.30, 0.40, 0.46);
  vec3 c = mix(water, ink, uPaperMix);
  fragColor = vec4(c, a * vAlpha * mix(0.95, 0.85, uPaperMix));
}
`;
