export const riverVert = /* glsl */ `
precision highp float;
in vec2 position;
in vec2 aNormal;
in float aWidth;
uniform vec2 uCenter;
uniform float uZoom;
uniform vec2 uViewport;
uniform float uPixelRatio;
out float vAcross;
out float vHalf;
out float vAlpha;
void main() {
  float wpx = aWidth * uZoom;
  float minPx = 1.1 * uPixelRatio;
  float half_ = max(wpx, minPx) * 0.5;
  float side = (gl_VertexID % 2 == 0) ? -1.0 : 1.0;
  float ext = half_ + 1.2 * uPixelRatio;
  vec2 world = position + aNormal * (ext / uZoom);
  vec2 s = (world - uCenter) * uZoom;
  gl_Position = vec4(s.x / (uViewport.x * 0.5), -s.y / (uViewport.y * 0.5), 0.0, 1.0);
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
