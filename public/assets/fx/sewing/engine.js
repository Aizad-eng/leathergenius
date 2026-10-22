// Leather Genius FX: sewing machine (walking-foot lockstitch) close-up.
// ES module, loaded lazily by module.js. three.js r169 from /assets/vendor/three/.
import * as THREE from '../../vendor/three/three.module.min.js';

const MM = 0.001;
const PITCH = 4.2 * MM;          // stitch length
const SEAM_X = 0;                // needle line (strip local x)
const LAYER = 1.35 * MM;         // one leather layer
const YL = LAYER * 2;            // leather top surface (world y)
const HOLE_Z0 = 14 * MM;         // strip-local z of hole 0
const T_START = 3.0;             // three stitches already sewn at t = 0
const T_SCROLL_END = 44.0;       // stitches reached at the end of the scroll range
const T_MAX = 160.0;             // strip length limit
const STRIP_LEN = HOLE_Z0 + (T_MAX + 30) * PITCH;
const STRIP_W = 110 * MM;
const EDGE_X = -6.5 * MM;        // painted edge, 6.5 mm from the seam

const PALETTE = {
  oxblood: { leather: 0x3a0c0f, edge: 0x300b0c, sheen: 0x5a2a26 },
  cognac: { leather: 0x8a4318, edge: 0x2c1408, sheen: 0x8a5a36 },
};
const THREADS = { cream: 0xdccaa0, black: 0x1b1a19 };

// ---------------------------------------------------------------- timing
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const smoother = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (t * 6 - 15) + 10); };
const FEED_A = 0.31, FEED_B = 0.69;
function feedEase(ph) { return smoother(FEED_A, FEED_B, ph); }
function stripOffset(T) { const n = Math.floor(T); return HOLE_Z0 - PITCH / 2 + PITCH * (n + feedEase(T - n)); }
// needle tip height above bed (world y)
const TIP_MID = 8.2 * MM, TIP_AMP = 15.5 * MM;
function tipY(ph) { return TIP_MID + TIP_AMP * Math.cos(ph * Math.PI * 2); }
// needle-feed: needle bar swings with the material while it is in it
function needleZ(ph) {
  if (ph >= FEED_A && ph <= FEED_B) return PITCH / 2 - PITCH * feedEase(ph);
  const r = ph > FEED_B ? (ph - FEED_B) : (ph + 1 - FEED_B);
  return -PITCH / 2 + PITCH * smoother(0, 1 - (FEED_B - FEED_A), r);
}
const TU_PX = 0.011, TU_PY = 0.206, TU_L = 0.032;
const TS_X = -0.008, TS_Y = 0.150;
function takeUpY(ph) {
  // high (thread tight) just after the needle leaves the leather, low while the hook takes the loop
  const a = Math.cos((ph - 0.86) * Math.PI * 2);
  return TU_PY + 0.020 * a + 0.004 * Math.sin((ph - 0.86) * Math.PI * 4);
}
function innerFootLift(ph) { return 3.2 * MM * (1 - smooth(0.16, 0.30, ph) * (1 - smooth(0.72, 0.86, ph))); }
function outerFootLift(ph) { return 3.0 * MM * smooth(0.28, 0.40, ph) * (1 - smooth(0.62, 0.74, ph)); }

// ---------------------------------------------------------------- geometry helpers
function rbox(w, h, d, r, k = 5) {
  const segs = 2 * k + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, segs, segs, segs);
  const p = g.attributes.position, n = g.attributes.normal;
  const H = [w / 2, h / 2, d / 2];
  const v = new THREE.Vector3(), inner = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const c = [p.getX(i), p.getY(i), p.getZ(i)];
    for (let a = 0; a < 3; a++) {
      const j = Math.round((c[a] + 0.5) * segs);
      let pos;
      if (j <= k) pos = -H[a] + r * (1 - Math.cos((j / k) * Math.PI / 2));
      else if (j >= segs - k) pos = H[a] - r * (1 - Math.cos(((segs - j) / k) * Math.PI / 2));
      else pos = -H[a] + r + (H[a] * 2 - r * 2) * ((j - k) / (segs - 2 * k));
      c[a] = pos;
    }
    v.set(c[0], c[1], c[2]);
    inner.set(
      Math.max(-H[0] + r, Math.min(H[0] - r, v.x)),
      Math.max(-H[1] + r, Math.min(H[1] - r, v.y)),
      Math.max(-H[2] + r, Math.min(H[2] - r, v.z)));
    dir.subVectors(v, inner);
    if (dir.lengthSq() > 1e-14) { dir.normalize(); v.copy(inner).addScaledVector(dir, r); n.setXYZ(i, dir.x, dir.y, dir.z); }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.userData.half = new THREE.Vector3(...H); g.userData.r = r;
  return g;
}

function lathe(profile, seg = 48) { return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg); }

// ---------------------------------------------------------------- textures
function loadTex(loader, url, srgb, repeat) {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

function threadPlyTexture() {
  const W = 64, H = 64, data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // two-ply twist: grooves run diagonally around the tube
    const u = x / W, v = y / H;
    const ph = (u * 2 + v * 2) * Math.PI * 2;
    const dh = Math.cos(ph);
    const s = Math.sin(ph) > 0.85 ? 1 : 0;
    const nx = -dh * 0.55, ny = -dh * 0.55;
    const l = Math.hypot(nx, ny, 1);
    const i = (y * W + x) * 4;
    data[i] = (nx / l * 0.5 + 0.5) * 255; data[i + 1] = (ny / l * 0.5 + 0.5) * 255; data[i + 2] = (1 / l * 0.5 + 0.5) * 255; data[i + 3] = 255 - s * 60;
  }
  const t = new THREE.DataTexture(data, W, H);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

function plateTexture() {
  // needle plate: brushed steel with feed-dog slots and a needle hole
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#9a9a98'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`; g.fillRect(0, Math.random() * 512, 512, Math.random() * 1.4); }
  g.fillStyle = '#121212';
  const slot = (x, y, w, h) => { g.beginPath(); g.roundRect(x, y, w, h, Math.min(w, h) / 2); g.fill(); };
  // plate is 50mm (x) by 60mm (z): u = x, v = z. needle at center.
  slot(256 - 46, 256 - 120, 22, 230); slot(256 + 24, 256 - 120, 22, 230); slot(256 - 9, 256 - 120, 18, 98); slot(256 - 9, 256 + 22, 18, 98);
  g.beginPath(); g.arc(256, 256, 9, 0, 7); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.strokeRect(6, 6, 500, 500);
  for (const [x, y] of [[60, 60], [452, 452]]) { g.fillStyle = '#6f6f6d'; g.beginPath(); g.arc(x, y, 22, 0, 7); g.fill(); g.fillStyle = '#1a1a1a'; g.fillRect(x - 20, y - 3, 40, 6); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function coneThreadTexture(hex) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512;
  const g = c.getContext('2d');
  const col = new THREE.Color(hex);
  g.fillStyle = '#' + col.getHexString(); g.fillRect(0, 0, 64, 512);
  for (let y = 0; y < 512; y += 2) { g.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.12})`; g.fillRect(0, y, 64, 1); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 4);
  return t;
}

// ---------------------------------------------------------------- materials
const GLSL_TRIPLANAR = `
vec4 triSample(sampler2D tex, vec3 p, vec3 n, float s){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);
  return texture2D(tex, p.yz * s) * w.x + texture2D(tex, p.xz * s) * w.y + texture2D(tex, p.xy * s) * w.z;
}`;

// Enamelled cast iron with worn edges showing bare metal. Works on rbox geometry.
function enamelMaterial(colorHex, geo, wearTex, opts = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: colorHex, roughness: opts.roughness ?? 0.32, metalness: 0.0,
    clearcoat: opts.clearcoat ?? 0.45, clearcoatRoughness: 0.3,
  });
  const half = geo.userData.half || new THREE.Vector3(1, 1, 1);
  const r = geo.userData.r || 0.005;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uHalf = { value: half }; sh.uniforms.uR = { value: r };
    sh.uniforms.uWear = { value: wearTex }; sh.uniforms.uWearAmt = { value: opts.wear ?? 1.0 }; sh.uniforms.uMode = { value: opts.mode === 'extrude' ? 1.0 : 0.0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc; varying vec3 vLocN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position; vLocN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLoc; varying vec3 vLocN; uniform vec3 uHalf; uniform float uR; uniform sampler2D uWear; uniform float uWearAmt; uniform float uMode;
float gWear; float gMott; float gScr;
${GLSL_TRIPLANAR}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 q = uHalf - abs(vLoc);
  float a = min(q.x, min(q.y, q.z));
  float b = max(min(q.x, q.y), max(min(q.x, q.z), min(q.y, q.z))); // 2nd smallest-ish
  float edge = 1.0 - smoothstep(uR * 0.15, uR * 0.85, b);
  if (uMode > 0.5) { float nz = abs(normalize(vLocN).z); edge = exp(-pow((nz - 0.68) / 0.16, 2.0)); }
  vec4 w = triSample(uWear, vLoc, vLocN, 9.0);
  vec4 w2 = triSample(uWear, vLoc, vLocN, 31.0);
  gMott = w.r; gScr = w2.g;
  float n = w.b * 0.7 + w2.b * 0.3;
  gWear = smoothstep(0.60, 0.66, edge * (0.35 + n * 0.95)) * uWearAmt;
  gWear = max(gWear, step(0.82, gScr) * 0.35 * uWearAmt * smoothstep(0.3, 0.9, n));
  diffuseColor.rgb *= 0.93 + 0.14 * gMott;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.41, 0.39), gWear);
  // grime in the flats
  diffuseColor.rgb *= 1.0 - 0.10 * smoothstep(0.4, 0.8, w2.r) * (1.0 - edge);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor * (0.8 + 0.5 * gMott) + gScr * 0.15, 0.38, gWear);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.95, gWear);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.clearcoat *= (1.0 - gWear) * (0.8 + 0.2 * gMott);`);
  };
  m.customProgramCacheKey = () => 'enamel';
  return m;
}

function leatherMaterial(pal, maps, uniforms) {
  const m = new THREE.MeshPhysicalMaterial({
    color: pal.leather, roughness: 0.7, metalness: 0,
    sheen: 0.08, sheenRoughness: 0.6, sheenColor: new THREE.Color(pal.sheen),
    clearcoat: 0.0,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, {
      uLA: { value: maps.a }, uLN: { value: maps.n }, uLR: { value: maps.r },
      uEdgeCol: { value: new THREE.Color(pal.edge) },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc; varying vec3 vLocN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position; vLocN = normal; vNMat = normalMatrix;');
    sh.vertexShader = sh.vertexShader.replace('varying vec3 vLoc; varying vec3 vLocN;', 'varying vec3 vLoc; varying vec3 vLocN; varying mat3 vNMat;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLoc; varying vec3 vLocN; varying mat3 vNMat;
uniform sampler2D uLA; uniform sampler2D uLN; uniform sampler2D uLR; uniform vec3 uEdgeCol;
uniform float uHoleZ0; uniform float uPitch; uniform float uHoleMax; uniform float uStitchMax; uniform float uSeamX; uniform float uTop; uniform float uLayer;
float gTop; float gAO; vec2 gLUV; float gGroove;
// height field of the stitch line in mm (negative = pressed in)
float stitchH(vec2 p, out float ao){
  ao = 0.0;
  float k = floor((p.y - uHoleZ0) / uPitch + 0.5);
  float h = 0.0;
  for (int o = -1; o <= 1; o++) {
    float kk = k + float(o);
    if (kk > uHoleMax || kk < 0.0) continue;
    vec2 d = p - vec2(uSeamX, uHoleZ0 + kk * uPitch);
    // slanted chisel slit (LR leather point)
    float c = 0.819, s = 0.574;
    vec2 r = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    float e = (r.x * r.x) / (0.95e-3 * 0.95e-3) + (r.y * r.y) / (0.55e-3 * 0.55e-3);
    h += -0.30 * exp(-e * 0.9);
    ao = max(ao, exp(-e * 1.3));
  }
  // groove under each laid stitch (thread pulled into the grain)
  float j = floor((p.y - uHoleZ0) / uPitch) + 1.0;
  if (j <= uStitchMax && j >= 1.0) {
    vec2 a = vec2(uSeamX - 0.42e-3, uHoleZ0 + (j - 1.0) * uPitch + 0.25e-3);
    vec2 b = vec2(uSeamX + 0.42e-3, uHoleZ0 + j * uPitch - 0.25e-3);
    vec2 pa = p - a, ba = b - a;
    float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float dd = length(pa - ba * t);
    float g = exp(-(dd * dd) / (0.62e-3 * 0.62e-3));
    h += -0.16 * g;
    ao = max(ao, exp(-(dd * dd) / (0.48e-3 * 0.48e-3)) * 0.9);
  }
  return h;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
gTop = smoothstep(0.55, 0.9, vLocN.y);
gLUV = vec2(vLoc.x, -vLoc.z) * 30.0;
vec3 la = texture2D(uLA, gLUV).rgb;
vec3 la2 = texture2D(uLA, gLUV * 0.13 + 0.37).rgb;
vec3 leatherCol = diffuseColor.rgb * (pow(la, vec3(1.6)) * 1.3) * (0.86 + 0.28 * la2.r);
float ao0; float hs = stitchH(vLoc.xz, ao0);
gAO = ao0 * gTop;
leatherCol *= 1.0 - 0.45 * gAO;
// painted edge: glossy, slightly uneven, with the layer line showing through
vec3 edgeCol = uEdgeCol * (0.9 + 0.2 * texture2D(uLA, vLoc.zy * vec2(4.0, 25.0)).r);
float lay = exp(-pow((vLoc.y - uLayer) / 0.16e-3, 2.0));
edgeCol *= 1.0 - 0.75 * lay;
float bot = smoothstep(-0.55, -0.9, vLocN.y);
diffuseColor.rgb = mix(edgeCol, leatherCol, gTop);
diffuseColor.rgb = mix(diffuseColor.rgb, leatherCol * vec3(0.95, 0.85, 0.8) * 0.8, bot);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float lr = texture2D(uLR, gLUV).r;
roughnessFactor = mix(0.34, mix(lr * 0.6 + 0.4, 0.88, gAO * 0.6), max(gTop, bot));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (gTop > 0.01) {
  vec3 tn = texture2D(uLN, gLUV).xyz * 2.0 - 1.0;
  tn.xy *= 0.7;
  float e = 0.12e-3, ao1;
  float hx = stitchH(vLoc.xz + vec2(e, 0.0), ao1) - stitchH(vLoc.xz - vec2(e, 0.0), ao1);
  float hz = stitchH(vLoc.xz + vec2(0.0, e), ao1) - stitchH(vLoc.xz - vec2(0.0, e), ao1);
  // heights are in mm, distances in m
  vec3 nObj = normalize(vec3(tn.x, tn.z, -tn.y) + vec3(-hx, 0.0, -hz) / (2.0 * e) * 1.0e-3 * 1.0);
  vec3 nv = normalize(vNMat * nObj);
  normal = normalize(mix(normal, nv, gTop));
}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.sheenColor *= gTop;`);
  };
  m.customProgramCacheKey = () => 'leather';
  return m;
}

// ---------------------------------------------------------------- thread tube that updates every frame
class LiveTube {
  constructor(maxPts, radial, radius, material) {
    this.max = maxPts; this.radial = radial; this.radius = radius;
    const vc = maxPts * (radial + 1);
    this.pos = new Float32Array(vc * 3); this.nrm = new Float32Array(vc * 3); this.uv = new Float32Array(vc * 2);
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    this._t = new THREE.Vector3(); this._n = new THREE.Vector3(); this._b = new THREE.Vector3(); this._tmp = new THREE.Vector3();
  }
  update(pts) {
    const n = Math.min(pts.length, this.max), R = this.radial;
    const T = this._t, N = this._n, B = this._b;
    let len = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const nx = pts[Math.min(n - 1, i + 1)], pv = pts[Math.max(0, i - 1)];
      T.subVectors(nx, pv).normalize();
      if (i === 0) { N.set(0, 0, 1); if (Math.abs(T.dot(N)) > 0.9) N.set(1, 0, 0); N.sub(this._tmp.copy(T).multiplyScalar(N.dot(T))).normalize(); }
      else { N.sub(this._tmp.copy(T).multiplyScalar(N.dot(T))).normalize(); len += p.distanceTo(pv); }
      B.crossVectors(T, N);
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const k = (i * (R + 1) + j);
        const nx2 = N.x * c + B.x * s, ny2 = N.y * c + B.y * s, nz2 = N.z * c + B.z * s;
        this.nrm[k * 3] = nx2; this.nrm[k * 3 + 1] = ny2; this.nrm[k * 3 + 2] = nz2;
        this.pos[k * 3] = p.x + nx2 * this.radius; this.pos[k * 3 + 1] = p.y + ny2 * this.radius; this.pos[k * 3 + 2] = p.z + nz2 * this.radius;
        this.uv[k * 2] = len / 0.004; this.uv[k * 2 + 1] = j / R;
      }
    }
    // collapse unused
    for (let i = n; i < this.max; i++) for (let j = 0; j <= R; j++) {
      const k = (i * (R + 1) + j), l = ((n - 1) * (R + 1) + j);
      this.pos[k * 3] = this.pos[l * 3]; this.pos[k * 3 + 1] = this.pos[l * 3 + 1]; this.pos[k * 3 + 2] = this.pos[l * 3 + 2];
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- post (depth of field, tone map, vignette, grain)
const POST_VS = `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tDepth;
uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uAperture; uniform float uMaxR;
uniform float uExposure; uniform float uTime; uniform float uVig;
float linZ(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
float coc(float z){ return clamp(abs(z - uFocus) / z * uAperture, 0.0, uMaxR); }
vec3 aces(vec3 color){
  // three.js ACESFilmic (Stephen Hill fit)
  const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  color = ACESOutputMat * (a / b);
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  float zc = linZ(texture2D(tDepth, vUv).r);
  float rc = coc(zc);
  vec3 acc = texture2D(tColor, vUv).rgb; float wsum = 1.0;
  if (rc > 0.6) {
    const int TAPS = 28;
    float ga = 2.39996323;
    for (int i = 0; i < TAPS; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / float(TAPS)) * rc;
      vec2 o = vec2(cos(fi * ga), sin(fi * ga)) * r / uRes;
      vec2 uv = vUv + o;
      float zs = linZ(texture2D(tDepth, uv).r);
      float rs = coc(zs);
      // background samples may only spread as far as their own blur; foreground spreads freely
      float w = (zs < zc) ? 1.0 : smoothstep(r - 1.0, r + 0.5, rs);
      acc += texture2D(tColor, uv).rgb * w; wsum += w;
    }
  }
  vec3 col = acc / wsum;
  col = aces(col);
  vec2 d = vUv - 0.5; d.x *= uRes.x / uRes.y;
  col *= mix(1.0, smoothstep(1.05, 0.25, length(d)), uVig);
  col = toSRGB(col);
  col += (hash(vUv * uRes + fract(uTime) * 61.0) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- environment (soft studio)
function studioEnv(renderer) {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: 0x6a625a, side: THREE.BackSide }));
  room.position.y = 2; s.add(room);
  const panel = (w, h, col, inten, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(inten), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); s.add(m);
  };
  panel(4.5, 3.5, 0xfff4e6, 1.6, [0.3, 4.8, -0.6], [0, 0, 0]);       // overhead softbox
  panel(3.2, 3.2, 0xffffff, 2.6, [-3.6, 2.0, 3.2], [0, 0.5, 0]);     // big key softbox, front left (behind camera)
  panel(0.45, 4.8, 0xffffff, 7.0, [-4.6, 1.4, 0.4], [0, 1, 0]);      // left strip
  panel(0.5, 4, 0xfff0dc, 4.0, [4.0, 1.6, -3.0], [0, 1, 0]);         // back right rim strip
  panel(3.5, 1.2, 0xffe2c0, 1.4, [1.6, 0.9, 4.8], [0, 0.6, 0]);      // warm front bounce
  panel(8, 8, 0x4a3426, 0.55, [0, -0.9, 0], [0, 1, 0]);             // bench bounce
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------- the scene
export function mount(el, options = {}, base = '') {
  const opts = Object.assign({ leather: 'oxblood', thread: 'cream', scrollLinked: true, camera: 'auto', aperture: 1 }, options);
  const pal = PALETTE[opts.leather] || PALETTE.oxblood;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const canvas = document.createElement('canvas');
  canvas.className = 'lgfx-sewing__canvas';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  } catch (e) { return null; }
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); return null; }
  el.appendChild(canvas);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x231a14).convertSRGBToLinear();
  scene.environment = studioEnv(renderer);
  scene.environmentIntensity = 0.8;

  const loader = new THREE.TextureLoader();
  const tex = (n, srgb, rep) => loadTex(loader, base + 'tex/' + n, srgb, rep);
  const wearTex = tex('wear.webp', false);
  const leatherMaps = { a: tex('leather_a.webp', true), n: tex('leather_n.webp', false), r: tex('leather_r.webp', false) };
  const woodA = tex('wood_a.webp', true, [1.2, 1.2]), woodN = tex('wood_n.webp', false, [1.2, 1.2]), woodR = tex('wood_r.webp', false, [1.2, 1.2]);

  // lights
  // key: a soft spot pooled on the needle, so the bench falls off into shadow like a lamp-lit workshop photo
  const key = new THREE.SpotLight(0xfff0dc, 1.35, 0, 0.42, 0.85, 2);
  key.position.set(-0.32, 0.62, 0.30); key.target.position.set(0.02, 0.02, -0.02);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.2; key.shadow.camera.far = 1.6;
  key.shadow.bias = -0.00012; key.shadow.normalBias = 0.0004; key.shadow.radius = 4;
  scene.add(key, key.target);
  const rim = new THREE.SpotLight(0xffe7cc, 6, 2.0, 0.6, 0.8, 1.2);
  rim.position.set(0.25, 0.32, -0.42); rim.target.position.set(0, 0.04, 0); scene.add(rim, rim.target);
  const fill = new THREE.HemisphereLight(0xfff5ea, 0x3a2a1e, 0.25); scene.add(fill);

  // ---------------- bench (worn wood) and the machine bed sunk flush in it
  const benchMat = new THREE.MeshStandardMaterial({ map: woodA, normalMap: woodN, roughnessMap: woodR, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) });
  const bench = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), benchMat);
  bench.rotation.x = -Math.PI / 2; bench.position.set(0.3, -0.0008, -0.1); bench.receiveShadow = true; scene.add(bench);
  // back wall far away, warm and dark
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshStandardMaterial({ color: 0x3b2c22, roughness: 0.95 }));
  wall.position.set(0.9, 0.5, -1.1); wall.lookAt(-0.3, 0.2, 0.4); scene.add(wall);

  const GREEN = 0x1f3a31;
  const machine = new THREE.Group(); scene.add(machine);
  const addRB = (w, h, d, r, color, pos, o = {}) => {
    const g = rbox(w, h, d, r, o.k || 5);
    const m = new THREE.Mesh(g, o.mat || enamelMaterial(color, g, wearTex, o));
    m.position.set(...pos); m.castShadow = true; m.receiveShadow = true; machine.add(m); return m;
  };
  // bed
  addRB(0.62, 0.05, 0.19, 0.008, GREEN, [0.19, -0.025, -0.005], { wear: 1.2, roughness: 0.5, clearcoat: 0.15 });
  // needle plate + slide plate (polished steel, flush)
  const steel = new THREE.MeshStandardMaterial({ color: 0xd6d6d2, metalness: 1, roughness: 0.26 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe8e8e6, metalness: 1, roughness: 0.07 });
  const brushed = new THREE.MeshStandardMaterial({ color: 0xc9c9c6, metalness: 1, roughness: 0.3 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x2c2c2c, metalness: 0.8, roughness: 0.4 });
  const plateTex = plateTexture();
  const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, metalness: 1, roughness: 0.34, color: 0xffffff });
  const plate = new THREE.Mesh(rbox(0.05, 0.0012, 0.06, 0.0005, 2), [plateMat]);
  plate.geometry.clearGroups(); plate.geometry.addGroup(0, Infinity, 0);
  plate.position.set(0, 0.0002 - 0.0006, 0); plate.receiveShadow = true; machine.add(plate);
  // planar uv for the plate (top view)
  { const p = plate.geometry.attributes.position, uv = plate.geometry.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 0.05 + 0.5, 0.5 - p.getZ(i) / 0.06); }
  const slide = new THREE.Mesh(rbox(0.06, 0.0012, 0.06, 0.0005, 2), brushed);
  slide.position.set(0.056, -0.0004, 0); slide.receiveShadow = true; machine.add(slide);

  // head + arm + pillar
  const HEAD_Y0 = 0.078;
  // one casting: head, arm and pillar from a side profile, extruded front to back with a rounded bevel
  const CAST_D = 0.058, CAST_B = 0.007, CAST_Z = -0.004;
  {
    const s2 = new THREE.Shape();
    s2.moveTo(-0.030, 0.094);
    s2.quadraticCurveTo(-0.030, HEAD_Y0 + 0.007, -0.020, HEAD_Y0 + 0.007);
    s2.lineTo(0.016, HEAD_Y0 + 0.007);
    s2.quadraticCurveTo(0.028, HEAD_Y0 + 0.007, 0.029, 0.098);
    s2.quadraticCurveTo(0.032, 0.138, 0.085, 0.140);
    s2.lineTo(0.325, 0.140);
    s2.quadraticCurveTo(0.358, 0.141, 0.360, 0.105);
    s2.lineTo(0.366, 0.007);
    s2.lineTo(0.466, 0.007);
    s2.lineTo(0.463, 0.175);
    s2.quadraticCurveTo(0.460, 0.218, 0.410, 0.220);
    s2.lineTo(0.090, 0.214);
    s2.quadraticCurveTo(0.042, 0.213, 0.030, 0.232);
    s2.quadraticCurveTo(0.022, 0.243, 0.006, 0.243);
    s2.lineTo(-0.016, 0.243);
    s2.quadraticCurveTo(-0.030, 0.243, -0.030, 0.229);
    s2.lineTo(-0.030, 0.094);
    const g = new THREE.ExtrudeGeometry(s2, { depth: CAST_D, bevelEnabled: true, bevelThickness: CAST_B, bevelSize: CAST_B, bevelSegments: 6, curveSegments: 28 });
    g.translate(0, 0, -CAST_D / 2);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, enamelMaterial(GREEN, g, wearTex, { mode: 'extrude', wear: 1.1, roughness: 0.34 }));
    m.position.z = CAST_Z; m.castShadow = true; m.receiveShadow = true; machine.add(m);
  }
  // faceplate (polished steel) on the left end of the head
  const fp = new THREE.Mesh(rbox(0.003, 0.118, 0.062, 0.004, 3), brushed);
  fp.position.set(-0.0385, HEAD_Y0 + 0.074, CAST_Z); fp.castShadow = true; machine.add(fp);
  const screw = (x, y, z, axis = 'x', r = 0.0032) => {
    const g = new THREE.Group();
    const head = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 0.0018, 24), chrome);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(r * 2.1, 0.0008, r * 0.36), darkSteel);
    slot.position.y = 0.0006; g.add(head, slot);
    if (axis === 'x') g.rotation.z = Math.PI / 2; else if (axis === 'z') g.rotation.x = Math.PI / 2;
    g.position.set(x, y, z); machine.add(g); return g;
  };
  screw(-0.0405, HEAD_Y0 + 0.026, 0.016); screw(-0.0405, HEAD_Y0 + 0.122, -0.022);
  screw(-0.0188, 0.0006, 0.024, 'y', 0.0028); screw(0.0188, 0.0006, -0.024, 'y', 0.0028);
  // bushings where the bars leave the head
  const bush = (x, z, r) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.006, 32), chrome); m.position.set(x, HEAD_Y0 - 0.002, z); m.castShadow = true; machine.add(m); };
  bush(0, 0, 0.0068); bush(0, -0.016, 0.0075); bush(0.0075, -0.0065, 0.005);

  // tension assembly + thread guides on the front face (z = +0.035)
  const FZ = CAST_Z + CAST_D / 2 + CAST_B; // front face of the casting
  const tens = new THREE.Group(); tens.position.set(TS_X, TS_Y, FZ); machine.add(tens);
  { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.03, 16), chrome); post.rotation.x = Math.PI / 2; post.position.z = 0.012; tens.add(post);
    for (const z of [0.004, 0.0062]) { const d = new THREE.Mesh(lathe([[0, 0], [0.008, 0.0002], [0.0092, 0.0008], [0.0088, 0.0012], [0, 0.0012]], 48), chrome); d.rotation.x = Math.PI / 2; d.position.z = z; d.castShadow = true; tens.add(d); }
    const spring = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 60 }, (_, i) => new THREE.Vector3(Math.cos(i * 0.9) * 0.0035, Math.sin(i * 0.9) * 0.0035, 0.0075 + i * 0.00013))), 240, 0.00035, 6), steel); tens.add(spring);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.0058, 0.0058, 0.006, 24), chrome); nut.rotation.x = Math.PI / 2; nut.position.z = 0.0175; nut.castShadow = true; tens.add(nut);
    const knurl = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.0045, 40, 1, true), brushed); knurl.rotation.x = Math.PI / 2; knurl.position.z = 0.0175; tens.add(knurl);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.004, 32), chrome); base.rotation.x = Math.PI / 2; base.position.z = 0.0015; tens.add(base);
  }
  const eyelet = (x, y, z) => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.0022, 0.0006, 10, 24), chrome); m.position.set(x, y, z); m.rotation.y = Math.PI / 2; machine.add(m); const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0009, 0.0009, 0.006, 10), chrome); s.rotation.x = Math.PI / 2; s.position.set(x, y - 0.0025, z - 0.003); machine.add(s); return m; };
  eyelet(-0.024, 0.236, FZ + 0.004);
  eyelet(-0.024, 0.116, FZ + 0.004);
  // take-up lever slot
  const slotM = new THREE.Mesh(rbox(0.006, 0.05, 0.004, 0.0028, 3), new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.8 }));
  slotM.position.set(-0.002, TU_PY, FZ - 0.0012); machine.add(slotM);
  // take-up lever: polished steel arm with an eye, pivots inside the head
  const lever = new THREE.Group(); machine.add(lever);
  { const shp = new THREE.Shape(); shp.moveTo(0, -0.003); shp.lineTo(TU_L, -0.0035); shp.absarc(TU_L, 0, 0.0042, -Math.PI / 2, Math.PI / 2, false); shp.lineTo(0, 0.003); shp.lineTo(0, -0.003);
    const hole = new THREE.Path(); hole.absarc(TU_L + 0.0005, 0, 0.0016, 0, Math.PI * 2, true); shp.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shp, { depth: 0.0018, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, curveSegments: 24 });
    const m = new THREE.Mesh(g, chrome); m.castShadow = true; m.position.z = -0.0009; lever.add(m); }
  lever.position.set(TU_PX, TU_PY, FZ + 0.004); // pivot (inside head); lever points to -x
  lever.rotation.y = Math.PI;

  // ---------------- needle bar assembly
  const needleBar = new THREE.Group(); machine.add(needleBar);
  { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 32), chrome); bar.position.y = 0.05; bar.castShadow = true; needleBar.add(bar);
    const clamp = new THREE.Mesh(rbox(0.011, 0.012, 0.010, 0.0015, 3), steel); clamp.position.y = 0.002; clamp.castShadow = true; needleBar.add(clamp);
    const cs = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 20), chrome); cs.rotation.z = Math.PI / 2; cs.position.set(-0.0065, 0.002, 0); needleBar.add(cs);
    const csl = new THREE.Mesh(new THREE.BoxGeometry(0.0006, 0.0006, 0.0036), darkSteel); csl.position.set(-0.0086, 0.002, 0); needleBar.add(csl);
    // thread guide wire on the clamp
    const tg = new THREE.Mesh(new THREE.TorusGeometry(0.0016, 0.00045, 8, 20), chrome); tg.position.set(0, 0.006, 0.0062); tg.rotation.x = Math.PI / 2; needleBar.add(tg);
    // needle: shank, taper, blade with long groove, eye, cutting point (all below the clamp)
    const nd = lathe([[0, 0], [0.00012, 0.0005], [0.00045, 0.0022], [0.00056, 0.0035], [0.00056, 0.017], [0.0008, 0.0195], [0.001, 0.021], [0.001, 0.036], [0.0009, 0.0364], [0, 0.0365]], 28);
    const needle = new THREE.Mesh(nd, new THREE.MeshStandardMaterial({ color: 0xdedcd8, metalness: 1, roughness: 0.14 }));
    needle.position.y = -0.0395; needle.castShadow = true; needleBar.add(needle);
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.00026, 0.016, 0.0002), darkSteel); groove.position.set(0, -0.0395 + 0.0115, 0.00052); needleBar.add(groove);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.00118, 0.0012, 0.00045), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.5 })); eye.position.set(0, -0.0395 + 0.0026, 0); needleBar.add(eye);
  }
  // needle tip is 0.0395 below needle bar origin

  // ---------------- feet (walking foot: inner foot rides with the needle, outer foot holds)
  function footGeo(len0, len1, toeW, shankTop) {
    const s = new THREE.Shape();
    s.moveTo(len0, 0); s.lineTo(len1 - 0.005, 0);
    s.quadraticCurveTo(len1, 0, len1 + 0.0016, 0.0045); s.lineTo(len1 - 0.0004, 0.005);
    s.quadraticCurveTo(len1 - 0.0016, 0.0022, len1 - 0.006, 0.0022); s.lineTo(len0 + 0.006, 0.0022);
    s.quadraticCurveTo(len0 + 0.0055, 0.006, len0 + 0.0055, 0.010); s.lineTo(len0 + 0.0055, shankTop); s.lineTo(len0, shankTop); s.lineTo(len0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: toeW, bevelEnabled: true, bevelThickness: 0.00035, bevelSize: 0.00035, bevelSegments: 2, curveSegments: 10 });
    g.rotateY(-Math.PI / 2); // shape x -> world z, extrude -> world -x
    return g;
  }
  const outerFoot = new THREE.Group(), innerFoot = new THREE.Group(); machine.add(outerFoot, innerFoot);
  { for (const x of [-0.0036, 0.0068]) { const m = new THREE.Mesh(footGeo(-0.016, 0.011, 0.0032, 0.03), steel); m.position.x = x; m.castShadow = true; outerFoot.add(m); }
    const bridge = new THREE.Mesh(rbox(0.0145, 0.008, 0.0055, 0.0012, 2), steel); bridge.position.set(0.0009, 0.026, -0.01325); bridge.castShadow = true; outerFoot.add(bridge);
    const pbar = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.06, 28), chrome); pbar.position.set(0, 0.058, -0.016); pbar.castShadow = true; outerFoot.add(pbar);
    const pscrew = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.004, 20), chrome); pscrew.rotation.z = Math.PI / 2; pscrew.position.set(-0.0085, 0.027, -0.0133); outerFoot.add(pscrew);
    for (const x of [-0.0011, 0.0024]) { const m = new THREE.Mesh(footGeo(-0.0095, 0.0075, 0.0013, 0.022), brushed); m.position.x = x; m.castShadow = true; innerFoot.add(m); }
    const ib = new THREE.Mesh(rbox(0.0064, 0.006, 0.004, 0.001, 2), brushed); ib.position.set(0.0003, 0.019, -0.0075); innerFoot.add(ib);
    const ibar = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.07, 20), chrome); ibar.position.set(0.0075, 0.055, -0.0065); ibar.castShadow = true; innerFoot.add(ibar);
    const link = new THREE.Mesh(rbox(0.011, 0.005, 0.004, 0.001, 2), brushed); link.position.set(0.004, 0.0215, -0.0068); innerFoot.add(link);
  }

  // ---------------- leather strip (two layers, painted edge) moving along z
  const holeUniforms = {
    uHoleZ0: { value: HOLE_Z0 }, uPitch: { value: PITCH }, uHoleMax: { value: 0 }, uStitchMax: { value: 0 },
    uSeamX: { value: SEAM_X }, uTop: { value: YL }, uLayer: { value: LAYER },
  };
  const strip = new THREE.Group(); scene.add(strip);
  {
    // cross-section in x/y: flat bottom, flat top, rounded painted edge at -x
    const s = new THREE.Shape();
    const r = 0.0007;
    s.moveTo(EDGE_X + r, 0); s.lineTo(EDGE_X + STRIP_W, 0); s.lineTo(EDGE_X + STRIP_W, YL); s.lineTo(EDGE_X + r, YL);
    s.quadraticCurveTo(EDGE_X - 0.00012, YL, EDGE_X - 0.0001, YL - r); s.lineTo(EDGE_X - 0.0001, r);
    s.quadraticCurveTo(EDGE_X - 0.00012, 0, EDGE_X + r, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: STRIP_LEN, bevelEnabled: false, curveSegments: 8, steps: 1 });
    // extrude goes +z from 0..STRIP_LEN : local z == strip coordinate
    const lm = leatherMaterial(pal, leatherMaps, holeUniforms);
    const mesh = new THREE.Mesh(g, lm); mesh.castShadow = true; mesh.receiveShadow = true; strip.add(mesh);
  }
  // contact shadow along the painted edge and under the cut end (soft dark gradient on the bed)
  {
    const c = document.createElement('canvas'); c.width = 64; c.height = 4;
    const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.85, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 4);
    const t = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false });
    const W = 0.006;
    const geo = new THREE.PlaneGeometry(W, STRIP_LEN); geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat); m.position.set(EDGE_X - W / 2 + 0.0002, 0.00012, STRIP_LEN / 2); m.renderOrder = 1; strip.add(m);
    const geo2 = new THREE.PlaneGeometry(STRIP_W, W); geo2.rotateX(-Math.PI / 2);
    const t2 = t.clone(); t2.center.set(0.5, 0.5); t2.rotation = -Math.PI / 2; t2.needsUpdate = true;
    const m2 = new THREE.Mesh(geo2, new THREE.MeshBasicMaterial({ map: t2, transparent: true, depthWrite: false })); m2.position.set(EDGE_X + STRIP_W / 2, 0.00012, -W / 2 + 0.0002); strip.add(m2);
  }
  // laid stitches (instanced)
  const plyTex = threadPlyTexture();
  const threadMat = new THREE.MeshPhysicalMaterial({ color: THREADS[opts.thread] || THREADS.cream, roughness: 0.48, sheen: 0.6, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xffffff), normalMap: plyTex, normalScale: new THREE.Vector2(0.9, 0.9) });
  const liveThreadMat = threadMat.clone(); liveThreadMat.normalScale = new THREE.Vector2(0.35, 0.35);
  const MAXS = Math.ceil(T_MAX) + 8;
  let stitchGeo;
  {
    // one stitch from hole k-1 to hole k (local), slanted, plump, sinking into both holes
    const a = new THREE.Vector3(SEAM_X - 0.42 * MM, YL - 0.55 * MM, -PITCH / 2 + 0.25 * MM);
    const b = new THREE.Vector3(SEAM_X + 0.42 * MM, YL - 0.55 * MM, PITCH / 2 - 0.25 * MM);
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16; const p = new THREE.Vector3().lerpVectors(a, b, t);
      const lift = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.0) / 1.0)));
      p.y = YL - 0.55 * MM + (0.62 * MM) * Math.pow(Math.sin(Math.PI * t), 0.35) - 0.05 * MM * lift;
      pts.push(p);
    }
    stitchGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.42 * MM, 10, false);
    // squash slightly (thread flattens under tension)
    stitchGeo.translate(0, -YL, 0); stitchGeo.scale(1.12, 0.86, 1); stitchGeo.translate(0, YL, 0);
  }
  const stitchUV = stitchGeo.attributes.uv; for (let i = 0; i < stitchUV.count; i++) stitchUV.setX(i, stitchUV.getX(i) * 1.0);
  const stitches = new THREE.InstancedMesh(stitchGeo, threadMat, MAXS);
  stitches.castShadow = true; stitches.receiveShadow = true; stitches.count = 0; stitches.frustumCulled = false; strip.add(stitches);
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < MAXS; k++) {
      const z = HOLE_Z0 + (k - 0.5) * PITCH;
      q.setFromEuler(new THREE.Euler(0, (Math.sin(k * 12.9898) * 0.5) * 0.025, 0));
      m.compose(new THREE.Vector3(0, 0, z), q, k === 0 ? new THREE.Vector3(0, 0, 0) : sc);
      stitches.setMatrixAt(k, m);
    }
    stitches.instanceMatrix.needsUpdate = true;
  }
  // the stitch currently being pulled tight (separate mesh, scaled lift)
  const forming = new THREE.Mesh(stitchGeo, threadMat); forming.castShadow = true; strip.add(forming);

  // live thread from above, through guides, take-up lever, needle eye, down to the last hole
  const live = new LiveTube(260, 8, 0.29 * MM, liveThreadMat); scene.add(live.mesh);

  // ---------------- background tools (out of focus): round knife, awl, thread cone
  const tools = new THREE.Group(); scene.add(tools);
  {
    const woodMat = new THREE.MeshStandardMaterial({ map: woodA, roughness: 0.55, color: 0xb07a4a });
    // round knife: half-moon blade with a short tang and wood scales
    const bs = new THREE.Shape(); bs.moveTo(-0.055, 0); for (let i = 1; i <= 40; i++) { const a = Math.PI + (i / 40) * Math.PI; bs.lineTo(Math.cos(a) * 0.055, Math.sin(a) * 0.045); } bs.lineTo(0.012, 0); bs.lineTo(0.008, 0.03); bs.lineTo(-0.008, 0.03); bs.lineTo(-0.012, 0); bs.lineTo(-0.055, 0);
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(bs, { depth: 0.0012, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0016, bevelSegments: 1, curveSegments: 48 }), new THREE.MeshStandardMaterial({ color: 0xcfcfcb, metalness: 1, roughness: 0.25 }));
    blade.rotation.x = -Math.PI / 2; blade.position.set(0, 0.0012, 0); blade.castShadow = true; blade.receiveShadow = true;
    const handle = new THREE.Mesh(rbox(0.024, 0.016, 0.075, 0.007, 4), woodMat); handle.position.set(0, 0.008, -0.068); handle.castShadow = true;
    const knife = new THREE.Group(); knife.add(blade, handle); knife.position.set(-0.04, 0, -0.31); knife.rotation.y = 0.9; tools.add(knife);
    // awl: turned wooden handle, steel blade, lying on the bench
    const awlH = new THREE.Mesh(lathe([[0, 0], [0.006, 0.002], [0.011, 0.02], [0.012, 0.045], [0.009, 0.07], [0.0055, 0.08], [0.004, 0.085], [0, 0.086]], 32), woodMat);
    const awlB = new THREE.Mesh(lathe([[0.0016, 0], [0.0014, 0.05], [0.0002, 0.065], [0, 0.066]], 16), new THREE.MeshStandardMaterial({ color: 0xd8d8d4, metalness: 1, roughness: 0.2 }));
    awlB.position.y = 0.085; const awl = new THREE.Group(); awl.add(awlH, awlB);
    awl.traverse(o => { o.castShadow = true; });
    awl.rotation.z = Math.PI / 2; awl.rotation.y = -0.5; awl.position.set(0.17, 0.012, -0.24); tools.add(awl);
    // thread cone
    const coneTex = coneThreadTexture(THREADS[opts.thread] || THREADS.cream);
    const coneBody = new THREE.Mesh(lathe([[0.008, 0], [0.034, 0.004], [0.031, 0.05], [0.022, 0.11], [0.012, 0.14], [0.008, 0.142]], 48), new THREE.MeshPhysicalMaterial({ map: coneTex, roughness: 0.6, sheen: 0.8, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.5 }));
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.009, 0.15, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.8, side: THREE.DoubleSide }));
    core.position.y = 0.075; const cone = new THREE.Group(); cone.add(coneBody, core); cone.traverse(o => { o.castShadow = true; });
    cone.position.set(-0.17, 0, -0.29); tools.add(cone);
    // a second cone further back
    const cone2 = cone.clone(); cone2.position.set(-0.30, 0, -0.42); tools.add(cone2);
  }

  if (opts.debug) { const sp = new THREE.Mesh(new THREE.SphereGeometry(0.025, 64, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05 })); sp.position.set(-0.07, 0.04, 0.06); scene.add(sp); }

  // ---------------- camera + post
  const camera = new THREE.PerspectiveCamera(28, 1, 0.02, 6);
  const VIEWS = {
    hero: { target: new THREE.Vector3(0.006, 0.108, 0.0), dir: new THREE.Vector3(-0.70, 0.30, 0.65), dist: 0.50, focus: new THREE.Vector3(0, 0.03, 0.012), fov: 28, ap: 16 },
    mid: { target: new THREE.Vector3(0.002, 0.034, -0.006), dir: new THREE.Vector3(-0.86, 0.33, 0.39), dist: 0.25, focus: new THREE.Vector3(0, 0.012, 0.0), fov: 28, ap: 20 },
    close: { target: new THREE.Vector3(0.0, 0.011, -0.006), dir: new THREE.Vector3(-0.84, 0.52, 0.14), dist: 0.14, focus: new THREE.Vector3(0, 0.006, 0.0), fov: 28, ap: 22 },
  };
  let camMode = VIEWS[opts.camera] ? opts.camera : 'auto';
  let camBlend = 0;
  const view = { target: new THREE.Vector3(), dir: new THREE.Vector3(), focus: new THREE.Vector3(), dist: 0, fov: 28, ap: 16 };
  function blendView() {
    let a = VIEWS.hero, b = VIEWS.mid, k = smooth(0, 1, camBlend);
    if (camMode !== 'auto') { a = b = VIEWS[camMode]; k = 0; }
    view.target.lerpVectors(a.target, b.target, k); view.dir.lerpVectors(a.dir, b.dir, k); view.focus.lerpVectors(a.focus, b.focus, k);
    view.dist = a.dist + (b.dist - a.dist) * k; view.fov = a.fov + (b.fov - a.fov) * k; view.ap = a.ap + (b.ap - a.ap) * k;
  }
  blendView();

  const post = new THREE.ShaderMaterial({
    vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false,
    uniforms: {
      tColor: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: camera.near }, uFar: { value: camera.far }, uFocus: { value: 0.5 }, uAperture: { value: 10 }, uMaxR: { value: 14 },
      uExposure: { value: 1.05 }, uTime: { value: 0 }, uVig: { value: 0.62 },
    },
  });
  const postScene = new THREE.Scene();
  const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const postMesh = new THREE.Mesh(tri, post); postMesh.frustumCulled = false; postScene.add(postMesh);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let rt = null;

  function resize() {
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const W = Math.floor(w * dpr), H = Math.floor(h * dpr);
    if (rt) rt.dispose();
    rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
    rt.depthTexture = new THREE.DepthTexture(W, H, THREE.FloatType);
    post.uniforms.tColor.value = rt.texture; post.uniforms.tDepth.value = rt.depthTexture;
    post.uniforms.uRes.value.set(W, H);
    post.uniforms.uMaxR.value = 13 * dpr * Math.min(1.4, Math.max(0.6, w / 1200));
    applyView();
  }
  let parX = 0, parY = 0, parTX = 0, parTY = 0;
  const _v = new THREE.Vector3(), _t = new THREE.Vector3();
  function applyView(time = 0) {
    blendView();
    const aspect = camera.aspect;
    let dist = view.dist * (aspect < 1.25 ? Math.min(1.9, 1.25 / aspect * 0.92 + 0.08) : 1);
    const d = _v.copy(view.dir).normalize();
    const tgt = _t.copy(view.target); if (aspect < 1) tgt.y -= (1 - aspect) * 0.1 * (view.dist / 0.5);
    // slow drift + pointer parallax, tiny
    const yaw = parX * 0.05 + Math.sin(time * 0.21) * 0.012, pitch = parY * 0.03 + Math.sin(time * 0.17) * 0.006;
    d.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw); d.y += pitch; d.normalize();
    camera.fov = view.fov; camera.position.copy(tgt).addScaledVector(d, dist);
    camera.lookAt(tgt); camera.updateProjectionMatrix();
    post.uniforms.uFocus.value = camera.position.distanceTo(view.focus);
    post.uniforms.uAperture.value = view.ap * opts.aperture * (renderer.getPixelRatio()) * (el.clientWidth / 1200);
  }

  // ---------------- per-frame pose
  const pts = []; for (let i = 0; i < 260; i++) pts.push(new THREE.Vector3());
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  const _m4 = new THREE.Matrix4();
  let Tcur = T_START, timeSec = 0;

  function pose(T, time) {
    const n = Math.floor(T), ph = T - n;
    const off = stripOffset(T);
    strip.position.z = -off;
    const zN = needleZ(ph), ty = tipY(ph);
    needleBar.position.set(0, ty + 0.0395, zN);
    // holes punched so far: hole k is punched at T = k + FEED_A - 0.02 (tip passes leather top)
    const holeMax = Math.floor(T - (FEED_A - 0.015));
    holeUniforms.uHoleMax.value = holeMax;
    // stitch k (hole k-1 -> k) is fully tight once take-up passes its top for cycle k
    const tightK = Math.floor(T - 0.88);
    stitches.count = Math.max(0, Math.min(MAXS, tightK + 1));
    holeUniforms.uStitchMax.value = tightK;
    // forming stitch: between hole n-1 and n, visible while it is being pulled down (cycle n, ph 0.62..0.88)
    const fk = (ph >= 0.88) ? -999 : (holeMax >= n ? n : -999);
    if (fk > -999 && ph > 0.55) {
      const pull = smooth(0.6, 0.88, ph);
      stitches.getMatrixAt(Math.min(MAXS - 1, Math.max(0, fk)), _m4);
      forming.matrix.copy(_m4); forming.matrixAutoUpdate = false;
      forming.matrix.multiply(new THREE.Matrix4().makeTranslation(0, YL * (1 - pull) * 0.0, 0));
      forming.matrix.multiply(new THREE.Matrix4().makeScale(1, 1 + (1 - pull) * 1.8, 1));
      forming.visible = true;
    } else forming.visible = false;

    // feet
    const il = innerFootLift(ph), ol = outerFootLift(ph);
    innerFoot.position.set(0, YL + il, zN * 0.9);
    outerFoot.position.set(0, YL + ol, 0);
    // take-up lever: rotate about its pivot so the eye travels on an arc
    const ey = takeUpY(ph);
    const ang = Math.asin(Math.max(-0.95, Math.min(0.95, (ey - TU_PY) / (TU_L + 0.0005))));
    lever.rotation.z = -ang;

    // ---- thread path
    const eyeX = TU_PX - Math.cos(ang) * (TU_L + 0.0005), eyeY = TU_PY + Math.sin(ang) * (TU_L + 0.0005);
    const tipYw = ty, eyeYw = tipYw + 0.0026;
    const lastHole = Math.max(holeMax >= n ? n - 1 : holeMax, -5);
    // the thread leaves the leather at the last finished hole (or the needle when it is down in the leather)
    const lhZ = HOLE_Z0 + lastHole * PITCH - off;
    const wob = (k) => 0.00035 * Math.sin(time * 37 + k * 1.7) * (1.25 - smooth(0.7, 0.95, ph));
    const anchors = [
      P(-0.012, 0.34, 0.020), P(-0.024, 0.236, FZ + 0.004), P(TS_X - 0.0062, TS_Y + 0.006, FZ + 0.0051),
      P(TS_X - 0.0021, TS_Y - 0.0012, FZ + 0.0051), P(TS_X + 0.0006, TS_Y - 0.0021, FZ + 0.0051), P(TS_X + 0.0045, TS_Y - 0.004, FZ + 0.0049),
      P(eyeX, eyeY, FZ + 0.0049), P(-0.024, 0.116, FZ + 0.004),
      P(-0.009, HEAD_Y0 + 0.004, 0.012), P(0.0, ty + 0.0395 + 0.006, zN + 0.0062), P(0.0, eyeYw + 0.006, zN + 0.0007),
      P(0.0, eyeYw, zN + 0.0006),
    ];
    const below = eyeYw < YL + 0.0002;
    if (below) { anchors.push(P(0.0, YL + 0.0002, zN + 0.0004)); }
    // last hole: thread rises out of the far end of the slit
    anchors.push(P(SEAM_X + 0.42 * MM, YL + 0.0002, lhZ + 0.25 * MM - (below ? 0 : 0)));
    // build polyline with wobble on the long spans and a slack sag on the last span
    let c = 0;
    const lens = [];
    for (let i = 0; i < anchors.length - 1; i++) lens.push(anchors[i].distanceTo(anchors[i + 1]));
    const total = lens.reduce((a, b) => a + b, 0);
    const slack = 1 - smooth(0.62, 0.9, ph) * 1.0;
    for (let i = 0; i < anchors.length - 1 && c < 258; i++) {
      const A = anchors[i], B = anchors[i + 1];
      const segs = Math.max(2, Math.min(60, Math.round(lens[i] / total * 230)));
      const lastSpan = i === anchors.length - 2;
      for (let s = 0; s < segs && c < 258; s++) {
        const t = s / segs;
        const p = pts[c++].lerpVectors(A, B, t);
        const env = Math.sin(Math.PI * t);
        if (lens[i] > 0.02) { p.x += wob(i * 3.1 + t * 9) * env; p.z += wob(i * 5.3 + t * 7 + 2) * env * 0.7; }
        if (lastSpan && !below) { p.y += env * slack * 0.0012; p.x -= env * slack * 0.0006; }
        if (i === 6 && slack > 0) { p.x -= env * 0.0015 * slack; }
      }
    }
    pts[c++].copy(anchors[anchors.length - 1]);
    live.update(pts.slice(0, c));
  }

  // ---------------- drive: scroll, idle, tap
  const state = { inView: true, running: !reduce, seekMode: false, burst: 0, idleExtra: 0, scrollMax: 0 };
  function rawProgress() {
    const r = el.getBoundingClientRect(), vh = window.innerHeight || 800;
    return Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height)));
  }
  // if the element is already on screen when mounted (a hero), the scroll range starts from where it is now
  const p0 = rawProgress() > 0 && rawProgress() < 1 ? rawProgress() : 0;
  function scrollProgress() { return Math.min(1, Math.max(0, (rawProgress() - p0) / (1 - p0))); }
  function targetT() {
    let t = T_START;
    // the machine never runs backwards: scrolling back up leaves the seam as it is
    if (opts.scrollLinked) { state.scrollMax = Math.max(state.scrollMax, scrollProgress()); t += state.scrollMax * (T_SCROLL_END - T_START); }
    return Math.min(T_MAX, t + state.idleExtra);
  }
  const onTap = () => { if (!reduce) { state.burst = 1.0; state.seekMode = false; } };
  canvas.addEventListener('pointerdown', onTap);
  const onMove = (e) => { const r = el.getBoundingClientRect(); parTX = ((e.clientX - r.left) / r.width - 0.5) * 2; parTY = ((e.clientY - r.top) / r.height - 0.5) * 2; };
  el.addEventListener('pointermove', onMove);

  let raf = 0, lastNow = performance.now(), vel = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
    timeSec += dt;
    if (!state.seekMode) {
      // idle: slow running; tap: one second at full speed (ramped)
      const burstRate = state.burst > 0 ? 13 * Math.sin(Math.PI * Math.min(1, (1 - state.burst) * 1.0 + 0.08)) : 0;
      state.burst = Math.max(0, state.burst - dt);
      if (Tcur < T_MAX - 0.5) state.idleExtra += dt * (0.55 + burstRate);
      const goal = targetT();
      // critically damped follow with a speed cap (machine has weight)
      const k = 9, d = goal - Tcur;
      vel += (k * k * d - 2 * k * vel) * dt;
      vel = Math.max(-16, Math.min(16, vel));
      Tcur += vel * dt;
      if (Tcur > T_MAX) { Tcur = T_MAX; vel = 0; }
      if (Tcur < T_START - 0.2) { Tcur = T_START - 0.2; vel = 0; }
    }
    if (camMode === 'auto') { const goalB = opts.scrollLinked ? scrollProgress() : 0; camBlend += (goalB - camBlend) * Math.min(1, dt * 4); }
    parX += (parTX - parX) * Math.min(1, dt * 2); parY += (parTY - parY) * Math.min(1, dt * 2);
    applyView(timeSec);
    pose(Tcur, timeSec);
    render();
    if (state.running && state.inView && !state.seekMode) raf = requestAnimationFrame(frame);
  }
  function render() {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    post.uniforms.uTime.value = timeSec;
    renderer.render(postScene, postCam);
  }
  function kick() { if (!raf && state.running && state.inView && !state.seekMode) { lastNow = performance.now(); raf = requestAnimationFrame(frame); } }

  const io = new IntersectionObserver((es) => { for (const e of es) { state.inView = e.isIntersecting; } if (state.inView) kick(); }, { rootMargin: '100px' });
  io.observe(el);
  const ro = new ResizeObserver(() => { resize(); if (!raf) { pose(Tcur, timeSec); render(); } });
  ro.observe(el);
  resize();

  // first frame once textures are in
  const ready = new Promise((res) => {
    const check = () => {
      const all = [wearTex, woodA, woodN, woodR, leatherMaps.a, leatherMaps.n, leatherMaps.r];
      if (all.every(t => t.image && t.image.complete !== false && t.image.width)) res(); else setTimeout(check, 50);
    };
    check();
  }).then(() => {
    renderer.compile(scene, camera);
    // reduced motion: a still of a nearly finished seam (same frame as fallback.webp)
    if (reduce) { Tcur = T_START + (T_SCROLL_END - T_START) * 0.9; camBlend = 0.9; applyView(0); }
    pose(Tcur, 0); render();
    el.classList.add('is-ready');
    kick();
  });

  const api = {
    ready,
    // t in [0,1] across the scroll range. Fractional cycles are kept: needle down = x.5 of a stitch.
    seek(t, o = {}) {
      state.seekMode = true;
      if (o.camera) camMode = VIEWS[o.camera] ? o.camera : 'auto';
      camBlend = Math.max(0, Math.min(1, typeof o.T === 'number' ? (o.T - T_START) / (T_SCROLL_END - T_START) : t));
      Tcur = typeof o.T === 'number' ? o.T : T_START + Math.max(0, Math.min(1, t)) * (T_SCROLL_END - T_START);
      vel = 0;
      return ready.then(() => { applyView(o.time || 0); pose(Tcur, o.time || 0); render(); return Tcur; });
    },
    play() { state.seekMode = false; state.idleExtra = Math.max(0, Tcur - T_START - (opts.scrollLinked ? state.scrollMax * (T_SCROLL_END - T_START) : 0)); kick(); },
    tap: onTap,
    camera(name) { camMode = VIEWS[name] ? name : 'auto'; applyView(timeSec); if (!raf) { pose(Tcur, timeSec); render(); } },
    destroy() {
      cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      canvas.removeEventListener('pointerdown', onTap); el.removeEventListener('pointermove', onMove);
      renderer.dispose(); rt && rt.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
    _three: { THREE, scene, camera, renderer, post, render: () => render(), key, info: () => ({ T: Tcur, blend: camBlend, inView: state.inView, idle: state.idleExtra, raf: !!raf }) },
  };
  return api;
}
