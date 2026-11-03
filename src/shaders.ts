export const ribbonVertex = /* glsl */ `
attribute vec3 aTan;
attribute vec4 aParams; // side, width, birth, colorT
attribute vec3 aCopy;   // angle, mirror, index

uniform float uTime;
uniform float uLife;
uniform vec2 uRes;
uniform float uCamDist;
uniform float uSpread;
uniform vec3 uPal[4];

varying float vAcross;
varying float vFade;
varying float vHeat;
varying float vDepth;
varying vec3 vCol;

vec3 xform(vec3 p, float ang, float mir) {
  if (mir > 0.5) p.x = -p.x;
  float c = cos(ang);
  float s = sin(ang);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 palette(float t) {
  float f = 1.0 - abs(2.0 * fract(t) - 1.0);
  float x = f * 3.0;
  int i = int(min(floor(x), 2.0));
  float k = smoothstep(0.0, 1.0, x - float(i));
  return mix(uPal[i], uPal[i + 1], k);
}

void main() {
  float age = uTime - aParams.z;
  float an = clamp(age / uLife, 0.0, 1.0);
  if (an >= 1.0 || age < 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  vec3 p = xform(position, aCopy.x, aCopy.y);
  vec3 t = xform(aTan, aCopy.x, aCopy.y);

  vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(p + t * 0.05, 1.0);
  float aspect = uRes.x / uRes.y;
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * vec2(aspect, 1.0);
  float dl = length(d);
  d = dl > 1e-6 ? d / dl : vec2(1.0, 0.0);
  vec2 perp = vec2(-d.y, d.x) / vec2(aspect, 1.0);

  float taper = 1.0 - 0.62 * an;
  float halfW = aParams.y * 0.5 * taper;
  float ndcHalf = max(halfW * projectionMatrix[1][1] / c0.w, 1.1 / uRes.y);
  vec4 pos = c0;
  pos.xy += perp * aParams.x * ndcHalf * c0.w;
  gl_Position = pos;

  vAcross = aParams.x;
  vFade = pow(1.0 - an, 1.45);
  vHeat = exp(-age * 3.2);
  vDepth = mix(1.25, 0.32, smoothstep(uCamDist - 4.0, uCamDist + 4.5, c0.w));
  vCol = palette(aParams.w + aCopy.z * uSpread);
}
`;

export const ribbonFragment = /* glsl */ `
varying float vAcross;
varying float vFade;
varying float vHeat;
varying float vDepth;
varying vec3 vCol;

uniform float uGain;

void main() {
  float a = abs(vAcross);
  float core = exp(-a * a * 11.0);
  float halo = 1.0 - smoothstep(0.25, 1.0, a);
  vec3 col = mix(vCol, vec3(1.0), clamp(core * 0.22 + vHeat * 0.5, 0.0, 1.0));
  float inten = (halo * halo * 0.5 + core * 1.15) * vFade * vDepth * uGain;
  gl_FragColor = vec4(col * inten, 1.0);
}
`;
