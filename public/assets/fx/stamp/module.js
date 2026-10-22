/*
 * LG stamp: a brass die on a press arm comes down onto leather and presses the mark in.
 * WebGL (three.js r169, vendored). API: window.LGFx.stamp.mount(el, opts), .seek(t)
 * See README.md in this folder.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const BASE = new URL('./', import.meta.url).href;

// World units: 1 = 10 cm
const LW = 2.4, LH = 1.5;           // leather piece
const LT = 0.032;                   // leather thickness (3.2 mm)
const RH = 0.011;                   // die relief height (1.1 mm)
const PEN = 0.006;                  // how far the relief sinks into the leather
const REST = 0.46;                  // die relief bottom above the leather at rest
const P = 2000;                     // die mask pixels per unit
const ACC_W = 2048, ACC_H = Math.round(2048 * LH / LW);
const RECOVER = 0.88;               // leather springs back a little after the lift

const LEATHERS = {
  vegtan: { albedo: 'vegtan-albedo.webp', normal: 'vegtan-normal.webp', ox: 0, normalScale: 1.0,
    edge: '#8f6a4c', edgeRough: 0.85, burnish: [0.80, 0.70, 0.62], heat: [0.05, 0.022, 0.012], tint: '#ffffff' },
  oxblood: { albedo: 'oxblood-albedo.webp', normal: 'oxblood-normal.webp', ox: 1, normalScale: 0.8,
    edge: '#3a1012', edgeRough: 0.35, burnish: [0.62, 0.56, 0.56], heat: [0.03, 0.01, 0.008], tint: '#ffffff' },
};
const FINISHES = ['blind', 'foil', 'heat'];

/* ------------------------------------------------------------------ helpers */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t, s = 1.2) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

const texLoader = new THREE.TextureLoader();
function loadTex(name, srgb, repeat) {
  return new Promise((res, rej) => {
    texLoader.load(BASE + 'tex/' + name, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = 8;
      res(t);
    }, undefined, rej);
  });
}

/* ------------------------------------------------------------------ die artwork */
let logoInfo = null;
async function getLogo() {
  if (logoInfo) return logoInfo;
  const txt = await (await fetch(BASE + 'logo.svg')).text();
  const d = txt.match(/\sd="([^"]+)"/)[1];
  const path = new Path2D(d);
  // measure the wordmark (everything right of the mark) once
  const s = 2, c = document.createElement('canvas');
  c.width = Math.ceil(566 * s); c.height = Math.ceil(74 * s);
  const x = c.getContext('2d');
  x.setTransform(s, 0, 0, s, 1.05 * s, 1.05 * s); x.fill(path);
  const data = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  const split = Math.round((88.9 + 3) * s);
  for (let yy = 0; yy < c.height; yy++) for (let xx = split; xx < c.width; xx++) {
    if (data[(yy * c.width + xx) * 4 + 3] > 40) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  }
  logoInfo = { path, word: { x: x0 / s - 1.05, y: y0 / s - 1.05, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s } };
  return logoInfo;
}

const FONT_STACK = '"Alfa Slab One", "Rockwell Extra Bold", Rockwell, "Bitter", Georgia, serif';

/** Build the die artwork as it reads in the leather (white on transparent). */
async function makeArtwork(text) {
  let fw, fd, draw;
  if (!text) {
    const L = await getLogo();
    const markH = 0.165, wordW = 0.50;
    const wordH = wordW * L.word.h / L.word.w;
    fw = 0.60; fd = 0.04 + markH + 0.032 + wordH + 0.042;
    draw = (ctx) => {
      ctx.fillStyle = '#fff';
      // mark: logo viewBox x -1.05..87.85, y -1.05..71.18
      const ms = markH * P / 72.23;
      ctx.save();
      ctx.translate(fw * P / 2 - 88.9 * ms / 2, 0.04 * P);
      ctx.scale(ms, ms); ctx.translate(1.05, 1.05);
      ctx.beginPath(); ctx.rect(-1.1, -1.1, 89.95, 73); ctx.clip();
      ctx.fill(L.path);
      ctx.restore();
      // wordmark
      const ws = wordW * P / L.word.w;
      ctx.save();
      ctx.translate(fw * P / 2 - wordW * P / 2, (0.04 + markH + 0.032) * P);
      ctx.scale(ws, ws); ctx.translate(-L.word.x, -L.word.y);
      ctx.beginPath(); ctx.rect(L.word.x - 1, L.word.y - 1, L.word.w + 2, L.word.h + 2); ctx.clip();
      ctx.fill(L.path);
      ctx.restore();
    };
  } else {
    try { await document.fonts.load('200px "Alfa Slab One"', text); } catch (e) { /* fallback font */ }
    const m = document.createElement('canvas').getContext('2d');
    let fs = 0.125 * P;
    m.font = `${fs}px ${FONT_STACK}`;
    let tw = m.measureText(text).width / P;
    const maxText = 1.36;
    if (tw > maxText) { fs *= maxText / tw; tw = maxText; }
    fd = 0.25; fw = Math.max(0.42, tw + 0.16);
    draw = (ctx) => {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff';
      // double rule frame
      const rr = (inset, lw, r) => {
        ctx.lineWidth = lw * P; const i = inset * P, w = fw * P - 2 * i, h = fd * P - 2 * i;
        ctx.beginPath(); ctx.roundRect(i, i, w, h, r * P); ctx.stroke();
      };
      rr(0.016, 0.007, 0.022);
      rr(0.032, 0.0028, 0.012);
      ctx.font = `${fs}px ${FONT_STACK}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const mt = ctx.measureText(text);
      const asc = mt.actualBoundingBoxAscent, desc = mt.actualBoundingBoxDescent;
      ctx.fillText(text, fw * P / 2, fd * P / 2 + (asc - desc) / 2);
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(fw * P); canvas.height = Math.round(fd * P);
  const ctx = canvas.getContext('2d');
  draw(ctx);
  return { canvas, fw, fd, text: text || null };
}

/* ------------------------------------------------------------------ shaders */
const LEATHER_PARS = /* glsl */`
uniform sampler2D uAcc; uniform sampler2D uDie; uniform sampler2D uRough; uniform sampler2D uFoilN;
uniform vec2 uCurC; uniform vec2 uCurS; uniform float uCurDepth; uniform float uCurFoil; uniform float uCurHeat;
uniform vec2 uAccTexel; uniform float uOx; uniform float uDieLod; uniform float uSlope;
uniform vec3 uBurnish; uniform vec3 uHeatCol;
float stInside(vec2 d){ return step(0.0, d.x) * step(0.0, d.y) * step(d.x, 1.0) * step(d.y, 1.0); }
vec3 stampAt(vec2 uv){
  vec3 a = texture2D(uAcc, uv).rgb; a.r *= ${RECOVER.toFixed(3)};
  vec2 d = (uv - uCurC) / (2.0 * uCurS) + 0.5;
  float m = texture2D(uDie, clamp(d, 0.0, 1.0)).a * stInside(d);
  return vec3(max(a.r, m * uCurDepth), max(a.g, m * uCurFoil), max(a.b, m * uCurHeat));
}
vec3 stampBlur(vec2 uv, float lod){
  vec3 a = textureLod(uAcc, uv, lod).rgb; a.r *= ${RECOVER.toFixed(3)};
  vec2 d = (uv - uCurC) / (2.0 * uCurS) + 0.5;
  float m = textureLod(uDie, clamp(d, 0.0, 1.0), lod + uDieLod).a * stInside(d);
  return vec3(max(a.r, m * uCurDepth), max(a.g, m * uCurFoil), max(a.b, m * uCurHeat));
}
float stIns; float stFoil; float stHeat; vec2 stGrad; float stCav;
`;

const LEATHER_MAP = /* glsl */`
#include <map_fragment>
{
  vec2 suv = vUv;
  vec3 S = stampAt(suv);
  vec2 e = uAccTexel * 0.9;
  float hx = stampAt(suv + vec2(e.x, 0.0)).r - stampAt(suv - vec2(e.x, 0.0)).r;
  float hy = stampAt(suv + vec2(0.0, e.y)).r - stampAt(suv - vec2(0.0, e.y)).r;
  vec2 e2 = uAccTexel * 2.2;
  hx += 0.8 * (stampBlur(suv + vec2(e2.x, 0.0), 1.0).r - stampBlur(suv - vec2(e2.x, 0.0), 1.0).r);
  hy += 0.8 * (stampBlur(suv + vec2(0.0, e2.y), 1.0).r - stampBlur(suv - vec2(0.0, e2.y), 1.0).r);
  vec3 B1 = stampBlur(suv, 1.6);
  vec3 B2 = stampBlur(suv, 3.2);
  stIns = clamp(S.r, 0.0, 1.0);
  stGrad = vec2(hx, hy);
  // cavity: inside, close to the walls the floor sits in the wall's shade
  stCav = clamp((S.r - B1.r) * 1.4 + (S.r - B2.r) * 0.6, 0.0, 1.0);
  float shoulder = clamp((B1.r - S.r) * 1.5, 0.0, 1.0);
  vec3 col = diffuseColor.rgb;
  vec2 ed = min(suv, 1.0 - suv) * vec2(${LW.toFixed(2)}, ${LH.toFixed(2)});
  col *= 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.16, min(ed.x, ed.y)));
  col *= mix(vec3(1.0), uBurnish, stIns);
  col *= 1.0 - 0.5 * stCav;
  col *= 1.0 + 0.05 * shoulder;
  // heat: dark, slightly scorched halo
  stHeat = S.b;
  float lum = dot(diffuseColor.rgb, vec3(0.33));
  col = mix(col, uHeatCol * (0.75 + 0.9 * lum), clamp(stHeat * 0.95, 0.0, 1.0));
  col *= 1.0 - 0.55 * clamp(B2.b * 1.3 - S.b * 0.5, 0.0, 1.0);
  // foil: ragged where it tore off the carrier
  float fn = texture2D(uFoilN, suv * vec2(24.0, 15.0)).r;
  float fn2 = texture2D(uFoilN, suv * vec2(71.0, 44.0)).g;
  stFoil = smoothstep(0.42, 0.62, S.g * (0.82 + 0.3 * fn2) + (fn - 0.5) * 0.25);
  vec3 gold = vec3(1.0, 0.79, 0.38) * (0.9 + 0.2 * fn2);
  col = mix(col, gold, stFoil);
  diffuseColor.rgb = col;
}
`;

const LEATHER_ROUGH = /* glsl */`
float roughnessFactor = roughness;
{
  vec2 rr = texture2D(uRough, vMapUv).rg;
  float r = mix(rr.r, rr.g, uOx);
  r = mix(r, r * 0.55, stIns);
  r = mix(r, 0.42, stHeat * 0.8);
  r = mix(r, 0.3 + 0.12 * texture2D(uFoilN, vUv * 40.0).b, stFoil);
  roughnessFactor *= r;
}
`;
const LEATHER_METAL = /* glsl */`
float metalnessFactor = mix(metalness, 1.0, stFoil);
`;
const LEATHER_NORMAL = /* glsl */`
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale * (1.0 - 0.72 * stIns) * (1.0 - 0.6 * stFoil);
  mapN.xy += (texture2D(uFoilN, vUv * vec2(18.0, 11.0)).xy * 2.0 - 1.0) * 0.25 * stFoil;
  mapN.xy += stGrad * uSlope;
  normal = normalize( tbn * mapN );
#else
  #include <normal_fragment_maps>
#endif
`;

const FOIL_PARS = /* glsl */`
uniform sampler2D uDie; uniform float uHole; uniform vec2 uHoleScale; uniform float uFade; uniform sampler2D uFoilN2;
`;
const FOIL_ALPHA = /* glsl */`
#include <alphamap_fragment>
{
  vec2 d = (vUv - 0.5) * uHoleScale + 0.5;
  float inside = step(0.0, d.x) * step(0.0, d.y) * step(d.x, 1.0) * step(d.y, 1.0);
  float m = texture2D(uDie, clamp(d, 0.0, 1.0)).a * inside;
  float n = texture2D(uFoilN2, vUv * vec2(9.0, 7.0)).r;
  float hole = smoothstep(0.4, 0.6, m + (n - 0.5) * 0.3) * uHole;
  diffuseColor.a *= (1.0 - hole) * uFade;
}
`;

/* ------------------------------------------------------------------ post: depth of field, grain */
const POST_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar;
uniform float uFocus; uniform float uAperture; uniform float uMaxR; uniform float uSeed;
varying vec2 vUv;
float linZ(vec2 uv){ float d = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - d * (uFar - uNear)); }
float cocOf(float z){ return clamp(abs(z - uFocus) / z * uAperture, 0.0, 1.0) * uMaxR; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453); }
void main(){
  float zc = linZ(vUv); float rc = cocOf(zc);
  vec3 acc = texture2D(tColor, vUv).rgb; float ws = 1.0;
  if (rc > 0.35) {
    for (int i = 0; i < 28; i++) {
      float fi = float(i) + 0.5;
      float rr = sqrt(fi / 28.0) * rc;
      float a = fi * 2.39996;
      vec2 o = vec2(cos(a), sin(a)) * rr / uRes;
      float zs = linZ(vUv + o); float cs = cocOf(zs);
      float w = smoothstep(rr - 1.0, rr + 1.0, zs > zc ? min(cs, rc) : cs);
      acc += texture2D(tColor, vUv + o).rgb * w; ws += w;
    }
  }
  gl_FragColor = vec4(acc / ws, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (hash(vUv * uRes) - 0.5) * 0.018;
}`;

/* ------------------------------------------------------------------ studio light environment */
function studioScene() {
  const sc = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.075, 0.068, 0.06), side: THREE.BackSide }));
  room.position.y = 4; sc.add(room);
  const fc = document.createElement('canvas'); fc.width = fc.height = 256;
  const fx = fc.getContext('2d');
  const gr = fx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgb(205,160,118)'); gr.addColorStop(0.09, 'rgb(190,148,108)'); gr.addColorStop(0.16, 'rgb(40,36,33)'); gr.addColorStop(1, 'rgb(14,12,11)');
  fx.fillStyle = gr; fx.fillRect(0, 0, 256, 256);
  const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ map: ft, color: new THREE.Color(0.9, 0.9, 0.9) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.6; sc.add(floor);
  const panel = (w, h, k, tint, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(...tint).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); sc.add(m);
  };
  panel(5, 3.2, 5, [1, 0.96, 0.9], [-1.5, 6, -1.2], [0, 0, 0]);      // overhead softbox, back left
  panel(1.1, 6, 6, [1, 0.97, 0.92], [-7, 2.5, 1.5], [0, 1, 0]);     // tall strip, left
  panel(3.5, 2.5, 2.2, [0.92, 0.95, 1], [6, 2.8, 4.5], [0, 0.5, 0]); // fill, front right
  panel(8, 1.0, 3.5, [1, 0.94, 0.86], [0, 3.2, -8], [0, 0.6, 0]);    // rim strip behind
  panel(9, 3.0, 2.6, [1, 0.93, 0.84], [-1, 1.2, 8], [0, 0.4, 0]);      // big bounce card in front
  panel(2.5, 4, 4, [1, 0.97, 0.94], [5.5, 3, -2], [0, 0.5, 0]);       // kicker, back right
  return sc;
}

/* ------------------------------------------------------------------ geometry */
function chamferRectShape(w, h, c) {
  const s = new THREE.Shape();
  const x = w / 2, y = h / 2;
  s.moveTo(-x + c, -y); s.lineTo(x - c, -y); s.lineTo(x, -y + c); s.lineTo(x, y - c);
  s.lineTo(x - c, y); s.lineTo(-x + c, y); s.lineTo(-x, y - c); s.lineTo(-x, -y + c); s.closePath();
  return s;
}
function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Relief heights sampled from the artwork, on a grid. */
function sampleArtwork(art, nx, nz) {
  const c = document.createElement('canvas');
  c.width = nx; c.height = nz;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(art.canvas, 0, 0, nx, nz);
  const d = x.getImageData(0, 0, nx, nz).data;
  const a = new Float32Array(nx * nz);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  // slight draft on the walls (3x3 soften)
  const b = new Float32Array(a.length);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const w = (di === 0 && dj === 0) ? 2 : 1;
      s += a[jj * nx + ii] * w; n += w;
    }
    b[j * nx + i] = s / n;
  }
  return b;
}

/* ------------------------------------------------------------------ instance */
class StampFx {
  constructor(el, opts) {
    this.el = el;
    this.opts = Object.assign({ leather: 'vegtan', finish: 'blind', text: null, autoplay: true }, opts || {});
    if (!LEATHERS[this.opts.leather]) this.opts.leather = 'vegtan';
    if (!FINISHES.includes(this.opts.finish)) this.opts.finish = 'blind';
    this.reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.visible = false;
    this.playing = false;
    this.job = null;
    this.queue = null;
    this.stamps = [];            // committed stamp centres (leather local x,z)
    this.offset = new THREE.Vector2(0, 0);
    el.classList.add('lgfx-stamp');
    this.ready = this._init().catch(err => { console.warn('[LGFx.stamp] falling back to still image', err); this._fallback(); });
  }

  _fallback() {
    this.failed = true;
    if (this.renderer) { try { this.renderer.dispose(); } catch (e) {} }
    this.el.querySelectorAll('canvas').forEach(c => c.remove());
    if (!this.el.querySelector('.lgfx-stamp__fallback')) {
      const img = document.createElement('img');
      img.className = 'lgfx-stamp__fallback';
      img.alt = 'A brass die has pressed the Leather Genius mark into ' + (this.opts.leather === 'oxblood' ? 'oxblood' : 'natural veg-tan') + ' leather.';
      img.src = BASE + 'fallback-' + this.opts.leather + '.webp';
      this.el.appendChild(img);
    }
  }

  async _init() {
    const el = this.el;
    const canvas = document.createElement('canvas');
    canvas.className = 'lgfx-stamp__canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'A brass die on a press arm stamps the Leather Genius mark into leather. Click the leather to stamp it again.');
    el.appendChild(canvas);
    const vig = document.createElement('div'); vig.className = 'lgfx-stamp__vignette'; el.appendChild(vig);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { throw e; }
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.rt.depthTexture = new THREE.DepthTexture(4, 4);
    this.rt.depthTexture.type = THREE.FloatType;
    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false, toneMapped: true,
      uniforms: { tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, uRes: { value: new THREE.Vector2(4, 4) },
        uNear: { value: 0.1 }, uFar: { value: 60 }, uFocus: { value: 4 }, uAperture: { value: 2.0 }, uMaxR: { value: 9 }, uSeed: { value: 0 } },
    });
    this.postScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post); quad.frustumCulled = false;
    this.postScene.add(quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#0e0c0b');
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(studioScene(), 0.02).texture;
    scene.environmentIntensity = 1.0;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(24, 1.6, 0.1, 60);

    // lights: a raking key from back left so the walls of the impression read
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(-3.2, 3.6, -2.0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const sc = key.shadow.camera; sc.left = -2.2; sc.right = 2.2; sc.top = 2.2; sc.bottom = -2.2; sc.near = 0.5; sc.far = 12;
    key.shadow.bias = -0.0002; key.shadow.radius = 10; key.shadow.blurSamples = 16;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.55);
    fill.position.set(3, 2.5, 3.5); scene.add(fill);
    this.key = key;

    // textures
    const R = [LW, LH];
    this.leatherTex = {};
    const [, lRough, grA, grR, brass, foilN] = await Promise.all([
      this._loadLeather(this.opts.leather),
      loadTex('leather-rough.webp', false), loadTex('granite-albedo.webp', true, [26, 26]), loadTex('granite-rough.webp', false, [26, 26]),
      loadTex('brass-rough.webp', false, [2, 2]), loadTex('foil-normal.webp', false),
    ]);
    this.tex = { lRough, brass, foilN };

    // bench: honed granite
    const bench = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ map: grA, roughnessMap: grR, roughness: 1, metalness: 0 }));
    bench.rotation.x = -Math.PI / 2; bench.receiveShadow = true;
    scene.add(bench);

    // accumulated impressions (R depth, G foil, B heat)
    const acc = document.createElement('canvas'); acc.width = ACC_W; acc.height = ACC_H;
    this.accCtx = acc.getContext('2d');
    this.accCtx.fillStyle = '#000'; this.accCtx.fillRect(0, 0, ACC_W, ACC_H);
    this.accTex = new THREE.CanvasTexture(acc);
    this.accTex.colorSpace = THREE.NoColorSpace;
    this.accTex.minFilter = THREE.LinearMipmapLinearFilter;

    // leather piece
    this.leather = new THREE.Group(); scene.add(this.leather);
    const shape = roundRectShape(LW, LH, 0.07);
    const body = new THREE.ExtrudeGeometry(shape, { depth: LT, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.005, bevelSegments: 3, curveSegments: 10 });
    body.rotateX(-Math.PI / 2);
    body.computeBoundingBox();
    body.translate(0, -body.boundingBox.min.y, 0);
    const top = body.boundingBox.max.y - body.boundingBox.min.y;
    this.surfaceY = top;
    this.edgeMat = new THREE.MeshStandardMaterial({ color: '#a87c55', roughness: 0.9 });
    const bodyMesh = new THREE.Mesh(body, [new THREE.MeshBasicMaterial({ visible: false }), this.edgeMat]);
    bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
    this.leather.add(bodyMesh);

    const cs = document.createElement('canvas'); cs.width = 256; cs.height = 160;
    const cx = cs.getContext('2d'); cx.filter = 'blur(7px)'; cx.fillStyle = '#000'; cx.fillRect(24, 22, 208, 116);
    const csTex = new THREE.CanvasTexture(cs);
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(LW * 256 / 208, LH * 160 / 116),
      new THREE.MeshBasicMaterial({ map: csTex, transparent: true, opacity: 0.55, depthWrite: false, color: '#000' }));
    contact.rotation.x = -Math.PI / 2; contact.position.y = 0.0008; this.leather.add(contact);
    csTex.colorSpace = THREE.SRGBColorSpace;

    const topGeo = new THREE.ShapeGeometry(shape, 16);
    const uv = topGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / LW + 0.5, uv.getY(i) / LH + 0.5);
    topGeo.rotateX(-Math.PI / 2);
    topGeo.translate(0, top + 0.0002, 0);
    const lm = this.leatherMat = new THREE.MeshStandardMaterial({ map: this.leatherTex[this.opts.leather].a, normalMap: this.leatherTex[this.opts.leather].n, roughness: 1, metalness: 0 });
    lm.defines = { USE_UV: '' };
    this.lu = {
      uAcc: { value: this.accTex }, uDie: { value: null }, uRough: { value: lRough }, uFoilN: { value: foilN },
      uCurC: { value: new THREE.Vector2(0.5, 0.5) }, uCurS: { value: new THREE.Vector2(0.1, 0.1) },
      uCurDepth: { value: 0 }, uCurFoil: { value: 0 }, uCurHeat: { value: 0 },
      uAccTexel: { value: new THREE.Vector2(1 / ACC_W, 1 / ACC_H) }, uOx: { value: 0 },
      uDieLod: { value: Math.log2(P / (ACC_W / LW)) }, uSlope: { value: 3.2 },
      uBurnish: { value: new THREE.Vector3(1, 1, 1) }, uHeatCol: { value: new THREE.Vector3(0.1, 0.05, 0.03) },
    };
    lm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.lu);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + LEATHER_PARS)
        .replace('#include <map_fragment>', LEATHER_MAP)
        .replace('#include <roughnessmap_fragment>', LEATHER_ROUGH)
        .replace('#include <metalnessmap_fragment>', LEATHER_METAL)
        .replace('#include <normal_fragment_maps>', LEATHER_NORMAL);
    };
    const topMesh = this.topMesh = new THREE.Mesh(topGeo, lm);
    topMesh.receiveShadow = true;
    this.leather.add(topMesh);

    // brass, steel
    this.brassMat = new THREE.MeshPhysicalMaterial({ color: '#e2bf7a', metalness: 1, roughness: 1, roughnessMap: brass, bumpMap: brass, bumpScale: 0.6 });
    this.reliefMat = new THREE.MeshPhysicalMaterial({ color: '#e6c482', metalness: 1, roughness: 0.75, roughnessMap: brass, vertexColors: true });
    this.steelMat = new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.9, roughnessMap: brass });
    this.chromeMat = new THREE.MeshStandardMaterial({ color: '#e4e6ea', metalness: 1, roughness: 0.12 });
    this.blackMat = new THREE.MeshStandardMaterial({ color: '#1b1b1d', metalness: 0.9, roughness: 0.35 });
    this.anodMat = new THREE.MeshStandardMaterial({ color: '#2a2b2e', metalness: 0.7, roughness: 0.42, roughnessMap: brass });

    this.press = new THREE.Group(); scene.add(this.press);

    // foil carrier sheet
    const foilMat = this.foilMat = new THREE.MeshStandardMaterial({ color: '#f6d27e', metalness: 1, roughness: 0.3, normalMap: foilN, normalScale: new THREE.Vector2(0.8, 0.8), transparent: true, side: THREE.DoubleSide, depthWrite: true });
    foilMat.defines = { USE_UV: '' };
    this.fu = { uDie: { value: null }, uHole: { value: 0 }, uHoleScale: { value: new THREE.Vector2(1, 1) }, uFade: { value: 1 }, uFoilN2: { value: foilN } };
    foilMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.fu);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FOIL_PARS)
        .replace('#include <alphamap_fragment>', FOIL_ALPHA);
    };
    this.foil = null;

    this.setLeather(this.opts.leather, true);

    this.art = await makeArtwork(this.opts.text);
    this._buildDie(this.art);
    this.dieArt = this.art;

    // initial job: centre-left of the piece
    this._newJob({ x: -0.28, z: 0.02, finish: this.opts.finish, art: this.art, immediate: true });

    // sizing + observers
    this._resize = this._resize.bind(this);
    this.ro = new ResizeObserver(this._resize); this.ro.observe(el);
    this._resize();
    this.io = new IntersectionObserver((ents) => {
      for (const e of ents) {
        this.visible = e.isIntersecting;
        if (e.isIntersecting && !this.started && this.opts.autoplay && !this.seeking) {
          this.started = true;
          if (this.reduced) { this._showFinished(); } else { this._play(); }
        } else if (e.isIntersecting) this._kick();
      }
    }, { threshold: 0.35 });
    this.io.observe(el);

    // click / tap on the leather to stamp again
    this.raycaster = new THREE.Raycaster();
    let down = null;
    canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
      down = null;
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const hit = this.raycaster.intersectObject(this.topMesh, false)[0];
      if (!hit) return;
      const p = this.leather.worldToLocal(hit.point.clone());
      this.stamp({ x: p.x, z: p.z });
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.camera) return;
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      canvas.style.cursor = this.raycaster.intersectObject(this.topMesh, false).length ? 'pointer' : '';
    });

    this.renderNow();
  }

  /* ---------------- die */
  _buildDie(art) {
    const g = this.press;
    while (g.children.length) { const c = g.children.pop(); c.geometry && c.geometry.dispose(); }
    const { fw, fd } = art;
    const ch = 0.014, bh = 0.2;
    const bodyGeo = new THREE.ExtrudeGeometry(chamferRectShape(fw, fd, ch), { depth: bh - 0.012, bevelEnabled: true, bevelThickness: 0.009, bevelSize: 0.009, bevelSegments: 1 });
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.computeBoundingBox();
    bodyGeo.translate(0, RH + 0.0004 - bodyGeo.boundingBox.min.y, 0);
    const body = new THREE.Mesh(bodyGeo, this.brassMat);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    const bodyTop = RH + 0.0004 + bh;

    // relief face
    const rw = fw - 0.004, rd = fd - 0.004;
    const nx = Math.min(900, Math.round(rw * 620)), nz = Math.min(600, Math.round(rd * 620));
    const geo = new THREE.PlaneGeometry(rw, rd, nx - 1, nz - 1);
    geo.rotateX(Math.PI / 2);
    const hts = sampleArtwork(art, nx, nz);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const u = clamp(x / rw + 0.5), v = clamp(z / rd + 0.5);
      const ii = Math.min(nx - 1, Math.round(u * (nx - 1))), jj = Math.min(nz - 1, Math.round(v * (nz - 1)));
      const m = hts[jj * nx + ii];
      pos.setY(i, RH * (1 - m));
      // worn: relief tops polished, recesses tarnished
      const k = Math.pow(m, 0.7);
      col[i * 3] = lerp(0.55, 1.05, k); col[i * 3 + 1] = lerp(0.46, 1.0, k); col[i * 3 + 2] = lerp(0.34, 0.9, k);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const relief = new THREE.Mesh(geo, this.reliefMat);
    relief.castShadow = true;
    g.add(relief);

    // holder plate, screws, heater block, ram
    const hw = fw + 0.12, hd = fd + 0.12;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(hw, 0.045, hd, 3, 0.006), this.steelMat);
    plate.position.y = bodyTop + 0.0225; plate.castShadow = true; g.add(plate);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.018, 28), this.blackMat);
      head.position.set(sx * (hw / 2 - 0.032), bodyTop + 0.045 + 0.009, sz * (hd / 2 - 0.032));
      head.castShadow = true; g.add(head);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.004, 6), new THREE.MeshBasicMaterial({ color: '#050505' }));
      sock.position.copy(head.position); sock.position.y += 0.0075; g.add(sock);
    }
    const heater = new THREE.Mesh(new RoundedBoxGeometry(Math.max(0.42, fw * 0.72), 0.11, Math.max(0.3, fd * 0.8), 3, 0.01), this.anodMat);
    heater.position.y = bodyTop + 0.045 + 0.055 + 0.03; heater.castShadow = true; g.add(heater);
    const hTop = heater.position.y + 0.055;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 48), this.steelMat);
    collar.position.y = hTop + 0.03; collar.castShadow = true; g.add(collar);
    const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 4, 48), this.chromeMat);
    ram.position.y = hTop + 0.06 + 2; ram.castShadow = true; g.add(ram);

    // die texture for the leather shader
    if (this.dieTex) this.dieTex.dispose();
    this.dieTex = new THREE.CanvasTexture(art.canvas);
    this.dieTex.colorSpace = THREE.NoColorSpace;
    this.dieTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.dieTex.anisotropy = 4;
    this.lu.uDie.value = this.dieTex;
    this.fu.uDie.value = this.dieTex;
    this.dieArt = art;
  }

  _buildFoil(art) {
    if (this.foil) { this.scene.remove(this.foil); this.foil.geometry.dispose(); }
    const sw = art.fw + 0.16, sd = art.fd + 0.12;
    const geo = new THREE.PlaneGeometry(sw, sd, 48, 32);
    geo.rotateX(-Math.PI / 2);
    this.foilBase = Float32Array.from(geo.attributes.position.array);
    this.foil = new THREE.Mesh(geo, this.foilMat);
    this.foil.castShadow = true; this.foil.receiveShadow = true;
    this.foil.renderOrder = 2;
    this.fu.uHoleScale.value.set(sw / art.fw, sd / art.fd);
    this.foilSize = [sw, sd];
    this.scene.add(this.foil);
  }

  /* ---------------- leather */
  _loadLeather(name) {
    if (!this.leatherTex[name]) {
      const L = LEATHERS[name], rep = L.ox ? [LW * 0.8, LH * 0.8] : [LW, LH];
      this.leatherTex[name] = Promise.all([loadTex(L.albedo, true, rep), loadTex(L.normal, false, rep)])
        .then(([a, n]) => (this.leatherTex[name] = { a, n }));
    }
    return Promise.resolve(this.leatherTex[name]);
  }

  async setLeather(name, silent) {
    if (!LEATHERS[name]) name = 'vegtan';
    const T = await this._loadLeather(name);
    const L = LEATHERS[name];
    this.opts.leather = name;
    const m = this.leatherMat;
    m.map = T.a;
    m.normalMap = T.n;
    m.normalScale.set(L.normalScale, L.normalScale);
    m.needsUpdate = true;
    this.lu.uOx.value = L.ox;
    this.lu.uBurnish.value.set(...L.burnish);
    this.lu.uHeatCol.value.set(...L.heat);
    this.edgeMat.color.set(L.edge); this.edgeMat.roughness = L.edgeRough;
    if (!silent) this.renderNow();
  }

  setFinish(f) { if (FINISHES.includes(f)) this.opts.finish = f; }

  /* ---------------- jobs */
  _clampSpot(x, z, art) {
    const mx = LW / 2 - art.fw / 2 - 0.07, mz = LH / 2 - art.fd / 2 - 0.07;
    return { x: clamp(x, -mx, mx), z: clamp(z, -mz, mz) };
  }

  _freeSpot(art) {
    let best = null, bestD = -1;
    for (let i = 0; i < 40; i++) {
      const c = this._clampSpot((Math.random() - 0.5) * LW, (Math.random() - 0.5) * LH, art);
      let d = 1e9;
      for (const s of this.stamps) d = Math.min(d, Math.hypot((s.x - c.x) / (art.fw + s.fw) , (s.z - c.z) / (art.fd + s.fd)));
      if (this.job) d = Math.min(d, Math.hypot((this.job.x - c.x) / (art.fw * 2), (this.job.z - c.z) / (art.fd * 2)));
      if (d > bestD) { bestD = d; best = c; }
    }
    return best;
  }

  _commit(job) {
    if (!job || job.committed || !job.impacted) return;
    job.committed = true;
    const art = job.art;
    const tmp = document.createElement('canvas');
    tmp.width = art.canvas.width; tmp.height = art.canvas.height;
    const t = tmp.getContext('2d');
    const r = 255, gch = job.finish === 'foil' ? 255 : 0, b = job.finish === 'heat' ? 255 : 0;
    t.fillStyle = `rgb(${r},${gch},${b})`; t.fillRect(0, 0, tmp.width, tmp.height);
    t.globalCompositeOperation = 'destination-in'; t.drawImage(art.canvas, 0, 0);
    const cu = job.x / LW + 0.5, cv = 0.5 - job.z / LH;
    const w = art.fw / LW * ACC_W, h = art.fd / LH * ACC_H;
    const ctx = this.accCtx;
    ctx.save(); ctx.globalCompositeOperation = 'lighten';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmp, cu * ACC_W - w / 2, (1 - cv) * ACC_H - h / 2, w, h);
    ctx.restore();
    this.accTex.needsUpdate = true;
    this.stamps.push({ x: job.x, z: job.z, fw: art.fw, fd: art.fd });
    this.lu.uCurDepth.value = 0; this.lu.uCurFoil.value = 0; this.lu.uCurHeat.value = 0;
  }

  _newJob({ x, z, finish, art, immediate }) {
    if (this.job) this._commit(this.job);
    const spot = this._clampSpot(x, z, art);
    const from = immediate ? { x: -spot.x, z: -spot.z } : { x: this.offset.x, y: this.offset.y };
    const fromX = immediate ? -spot.x : this.offset.x, fromZ = immediate ? -spot.z : this.offset.y;
    const recut = !!(this.dieArt && art !== this.dieArt);
    const move = Math.hypot(fromX + spot.x, fromZ + spot.z) > 0.01;
    const tRecut = recut ? 1.15 : 0, tMove = move ? 0.75 : 0;
    const tFoil = finish === 'foil' ? 0.65 : 0;
    const T0 = Math.max(tRecut, tMove) + tFoil + 0.15;
    const Ti = T0 + 0.36;
    const hold = finish === 'heat' ? 1.1 : 0.55;
    const TL = Ti + hold, TLe = TL + 0.6;
    const TP = TLe + 0.05;
    const end = finish === 'foil' ? TP + 1.25 : TLe + 0.55;
    this.job = { x: spot.x, z: spot.z, finish, art, prevArt: this.dieArt, recut, fromX, fromZ, tRecut, tMove, tFoil, T0, Ti, TL, TLe, TP, end, impacted: false, committed: false };
    void from;
    if (finish === 'foil') this._buildFoil(art); else if (this.foil) { this.scene.remove(this.foil); this.foil = null; }
    this.lu.uCurC.value.set(spot.x / LW + 0.5, 0.5 - spot.z / LH);
    this.lu.uCurS.value.set(art.fw / LW / 2, art.fd / LH / 2);
    return this.job;
  }

  /** Stamp at a leather-local point {x,z}; omit for a free spot. */
  stamp(at, opts) {
    if (this.failed || !this.job) return;
    const o = Object.assign({ finish: this.opts.finish }, opts || {});
    const art = o.art || this.art;
    const spot = at || this._freeSpot(art);
    const req = { x: spot.x, z: spot.z, finish: o.finish, art };
    if (this.playing) { this.queue = req; return; }
    this._newJob(req);
    if (this.reduced) { this.seek(this.job.end + 1, true); return; }
    this._play();
  }

  async setText(text) {
    if (this.failed) return;
    text = (text || '').trim().slice(0, 16);
    this.opts.text = text || null;
    this.art = await makeArtwork(this.opts.text);
    this.stamp(null, { art: this.art });
  }

  _play() {
    this.seeking = false;
    this.playing = true;
    this.jobTime = 0;
    this._kick();
  }

  _kick() {
    if (this.raf || this.failed) return;
    let last = performance.now();
    const loop = (now) => {
      this.raf = 0;
      if (!this.playing || !this.visible) return;   // resumes from the same moment via _kick()
      const dt = Math.min(now - last, 100);          // hidden tab or a long stall: no jump ahead
      last = now;
      this._adapt(now - 0, dt);
      this.jobTime = (this.jobTime || 0) + dt / 1000;
      this._update(this.jobTime);
      this.renderNow();
      if (this.jobTime > this.job.end) {
        this.playing = false;
        if (this.queue) { const q = this.queue; this.queue = null; this._newJob(q); this._play(); }
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Drop the pixel ratio once if frames are slow (older laptops, phones). */
  _adapt(now, dt) {
    if (this.adapted) return;
    this.frameLog = this.frameLog || [];
    this.frameLog.push(dt);
    if (this.frameLog.length < 40) return;
    const avg = this.frameLog.slice(10).reduce((a, b) => a + b, 0) / (this.frameLog.length - 10);
    this.adapted = true;
    if (avg > 22 && this.renderer.getPixelRatio() > 1.01) {
      this.renderer.setPixelRatio(Math.max(1, this.renderer.getPixelRatio() * 0.66));
      this._resize();
    }
  }

  _showFinished() {
    this.seek(this.job.end + 1, true);
  }

  /** Jump the current stamp cycle to time t (seconds) and render. Pauses playback. */
  seek(t, keepPlayingState) {
    if (!this.job) return;
    if (!keepPlayingState) { this.playing = false; this.seeking = true; this.started = true; }
    this.jobTime = t;
    this._update(t);
    this.renderNow();
  }

  renderNow() {
    if (!this.renderer || !this.camera) return;
    const r = this.renderer;
    const fp = new THREE.Vector3(0, this.surfaceY, 0).applyMatrix4(this.camera.matrixWorldInverse);
    this.post.uniforms.uFocus.value = -fp.z;
    this.post.uniforms.uSeed.value = (this.post.uniforms.uSeed.value + 0.37) % 10;
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }

  /* ---------------- the physics of one cycle */
  _dieY(t, j) {
    if (t < j.T0) {
      if (j.recut && t < j.tRecut) {
        // die leaves to be re-cut, comes back with the new face
        if (t < 0.5) return REST + 2.6 * Math.pow(t / 0.5, 2);
        const s = clamp((t - 0.5) / (j.tRecut - 0.5));
        return REST + 2.6 * (1 - easeOutBack(s, 0.6));
      }
      return REST;
    }
    if (t < j.Ti) {
      const s = (t - j.T0) / (j.Ti - j.T0);
      return REST * (1 - Math.pow(s, 2.3));
    }
    if (t < j.TL) {
      const u = t - j.Ti;
      return -PEN * (1 - Math.exp(-u / 0.012)) + 0.009 * Math.exp(-u / 0.045) * Math.sin(2 * Math.PI * u / 0.11);
    }
    const yL = this._dieY(j.TL - 1e-6, j);
    if (t < j.TLe) {
      const s = (t - j.TL) / (j.TLe - j.TL);
      return lerp(yL, REST, easeInOutCubic(s));
    }
    const u = t - j.TLe;
    return REST - 0.012 * Math.exp(-u / 0.09) * Math.sin(2 * Math.PI * u / 0.22);
  }

  _update(t) {
    const j = this.job;
    // leather slides under the die
    const sm = j.tMove > 0 ? easeInOutCubic(clamp(t / j.tMove)) : 1;
    this.offset.set(lerp(j.fromX, -j.x, sm), lerp(j.fromZ, -j.z, sm));
    this.leather.position.set(this.offset.x, 0, this.offset.y);

    // die artwork swap at the top of a re-cut
    const wantArt = (j.recut && t < 0.5) ? j.prevArt : j.art;
    if (wantArt && this.dieArt !== wantArt) this._buildDie(wantArt);
    this.lu.uDie.value = this.dieTex;

    const y = this._dieY(t, j);
    this.press.position.set(0, this.surfaceY + y, 0);

    // plastic dent: deepest point so far, then a small spring-back after the lift
    let depth = 0;
    if (t >= j.Ti) {
      j.impacted = true;
      const u = Math.min(t, j.TL) - j.Ti;
      let mx = 0;
      for (let s = 0; s <= u + 1e-9; s += 0.002) {
        const p = -(-PEN * (1 - Math.exp(-s / 0.012)) + 0.009 * Math.exp(-s / 0.045) * Math.sin(2 * Math.PI * s / 0.11));
        if (p > mx) mx = p;
        if (mx >= PEN) break;
      }
      depth = clamp(mx / PEN);
      if (t > j.TL + 0.08) depth = lerp(depth, RECOVER, easeOutCubic(clamp((t - j.TL - 0.08) / 0.45)));
    } else if (t < j.Ti) {
      j.impacted = j.impacted && false;
    }
    this.lu.uCurDepth.value = depth;
    this.lu.uCurHeat.value = j.finish === 'heat' ? smooth(j.Ti, j.Ti + (j.TL - j.Ti) * 0.9, t) : 0;
    this.lu.uCurFoil.value = (j.finish === 'foil' && t >= j.Ti) ? 1 : 0;

    // camera: a very small jolt on impact
    const u = t - j.Ti;
    const jolt = (u > 0 && u < 0.4) ? 0.0025 * Math.exp(-u / 0.05) * Math.sin(u * 95) : 0;
    this.camera.position.copy(this.camPos); this.camera.position.y += jolt;
    this.camera.lookAt(this.camTarget);
    this.camera.updateMatrixWorld();

    // foil carrier: drops on, gets pressed, tears off
    if (this.foil) this._updateFoil(t, j);
  }

  _updateFoil(t, j) {
    const [sw, sd] = this.foilSize;
    const base = this.foilBase, pos = this.foil.geometry.attributes.position;
    const y0 = this.surfaceY + 0.0012;
    const tDrop0 = j.T0 - j.tFoil - 0.05, tDrop1 = j.T0 - 0.05;
    const drop = clamp((t - tDrop0) / (tDrop1 - tDrop0));
    this.foil.visible = t >= tDrop0 - 0.001;
    this.fu.uHole.value = t >= j.Ti + 0.02 ? 1 : 0;
    // peel from the near right corner back over itself, then lift away
    const peel = clamp((t - j.TP) / 0.75);
    const away = clamp((t - j.TP - 0.6) / 0.6);
    this.fu.uFade.value = 1 - smooth(0.4, 1, away);
    const dir = new THREE.Vector2(-sw, -sd).normalize();   // fold line travels from the (+x,+z) corner toward (-x,-z)
    const half = (sw * Math.abs(dir.x) + sd * Math.abs(dir.y)) / 2;
    const f = -half + easeInOutCubic(peel) * half * 2.05;
    const R = 0.03, TM = Math.PI * 0.78;
    const fall = 1 - easeOutCubic(drop);
    const flutter = Math.sin(drop * 9) * 0.02 * fall;
    for (let i = 0; i < pos.count; i++) {
      let x = base[i * 3], z = base[i * 3 + 2];
      let y = 0.22 * fall + flutter * (x / sw);
      const sPos = x * dir.x + z * dir.y;
      const q = f - sPos;
      if (peel > 0 && q > 0) {
        const th = Math.min(q / R, TM);
        let s2 = f - R * Math.sin(th), yy = R * (1 - Math.cos(th));
        const rest = q - R * TM;
        if (rest > 0) { s2 += rest * -Math.cos(TM); yy += rest * Math.sin(TM); }
        x += dir.x * (s2 - sPos); z += dir.y * (s2 - sPos); y += yy;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    this.foil.geometry.computeVertexNormals();
    this.foil.position.set(0, y0 + 0.5 * away * away, 0);
    this.foil.position.x += 0.9 * away * away; this.foil.position.z += 0.4 * away * away;
    this.foil.rotation.z = -0.5 * away;
  }

  /* ---------------- layout */
  _resize() {
    const w = Math.max(1, this.el.clientWidth), h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    const pr = this.renderer.getPixelRatio();
    this.rt.setSize(Math.round(w * pr), Math.round(h * pr));
    this.post.uniforms.uRes.value.set(Math.round(w * pr), Math.round(h * pr));
    this.post.uniforms.uMaxR.value = 7 * pr * Math.min(1.4, w / 1100);
    const a = w / h;
    this.camera.aspect = a;
    this.camera.fov = a < 1 ? 34 : 24;
    this.camera.updateProjectionMatrix();
    // keep roughly the same framing of the leather on any aspect
    let dist = 3.4;
    if (a < 1) dist *= 0.9 + 0.38 * clamp((1 - a) / 0.5, 0, 1.4);
    else if (a < 1.5) dist *= 1.5 / a;
    const C = this.opts.camera || {};
    if (C.dist) dist = C.dist;
    const el = THREE.MathUtils.degToRad(C.el ?? 32), az = THREE.MathUtils.degToRad(C.az ?? -14);
    this.camTarget = new THREE.Vector3(0, C.ty ?? (a < 1 ? 0.2 : 0.26), C.tz ?? 0.1);
    this.camPos = new THREE.Vector3(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist).add(this.camTarget);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.updateMatrixWorld();
    if (this.job) this._update(this.jobTime || 0);
    this.renderNow();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro && this.ro.disconnect(); this.io && this.io.disconnect();
    this.renderer && this.renderer.dispose();
    this.el.innerHTML = '';
  }
}

/* ------------------------------------------------------------------ public API */
const instances = [];
function mount(el, opts) {
  if (typeof el === 'string') el = document.querySelector(el);
  const inst = new StampFx(el, opts);
  instances.push(inst);
  return inst;
}
window.LGFx = window.LGFx || {};
window.LGFx.stamp = {
  mount,
  instances,
  seek(t) { const i = instances[instances.length - 1]; if (i) i.seek(t); },
  get last() { return instances[instances.length - 1]; },
};
// declarative: <div data-lgfx-stamp data-leather="oxblood" data-finish="foil"></div>
document.querySelectorAll('[data-lgfx-stamp]').forEach(el => mount(el, {
  leather: el.dataset.leather, finish: el.dataset.finish, text: el.dataset.text || null,
}));
window.dispatchEvent(new CustomEvent('lgfx:stamp-ready'));
