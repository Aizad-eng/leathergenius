// Leather Genius FX: zipper intro.
// A closed leather jacket front (two panels, metal zipper, leather pull tab with the LG mark)
// unzips and the panels roll back to reveal the page. three.js r169, vendored.
// API: LGFx.zipper.mount(el, {color:'oxblood'|'espresso', metal:'brass'|'nickel', auto:true, force:false})
//      LGFx.zipper.seek(t)   // 0..1, freezes the animation at t (for frame grabs)
import * as THREE from '../../vendor/three/three.module.min.js';

const BASE = new URL('.', import.meta.url).href;
const KEY = 'lg-zipper-done';

// ---------------------------------------------------------------- constants (world units, view height = 2)
const PITCH = 0.050;          // tooth pitch per side
const TOOTH_H = 0.029;       // tooth height along the chain
const TOOTH_L = 0.064;        // tip to tail
const S_TIP = -0.016;         // tooth tip, measured from the centre line
const S_TOOTH = S_TIP + TOOTH_L / 2;
const TAPE_IN = 0.004, TAPE_OUT = 0.112;
const LEA_IN = 0.068;         // leather inner (folded, painted) edge
const LEA_Z = 0.0085, LEA_T = 0.0055; // leather slab centre and half thickness
const LS = 0.20;              // slider length
const Y_TOP = 0.80;           // top stop
const Y_MIN = -1.35, Y_MAX = 1.35;
const YS0 = Y_TOP - LS / 2 - 0.006;
const YS1 = -0.78;
const STITCH_ROWS = [0.081, 0.106];
const STITCH_PITCH = 0.026;
const TCOLS = 22;

const COLORS = {
  oxblood: { leather: '#5a1219', edge: '#2a0b0d', lining: '#8d6a3e', liningSheen: '#f1d49a', tape: '#1c1513', thread: '#b48c62', tab: [79, 21, 25] },
  espresso: { leather: '#3b2117', edge: '#1a0e09', lining: '#6b2228', liningSheen: '#e9a3a3', tape: '#16110e', thread: '#b48c62', tab: [62, 36, 25] },
};
const METALS = {
  brass: { color: '#c79d55', roughness: 0.3 },
  nickel: { color: '#9a968e', roughness: 0.3 },
};

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// heavy slider: slow break-away, quick middle, soft landing
const easeSlider = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ---------------------------------------------------------------- the opening model
// Each horizontal row of the jacket front is a 1D strip (arc length s from the centre line).
// The strip translates outward by e and its inner part rolls back over a cylinder of radius R,
// p = rolled arc length. Returns x, z and the normal (nx, nz) of the deformed strip.
function rowParams(y, st, Wp) {
  const hT = y - (st.ys - LS / 2);
  let base = 0, peel = 0;
  if (hT > 0) {
    base = 0.17 * (Math.sqrt(hT * hT + 0.0144) - 0.12) / (1 + 0.25 * hT);
    peel = 0.34 * Math.pow(Math.max(0, hT - 0.2), 1.15);
  }
  base *= st.open1; peel *= st.open1;
  const gy = clamp(st.g * 1.3 - (1 - (y - Y_MIN) / (Y_MAX - Y_MIN)) * 0.3);
  const ge = gy * gy * (3 - 2 * gy);
  return {
    e: base + ge * 0.25 + ge * ge * 0.45,
    p: peel + Math.pow(ge, 1.5) * (Wp + 1.0),
    R: 0.07 + 0.05 * Math.min(peel, 1) + 0.17 * ge,
  };
}
const dome = (s, Wp) => 0.03 * (1 - Math.exp(-Math.max(s, 0) / 0.3)) - 0.015 * (s / Wp) * (s / Wp);

function curve(s, rp, Wp, out) {
  const q = S_TIP + rp.p;
  if (s >= q) {
    out.x = s + rp.e; out.z = dome(s, Wp); out.nx = 0; out.nz = 1; out.tx = 1; out.tz = 0;
  } else {
    const a = q - s, R = rp.R, phi = a / R, zq = dome(q, Wp);
    if (phi <= Math.PI) {
      const sn = Math.sin(phi), cs = Math.cos(phi);
      out.x = q + rp.e - R * sn; out.z = zq + R * (1 - cs);
      out.tx = cs; out.tz = -sn; out.nx = sn; out.nz = cs;
    } else {
      out.x = q + rp.e + (a - Math.PI * R); out.z = zq + 2 * R;
      out.tx = -1; out.tz = 0; out.nx = 0; out.nz = -1;
    }
  }
  return out;
}

// ---------------------------------------------------------------- helpers
function gridGeometry(cols, rows, flip) {
  const g = new THREE.BufferGeometry();
  const n = cols * rows;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const idx = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    if (!flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  g.setIndex(idx);
  return g;
}

// rounded, slightly cupped metal tooth (tip at -x, tail at +x)
function toothGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1, 10, 6, 4);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).multiplyScalar(2); // -1..1
    // superellipse rounding in the x/y plane and the y/z plane
    const k = 5;
    const r = Math.pow(Math.pow(Math.abs(v.x), k) + Math.pow(Math.abs(v.y), k) + Math.pow(Math.abs(v.z), k), 1 / k);
    const m = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    if (r > 0) v.multiplyScalar(m / r);
    const u = (v.x + 1) / 2; // 0 tip .. 1 tail
    // head is full height and domed, the clamp legs near the tape are thinner
    const hScale = 1 - 0.12 * smooth(0.6, 1, u);
    let z = v.z * (0.5 + 0.5 * (1 - 0.35 * smooth(0.6, 1, u)));
    if (v.z > 0) z += 0.18 * (1 - v.y * v.y) * Math.sin(Math.PI * clamp(u * 1.4)) - 0.07 * Math.exp(-((u - 0.25) ** 2) / 0.012) * (1 - v.y * v.y);
    p.setXYZ(i, v.x * TOOTH_L / 2, v.y * hScale * TOOTH_H / 2, z * 0.0105);
  }
  g.computeVertexNormals();
  return g;
}

function mirrorX(geo) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.computeVertexNormals();
  return g;
}

function roundedRectShape(w, h, r, x0 = -w / 2, y0 = -h / 2) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

// soft studio for reflections: big key softbox top-left, a strip on the right, dim warm room
function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.045, 0.04), side: THREE.BackSide }));
  scene.add(room);
  const box = (w, h, intensity, pos, tint = [1, 0.97, 0.92]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint[0] * intensity, tint[1] * intensity, tint[2] * intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); scene.add(m);
  };
  box(7, 5, 9, [-6, 7, 8]);                 // key softbox, top left, in front
  box(2, 9, 2.4, [9, 1, 5], [0.95, 0.97, 1]); // strip fill, right
  box(12, 3, 1.2, [0, -6, 6], [1, 0.9, 0.8]); // warm floor bounce
  box(6, 3, 3, [2, 9, -4]);                 // top back rim
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  return rt.texture;
}

function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

const LG_PATH = 'M12 0H52L64 12V52L52 64H12L0 52V12ZM49.64 48.86 54 44.5H21.5V44.2Q21.48 43.9 21.48 43.46V22.68Q21.48 21.62 21.61 21.2Q22.030 21.05 23.16 21.05Q23.66 21.05 24.07 20.77Q24.44 20.53 24.64 20.13Q24.83 19.73 24.83 19.23Q24.83 18.73 24.64 18.34Q24.44 17.94 24.07 17.69Q23.66 17.42 23.16 17.42L20.81 17.46Q20.79 17.46 20.78 17.47Q18.72 17.55 17.39 17.55Q16.07 17.55 14.01 17.47Q14 17.46 13.98 17.46L11.66 17.42Q10.97 17.42 10.5 17.89Q10.23 18.16 10.1 18.54Q10 18.85 10 19.23Q10 19.62 10.1 19.93Q10.23 20.3 10.5 20.58Q10.97 21.05 11.63 21.05Q12.77 21.05 13.19 21.2Q13.21 21.21 13.22 21.22Q13.36 21.58 13.36 22.64V43.64Q13.36 44.69 13.21 45.09Q12.79 45.23 11.630 45.23Q10.97 45.23 10.5 45.7Q10.23 45.97 10.1 46.35Q10 46.66 10 47.04Q10 47.43 10.1 47.73Q10.23 48.11 10.5 48.39Q10.97 48.86 11.63 48.86ZM26.1 28.68Q26.1 32.34 27.88 35.34Q29.67 38.35 33.04 40.08Q36.36 41.78 40.76 41.78Q44.73 41.78 49.66 40.71Q49.75 40.69 49.84 40.66Q50.3 40.48 50.52 40.32Q51.1 39.88 51.1 39.03Q51.1 38.72 50.95 37.9Q50.84 37.31 50.84 35.75Q50.84 33.65 50.91 32.87Q50.92 32.76 50.93 32.66Q51.67 32.66 52.08 32.07Q52.37 31.67 52.37 31.14Q52.37 30.71 52.13 30.32Q51.97 30.05 51.72 29.87Q51.36 29.61 50.92 29.61Q50.88 29.61 50.85 29.62Q48.84 29.73 46.97 29.73Q45.08 29.73 41.95 29.54Q41.91 29.54 41.88 29.54Q41.43 29.54 41.07 29.8Q40.83 29.97 40.66 30.25Q40.43 30.64 40.43 31.1Q40.43 31.67 40.73 32.08Q41.17 32.66 41.91 32.66Q43.48 32.66 44 32.85Q44.12 32.89 44.16 33.04Q44.33 33.63 44.33 35.38Q44.33 37.04 44.04 37.79Q43.87 38.25 43.56 38.38Q42.97 38.62 41.69 38.62Q39.3 38.62 37.38 37.27Q35.42 35.89 34.29 33.33Q33.14 30.69 33.14 27.27Q33.14 23.12 34.87 20.82Q36.48 18.68 39.64 18.68Q42.19 18.68 44.15 20.05Q46.15 21.45 47.31 24Q47.32 24.020 47.33 24.04Q47.57 24.53 48.07 24.74Q48.49 24.92 48.97 24.83Q49.36 24.75 49.65 24.52Q50.17 24.1 50.17 23.44Q50.17 23.38 50.17 23.32L49.68 18.15Q49.62 17.48 49.4 17.08Q49.08 16.5 48.31 16.23Q47.1 15.74 45.2 15.44Q43.31 15.14 41.47 15.14Q37.2 15.14 33.72 16.81Q30.19 18.51 28.15 21.61Q26.1 24.74 26.1 28.68Z';

// Leather pull tab textures: colourised grain, debossed LG mark, saddle-stitched border.
function makeTabTextures(albedoImg, normalImg, rgb, threadHex, Wt, Lt) {
  const W = 256, H = Math.round(256 * Lt / Wt);
  const pxPerWorld = W / Wt;
  const tileWorld = 0.3, tilePx = tileWorld * pxPerWorld;
  // ---- height field
  const hc = document.createElement('canvas'); hc.width = W; hc.height = H;
  const h = hc.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, W, H);
  // folded edge: slight rounding towards the border
  const g1 = h.createLinearGradient(0, 0, W, 0);
  g1.addColorStop(0, '#5a5a5a'); g1.addColorStop(0.07, '#808080'); g1.addColorStop(0.93, '#808080'); g1.addColorStop(1, '#5a5a5a');
  h.fillStyle = g1; h.fillRect(0, 0, W, H);
  // deboss: LG octagon pressed in, letters stay proud
  const markW = W * 0.7, mx = (W - markW) / 2, my = H * 0.58;
  const path = new Path2D(LG_PATH);
  const drawMark = (ctx, fill, blur) => {
    ctx.save(); ctx.translate(mx, my); ctx.scale(markW / 64, markW / 64);
    ctx.shadowColor = fill; ctx.shadowBlur = blur; ctx.fillStyle = fill; ctx.fill(path); ctx.restore();
  };
  drawMark(h, '#2e2e2e', 1.5);
  // stitch border
  const inset = 0.013 * pxPerWorld, stLen = 0.0115 * pxPerWorld, stPitch = 0.0155 * pxPerWorld;
  const stitches = [];
  const addLine = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.floor(len / stPitch);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n; stitches.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, Math.atan2(y1 - y0, x1 - x0)]);
    }
  };
  const top = 0.06 * pxPerWorld;
  addLine(inset, top, inset, H - inset * 1.6);
  addLine(W - inset, top, W - inset, H - inset * 1.6);
  addLine(inset * 1.6, H - inset, W - inset * 1.6, H - inset);
  for (const [x, y, a] of stitches) {
    h.save(); h.translate(x, y); h.rotate(a + 0.32);
    h.fillStyle = '#2c2c2c'; h.fillRect(-stLen / 2 - 2, -2.2, stLen + 4, 4.4); // stitch groove
    h.fillStyle = '#c8c8c8'; h.beginPath(); h.ellipse(0, 0, stLen / 2, 2.1, 0, 0, Math.PI * 2); h.fill();
    h.restore();
  }
  const hd = h.getImageData(0, 0, W, H).data;
  // ---- grain normal tile
  const gc = document.createElement('canvas'); gc.width = W; gc.height = H;
  const gx = gc.getContext('2d');
  for (let y = 0; y < H; y += tilePx) for (let x = 0; x < W; x += tilePx) gx.drawImage(normalImg, x, y, tilePx, tilePx);
  const gd = gx.getImageData(0, 0, W, H).data;
  const nc = document.createElement('canvas'); nc.width = W; nc.height = H;
  const nx = nc.getContext('2d'); const nimg = nx.createImageData(W, H); const nd = nimg.data;
  const at = (x, y) => hd[((Math.min(H - 1, Math.max(0, y)) * W) + Math.min(W - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const dx = (at(x + 1, y) - at(x - 1, y)) * 4.0, dy = (at(x, y + 1) - at(x, y - 1)) * 4.0;
    let ax = (gd[i] / 255 * 2 - 1) * 0.7 - dx, ay = (gd[i + 1] / 255 * 2 - 1) * 0.7 + dy, az = gd[i + 2] / 255 * 2 - 1;
    const l = Math.hypot(ax, ay, az) || 1;
    nd[i] = (ax / l * 0.5 + 0.5) * 255; nd[i + 1] = (ay / l * 0.5 + 0.5) * 255; nd[i + 2] = (az / l * 0.5 + 0.5) * 255; nd[i + 3] = 255;
  }
  nx.putImageData(nimg, 0, 0);
  // ---- albedo
  const ac = document.createElement('canvas'); ac.width = W; ac.height = H;
  const a = ac.getContext('2d');
  a.fillStyle = `rgb(${rgb[0] * 1.05},${rgb[1] * 1.05},${rgb[2] * 1.05})`; a.fillRect(0, 0, W, H);
  a.globalCompositeOperation = 'multiply';
  for (let y = 0; y < H; y += tilePx) for (let x = 0; x < W; x += tilePx) a.drawImage(albedoImg, x, y, tilePx, tilePx);
  drawMark(a, 'rgba(70,60,55,0.55)', 2);                       // burnished, darker deboss
  for (const [x, y, ang] of stitches) { a.save(); a.translate(x, y); a.rotate(ang + 0.32); a.fillStyle = 'rgba(20,10,8,0.6)'; a.fillRect(-stLen / 2 - 2, -2.2, stLen + 4, 4.4); a.restore(); }
  a.globalCompositeOperation = 'source-over';
  for (const [x, y, ang] of stitches) {
    a.save(); a.translate(x, y); a.rotate(ang + 0.32);
    const gr = a.createLinearGradient(0, -2, 0, 2); gr.addColorStop(0, '#d9b98f'); gr.addColorStop(1, threadHex);
    a.fillStyle = gr; a.beginPath(); a.ellipse(0, 0, stLen / 2, 1.9, 0, 0, Math.PI * 2); a.fill(); a.restore();
  }
  const map = new THREE.CanvasTexture(ac); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const nmap = new THREE.CanvasTexture(nc); nmap.anisotropy = 8;
  return { map, nmap };
}

// ---------------------------------------------------------------- the effect
class Zipper {
  constructor(el, opts) {
    this.el = el; this.opts = opts;
    this.fixed = !el || el === document.body || el === document.documentElement;
    this.state = { ys: YS0, g: 0, open1: 0 };
    this.P = 0; this.mode = 'idle'; this.dead = false;
    this.tab = { ax: 0.06, vx: 0, az: 0, vz: 0 };
    this.prevYs = YS0; this.prevV = 0;
    this.tmp = { x: 0, z: 0, nx: 0, nz: 1, tx: 1, tz: 0 };
  }

  buildDom() {
    const root = document.createElement('div');
    root.className = 'lgz' + (this.fixed ? ' lgz--fixed' : '');
    root.setAttribute('aria-hidden', 'true');
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'lgz-skip' + (this.fixed ? '' : ' lgz-skip--inset'); skip.textContent = 'Skip';
    skip.setAttribute('aria-label', 'Skip the intro animation');
    skip.addEventListener('click', (e) => { e.stopPropagation(); this.finish(true); });
    this.root = root; this.skip = skip;
    if (!this.fixed && getComputedStyle(this.el).position === 'static') this.el.style.position = 'relative';
    (this.fixed ? document.body : this.el).appendChild(root);
    (this.fixed ? document.body : this.el).appendChild(skip);
    root.classList.add('is-loading');
  }

  async init() {
    const o = this.opts;
    const col = COLORS[o.color] || COLORS.oxblood, met = METALS[o.metal] || METALS.brass;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no webgl');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    this.root.appendChild(renderer.domElement);

    const [alb, nor, rou, twi] = await Promise.all(['leather_albedo.jpg', 'leather_normal.jpg', 'leather_rough.jpg', 'twill_normal.jpg'].map((f) => loadImage(BASE + 'tex/' + f)));
    if (this.dead) return;
    const tex = (img, srgb, rep) => {
      const t = new THREE.Texture(img); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy(); if (srgb) t.colorSpace = THREE.SRGBColorSpace; if (rep) t.repeat.set(rep, rep); return t;
    };

    const scene = new THREE.Scene();
    this.scene = scene;
    scene.environment = studioEnvironment(renderer);
    scene.environmentIntensity = 0.85;

    const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 50);
    camera.position.set(0, 0, 1 / Math.tan(THREE.MathUtils.degToRad(11)));
    this.camera = camera;

    const key = new THREE.SpotLight(0xffe7cf, 3.1, 0, 0.62, 1, 0);
    key.position.set(-2.4, 3.2, 6.2);
    key.target.position.set(0.35, -0.35, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.002;
    key.shadow.radius = 3;
    scene.add(key); scene.add(key.target);
    this.key = key;
    scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a1d17, 0.35));

    // ---- materials
    const leather = new THREE.MeshPhysicalMaterial({
      color: col.leather, map: tex(alb, true), normalMap: tex(nor, false), roughnessMap: tex(rou, false),
      roughness: 1, normalScale: new THREE.Vector2(0.55, 0.55), clearcoat: 0.22, clearcoatRoughness: 0.45,
      sheen: 0.12, sheenColor: new THREE.Color('#7a3a34'), sheenRoughness: 0.6, envMapIntensity: 0.75,
    });
    // large scale, non-repeating tone variation so the tiled grain never reads as a pattern
    leather.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          float lgzH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float lgzN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(lgzH(i), lgzH(i + vec2(1, 0)), f.x), mix(lgzH(i + vec2(0, 1)), lgzH(i + vec2(1, 1)), f.x), f.y); }
          float lgzF(vec2 p){ return 0.55 * lgzN(p) + 0.3 * lgzN(p * 2.07 + 5.1) + 0.15 * lgzN(p * 4.3 + 1.7); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          float lgzV = lgzF(vMapUv * 0.55);
          diffuseColor.rgb *= 0.88 + 0.24 * lgzV;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor * (0.9 + 0.25 * lgzF(vMapUv * 0.8 + 3.0)), 0.05, 1.0);`);
    };
    const lining = new THREE.MeshPhysicalMaterial({
      color: col.lining, normalMap: tex(twi, false), normalScale: new THREE.Vector2(0.45, 0.45), roughness: 0.42,
      sheen: 1, sheenColor: new THREE.Color(col.liningSheen), sheenRoughness: 0.32, side: THREE.BackSide,
    });
    const tapeNormal = tex(twi, false);
    const tape = new THREE.MeshPhysicalMaterial({ color: col.tape, normalMap: tapeNormal, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.82, sheen: 0.4, sheenColor: new THREE.Color('#5c4a40'), side: THREE.DoubleSide });
    const edge = new THREE.MeshPhysicalMaterial({ color: col.edge, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
    const metal = new THREE.MeshPhysicalMaterial({ color: met.color, metalness: 1, roughness: met.roughness, clearcoat: 0.0 });
    const thread = new THREE.MeshStandardMaterial({ color: col.thread, roughness: 0.55 });
    const holes = new THREE.MeshBasicMaterial({ color: 0x0a0302, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mats = { leather, lining, tape, edge, metal, thread, holes };

    this.colors = col;
    this.buildGeometry(alb, nor);

    // page shadow catcher
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.ShadowMaterial({ opacity: 0.32, color: 0x1a0e08 }));
    sh.position.z = -0.012; sh.receiveShadow = true; scene.add(sh); this.shadowPlane = sh;

    this.resize();
    this.ro = new ResizeObserver(() => { this.resize(); this.render(); });
    this.ro.observe(this.fixed ? document.documentElement : this.el);
    this.io = new IntersectionObserver((en) => { this.visible = en[0].isIntersecting; if (this.visible) this.kick(); });
    this.visible = true; this.io.observe(this.root);
    this.bindInput();
    this.simulateTo(0);
    this.render();
    this.root.classList.remove('is-loading');
    this.root.classList.add('is-ready');
    document.documentElement.classList.remove('lgz-pending');
  }

  buildGeometry() {
    const scene = this.scene, m = this.mats;
    this.sides = [];
    const ROWS = 150, COLS = 120;
    for (const sg of [1, -1]) {
      const flip = sg < 0;
      const side = { sg, rows: ROWS };
      side.front = gridGeometry(COLS, ROWS, flip);
      side.back = gridGeometry(COLS, ROWS, flip);
      side.tape = gridGeometry(TCOLS, ROWS, flip);
      side.edge = gridGeometry(2, ROWS, !flip);
      const mk = (geo, mat, cast = true) => { const me = new THREE.Mesh(geo, mat); me.castShadow = cast; me.receiveShadow = true; me.frustumCulled = false; scene.add(me); return me; };
      side.mFront = mk(side.front, m.leather);
      side.mBack = mk(side.back, m.lining);
      side.mTape = mk(side.tape, m.tape);
      side.mEdge = mk(side.edge, m.edge, false);
      // teeth
      const n = Math.floor((Y_TOP - Y_MIN) / PITCH);
      const tg = sg > 0 ? toothGeometry() : mirrorX(toothGeometry());
      side.teeth = new THREE.InstancedMesh(tg, m.metal, n);
      side.teeth.castShadow = true; side.teeth.receiveShadow = true; side.teeth.frustumCulled = false;
      side.toothY = [];
      for (let k = 0; k < n; k++) side.toothY.push(Y_TOP - 0.02 - k * PITCH - (sg < 0 ? PITCH / 2 : 0));
      scene.add(side.teeth);
      // stitches (saddle stitch, slanted)
      const sgeo = new THREE.SphereGeometry(1, 10, 6);
      sgeo.scale(0.0098, 0.0023, 0.0021);
      sgeo.rotateZ(sg * 0.42);
      const ns = Math.floor((Y_MAX - Y_MIN) / STITCH_PITCH);
      side.stitch = new THREE.InstancedMesh(sgeo, m.thread, ns * STITCH_ROWS.length);
      side.stitch.receiveShadow = true; side.stitch.frustumCulled = false;
      side.stitchN = ns;
      const hgeo = new THREE.CircleGeometry(1, 14); hgeo.scale(0.0122, 0.0036, 1); hgeo.rotateZ(sg * 0.42);
      side.holes = new THREE.InstancedMesh(hgeo, m.holes, ns * STITCH_ROWS.length); side.holes.frustumCulled = false; side.holes.renderOrder = 1;
      scene.add(side.holes);
      scene.add(side.stitch);
      // top stop
      const ts = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.02, 0.016, 2, 2, 2), m.metal);
      ts.castShadow = true; scene.add(ts); side.topStop = ts;
      this.sides.push(side);
    }
    this.buildSlider();
  }

  buildSlider() {
    const m = this.mats;
    const g = new THREE.Group();
    // body: wide shoulders at the top, narrow throat at the bottom
    const s = new THREE.Shape();
    const tw = 0.13, bw = 0.088, hl = LS / 2;
    s.moveTo(-bw / 2, -hl); s.lineTo(bw / 2, -hl);
    s.bezierCurveTo(bw / 2 + 0.006, -hl + 0.05, tw / 2, hl - 0.06, tw / 2, hl - 0.022);
    s.quadraticCurveTo(tw / 2, hl, tw / 2 - 0.022, hl);
    s.lineTo(-tw / 2 + 0.022, hl); s.quadraticCurveTo(-tw / 2, hl, -tw / 2, hl - 0.022);
    s.bezierCurveTo(-tw / 2, hl - 0.06, -bw / 2 - 0.006, -hl + 0.05, -bw / 2, -hl);
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.011, bevelSize: 0.009, bevelSegments: 7, curveSegments: 18 }), m.metal);
    body.position.z = 0.012; body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    // back plate (seen when the side rolls over)
    const back = body.clone(); back.position.z = -0.03; g.add(back);
    // lug / bridge for the pull
    const lug = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape(0.034, 0.13, 0.014), { depth: 0.012, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 4 }), m.metal);
    lug.position.set(0, 0.008, 0.037); lug.castShadow = true; lug.receiveShadow = true; g.add(lug);

    // pull: hinged at the top of the lug
    const pivot = new THREE.Group(); pivot.position.set(0, 0.062, 0.062); g.add(pivot);
    const plate = roundedRectShape(0.062, 0.175, 0.024, -0.031, -0.175);
    const win = roundedRectShape(0.036, 0.015, 0.007, -0.018, -0.158);
    plate.holes.push(win);
    const knuckle = roundedRectShape(0.02, 0.034, 0.009, -0.01, -0.04);
    plate.holes.push(knuckle);
    const pull = new THREE.Mesh(new THREE.ExtrudeGeometry(plate, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0045, bevelSize: 0.0045, bevelSegments: 5, curveSegments: 14 }), m.metal);
    pull.position.z = -0.006; pull.castShadow = true; pull.receiveShadow = true; pivot.add(pull);
    // leather tab looped through the window
    const Wt = 0.13, Lt = 0.46;
    const { map, nmap } = makeTabTextures(this._alb, this._nor, this.colors.tab, this.colors.thread, Wt, Lt);
    const tabMat = new THREE.MeshPhysicalMaterial({ map, normalMap: nmap, normalScale: new THREE.Vector2(1, 1), roughness: 0.6, clearcoat: 0.1, clearcoatRoughness: 0.5, envMapIntensity: 0.55 });
    const tabShape = new THREE.Shape();
    const r = 0.028;
    tabShape.moveTo(-Wt / 2, 0); tabShape.lineTo(Wt / 2, 0); tabShape.lineTo(Wt / 2, -Lt + r);
    tabShape.quadraticCurveTo(Wt / 2, -Lt, Wt / 2 - r, -Lt); tabShape.lineTo(-Wt / 2 + r, -Lt);
    tabShape.quadraticCurveTo(-Wt / 2, -Lt, -Wt / 2, -Lt + r); tabShape.lineTo(-Wt / 2, 0);
    const tg = new THREE.ExtrudeGeometry(tabShape, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0028, bevelSegments: 3, curveSegments: 10 });
    const uv = tg.attributes.uv, pos = tg.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + Wt / 2) / Wt, (pos.getY(i) + Lt) / Lt);
    const tab = new THREE.Mesh(tg, [tabMat, this.mats.edge]);
    tab.position.set(0, -0.112, -0.006); tab.castShadow = true; tab.receiveShadow = true;
    const tabPivot = new THREE.Group(); tabPivot.position.set(0, -0.15, 0); pivot.add(tabPivot);
    tab.position.set(0, -0.012, -0.007);
    tabPivot.add(tab);
    // the fold of leather around the window bar
    const fold = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, Wt * 0.94, 20, 1, false, 0, Math.PI), tabMat);
    fold.rotation.z = Math.PI / 2; fold.rotation.y = 0; fold.position.set(0, -0.006, -0.0005);
    fold.castShadow = true; tabPivot.add(fold);
    this.slider = g; this.pullPivot = pivot; this.tabPivot = tabPivot;
    this.scene.add(g);
  }

  resize() {
    const r = this.fixed ? { width: window.innerWidth, height: window.innerHeight } : this.el.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.aspect = w / h;
    this.camera.aspect = this.aspect; this.camera.updateProjectionMatrix();
    this.Wp = this.aspect + 0.45;
    this.key.angle = Math.min(1.1, Math.atan((this.aspect + 1.2) / 6.5) * 1.15);
    this.key.shadow.camera.near = 2; this.key.shadow.camera.far = 14;
    this.cols = null;
  }

  // ---------------- per-frame deformation
  updateGeometry() {
    const st = this.state, Wp = this.Wp, out = this.tmp;
    const COLS = 120;
    if (!this.cols || this.colsWp !== Wp) {
      this.cols = new Float32Array(COLS);
      this.colW = new Float32Array(COLS); this.colE = new Float32Array(COLS); this.colS5 = new Float32Array(COLS); this.colC5 = new Float32Array(COLS);
      for (let i = 0; i < COLS; i++) {
        const s = this.cols[i] = LEA_IN + (Wp - LEA_IN) * Math.pow(i / (COLS - 1), 1.55);
        this.colW[i] = 1 - Math.exp(-(s - LEA_IN) / 0.06); this.colE[i] = Math.exp(-s / 0.3);
        this.colS5[i] = Math.sin(s * 5); this.colC5[i] = Math.cos(s * 5);
      }
      this.colsWp = Wp;
    }
    const cols = this.cols, colW = this.colW, colE = this.colE, colS5 = this.colS5, colC5 = this.colC5;
    for (const sd of this.sides) {
      const sg = sd.sg, rows = sd.rows;
      const fp = sd.front.attributes.position.array, bp = sd.back.attributes.position.array;
      const fn = sd.front.attributes.normal.array, bn = sd.back.attributes.normal.array;
      const fu = sd.front.attributes.uv.array, bu = sd.back.attributes.uv.array;
      const tp = sd.tape.attributes.position.array, tn = sd.tape.attributes.normal.array, tu = sd.tape.attributes.uv.array;
      const ep = sd.edge.attributes.position.array, en = sd.edge.attributes.normal.array;
      for (let j = 0; j < rows; j++) {
        const y = Y_MIN + (Y_MAX - Y_MIN) * j / (rows - 1);
        const rp = rowParams(y, st, Wp);
        // subtle pucker along the seam
        const puck = 0.0028 * Math.sin(y * 47 + sg * 1.3) + 0.0016 * Math.sin(y * 113 + 2.1);
        const puckD = 0.1316 * Math.cos(y * 47 + sg * 1.3) + 0.1808 * Math.cos(y * 113 + 2.1);
        const iW2 = 1 / (Wp * Wp), sa = Math.sin(y * 9 + sg), ca = Math.cos(y * 9 + sg);
        for (let i = 0; i < COLS; i++) {
          const s = cols[i];
          curve(s, rp, Wp, out);
          const w = colW[i];
          const s5 = sa * colC5[i] + ca * colS5[i], c5 = ca * colC5[i] - sa * colS5[i];
          const pz = puck * (1 - w) * 0.9 + 0.0035 * s5 * w;
          const k = (j * COLS + i) * 3;
          const nxw = sg * out.nx, nzw = out.nz;
          fp[k] = sg * out.x + nxw * (LEA_Z + LEA_T); fp[k + 1] = y; fp[k + 2] = out.z + nzw * (LEA_Z + LEA_T) + pz;
          bp[k] = sg * out.x + nxw * (LEA_Z - LEA_T); bp[k + 1] = y; bp[k + 2] = out.z + nzw * (LEA_Z - LEA_T) + pz;
          // analytic normal: strip normal tilted by the dome and pucker slopes
          const dzdy = puckD * (1 - w) * 0.9 + 0.0315 * c5 * w;
          let ax = nxw, ay = -dzdy, az = nzw;
          if (out.nz === 1) { ax = -sg * (0.1 * colE[i] - 0.03 * s * iW2 + 0.0175 * c5 * w); }
          const il = 1 / Math.sqrt(ax * ax + ay * ay + az * az);
          ax *= il; ay *= il; az *= il;
          fn[k] = ax; fn[k + 1] = ay; fn[k + 2] = az; bn[k] = ax; bn[k + 1] = ay; bn[k + 2] = az;
          const u = (j * COLS + i) * 2;
          fu[u] = sg * s / 0.3 + (sg < 0 ? 0.37 : 0); fu[u + 1] = y / 0.3;
          bu[u] = s / 0.05; bu[u + 1] = y / 0.05;
          if (i === 0) {
            const e0 = j * 2 * 3;
            ep[e0] = fp[k]; ep[e0 + 1] = y; ep[e0 + 2] = fp[k + 2];
            ep[e0 + 3] = bp[k]; ep[e0 + 4] = y; ep[e0 + 5] = bp[k + 2];
            const ex = -sg * out.tx, ez = -out.tz; // edge faces inward
            en[e0] = ex; en[e0 + 1] = 0; en[e0 + 2] = ez; en[e0 + 3] = ex; en[e0 + 4] = 0; en[e0 + 5] = ez;
          }
        }
        // tape: meets at the centre above the top stop
        const tIn = y > Y_TOP + 0.006 ? -0.003 : TAPE_IN;
        for (let i = 0; i < TCOLS; i++) {
          const s = tIn + (TAPE_OUT - tIn) * i / (TCOLS - 1);
          curve(s, rp, Wp, out);
          const k = (j * TCOLS + i) * 3;
          tp[k] = sg * out.x + sg * out.nx * 0.0005; tp[k + 1] = y; tp[k + 2] = out.z + out.nz * 0.0005;
          tn[k] = sg * out.nx; tn[k + 1] = 0; tn[k + 2] = out.nz;
          const u = (j * TCOLS + i) * 2; tu[u] = s / 0.022; tu[u + 1] = y / 0.022;
        }
      }
      sd.front.attributes.position.needsUpdate = true; sd.front.attributes.normal.needsUpdate = true;
      sd.back.attributes.position.needsUpdate = true; sd.back.attributes.normal.needsUpdate = true;
      sd.tape.attributes.position.needsUpdate = true; sd.tape.attributes.normal.needsUpdate = true;
      sd.edge.attributes.position.needsUpdate = true; sd.edge.attributes.normal.needsUpdate = true;
      if (!sd.uvDone) { sd.front.attributes.uv.needsUpdate = true; sd.back.attributes.uv.needsUpdate = true; sd.tape.attributes.uv.needsUpdate = true; sd.uvDone = true; }

      // teeth
      const { M, X, Y, Z, P } = this.tm || (this.tm = { M: new THREE.Matrix4(), X: new THREE.Vector3(), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(), P: new THREE.Vector3() });
      for (let k = 0; k < sd.toothY.length; k++) {
        const y = sd.toothY[k];
        const rp = rowParams(y, st, Wp);
        curve(S_TOOTH, rp, Wp, out);
        // tooth axis follows the tangent; left side uses a mirrored geometry so the basis stays right-handed
        if (sg > 0) X.set(out.tx, 0, out.tz); else X.set(out.tx, 0, -out.tz);
        Z.set(sg * out.nx, 0, out.nz);
        P.set(sg * out.x, y, out.z + 0.0005);
        M.makeBasis(X, Y, Z).setPosition(P);
        sd.teeth.setMatrixAt(k, M);
      }
      sd.teeth.instanceMatrix.needsUpdate = true;
      // stitches
      let c = 0;
      for (const sr of STITCH_ROWS) {
        for (let k = 0; k < sd.stitchN; k++) {
          const y = Y_MIN + 0.01 + k * STITCH_PITCH + (sr > 0.14 ? STITCH_PITCH * 0.5 : 0);
          const rp = rowParams(y, st, Wp);
          curve(sr, rp, Wp, out);
          if (sg > 0) X.set(out.tx, 0, out.tz); else X.set(out.tx, 0, -out.tz);
          Z.set(sg * out.nx, 0, out.nz);
          const off = LEA_Z + LEA_T + 0.0002;
          P.set(sg * (out.x + out.nx * off), y, out.z + out.nz * off);
          M.makeBasis(X, Y, Z).setPosition(P);
          sd.stitch.setMatrixAt(c, M);
          P.set(sg * (out.x + out.nx * (off + 0.0003)), y, out.z + out.nz * (off + 0.0003));
          M.setPosition(P); sd.holes.setMatrixAt(c++, M);
        }
      }
      sd.stitch.instanceMatrix.needsUpdate = true; sd.holes.instanceMatrix.needsUpdate = true;
      // top stop
      {
        const rp = rowParams(Y_TOP + 0.012, st, Wp);
        curve(0.012, rp, Wp, out);
        if (sg > 0) X.set(out.tx, 0, out.tz); else X.set(out.tx, 0, -out.tz);
        Z.set(sg * out.nx, 0, out.nz);
        M.makeBasis(X, Y, Z).setPosition(sg * out.x, Y_TOP + 0.012, out.z + 0.002);
        sd.topStop.matrixAutoUpdate = false; sd.topStop.matrix.copy(M);
      }
    }
    // slider: centred on the chain, rides away with the right side once the zip separates
    {
      const stG = { ys: st.ys, g: st.g, open1: 0 };
      const rp = rowParams(st.ys, stG, Wp);
      curve(0, rp, Wp, out);
      const X = new THREE.Vector3(out.tx, 0, out.tz), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(out.nx, 0, out.nz);
      const M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(out.x - rp.e * 0 , st.ys, out.z);
      this.slider.matrixAutoUpdate = false; this.slider.matrix.copy(M);
      // swing the pull and the tab
      this.pullPivot.rotation.set(-this.tab.ax, 0, this.tab.az);
      this.tabPivot.rotation.set(-this.tab.ax * 0.5 + 0.03, 0, this.tab.az * 0.4);
    }
    // fade the page shadow as the panels leave
    this.shadowPlane.material.opacity = 0.32 * (1 - smooth(0.6, 1, st.g));
    this.root.style.setProperty('--lgz-vig', String(1 - smooth(0.1, 0.7, st.g)));
  }

  render() {
    if (!this.renderer || this.dead) return;
    this.updateGeometry();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------- timeline
  setP(P) {
    this.P = clamp(P);
    const p1 = clamp(this.P / 0.56), g = clamp((this.P - 0.56) / 0.44);
    this.state.ys = YS0 + (YS1 - YS0) * easeSlider(p1);
    this.state.g = g;
    this.state.open1 = smooth(0, 0.16, YS0 - this.state.ys);
  }
  // pendulum: the pull lifts off the chain while the slider accelerates, settles with a little overshoot
  stepTab(dt) {
    const v = (this.state.ys - this.prevYs) / dt;
    const acc = (v - this.prevV) / dt;
    this.prevYs = this.state.ys; this.prevV = v;
    const tb = this.tab;
    const restX = 0.06 + Math.min(0.5, Math.abs(v) * 0.35) + this.state.g * 0.6;
    const fx = -60 * (tb.ax - restX) - 9 * tb.vx + clamp(-acc * 0.02, -8, 8);
    tb.vx += fx * dt; tb.ax += tb.vx * dt;
    tb.ax = clamp(tb.ax, -0.05, 1.1);
    const fz = -45 * tb.az - 4 * tb.vz + (this.state.g > 0 ? 2.4 * Math.sin(this.state.g * 9) * (1 - this.state.g) : 0);
    tb.vz += fz * dt; tb.az += tb.vz * dt;
  }
  simulateTo(P) {
    this.tab = { ax: 0.06, vx: 0, az: 0, vz: 0 };
    this.setP(0); this.prevYs = this.state.ys; this.prevV = 0;
    const dur = 1.85, dt = 1 / 120, steps = Math.round(P * dur / dt);
    for (let i = 1; i <= steps; i++) { this.setP(i * dt / dur); this.stepTab(dt); }
    this.setP(P);
  }

  bindInput() {
    const root = this.root;
    root.style.touchAction = 'none';
    const worldY = (e) => {
      const r = root.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width * 2 - 1) * this.aspect, y: 1 - (e.clientY - r.top) / r.height * 2 };
    };
    root.addEventListener('pointerdown', (e) => {
      const w = worldY(e);
      const onPull = Math.abs(w.x) < 0.14 && w.y < this.state.ys + 0.11 && w.y > this.state.ys - 0.62;
      if (onPull && this.P < 0.56) {
        this.mode = 'drag'; this.grabOff = this.state.ys - w.y; root.setPointerCapture(e.pointerId); root.classList.add('is-grabbing');
        clearTimeout(this.autoTimer);
      } else this.play();
    });
    root.addEventListener('pointermove', (e) => {
      if (this.mode !== 'drag') return;
      const ys = clamp(worldY(e).y + this.grabOff, YS1, YS0);
      // invert the slider easing to get progress for this position
      const target = (YS0 - ys) / (YS0 - YS1);
      let lo = 0, hi = 1; for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (easeSlider(mid) < target) lo = mid; else hi = mid; }
      this.dragTo = lo * 0.56;
      if (target > 0.97) this.play();
      this.kick();
    });
    const up = () => { if (this.mode === 'drag') { root.classList.remove('is-grabbing'); this.play(); } };
    root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
    this.onWheel = () => this.play();
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('keydown', this.onKey = (e) => { if (e.key === 'Escape') this.finish(true); else if (['ArrowDown', 'PageDown', ' ', 'End'].includes(e.key)) this.play(); });
    root.addEventListener('touchmove', () => this.play(), { passive: true });
  }

  start() {
    this.last = performance.now();
    // the beat before auto-play counts from mount, so a slow load does not stack on top of it
    const since = performance.now() - (this.t0 || performance.now());
    if (this.opts.auto !== false) this.autoTimer = setTimeout(() => this.play(), Math.max(150, (this.opts.delay ?? 1200) - since));
    // never hold the page: hard stop at ~3.4 s after mount
    this.hardStop = setTimeout(() => { if (!this.dead && (this.mode === 'idle' || this.mode === 'drag')) this.play(2.2); }, 2300);
    this.kick();
  }
  play(speed = 1) {
    if (this.mode === 'seek' || this.dead) return;
    clearTimeout(this.autoTimer);
    this.mode = 'auto'; this.speed = Math.max(this.speed || 1, speed);
    this.kick();
  }
  kick() {
    if (this.raf || this.dead) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }
  loop = (now) => {
    this.raf = 0;
    if (this.dead || this.mode === 'seek') return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (this.mode === 'auto') this.P = Math.min(1, this.P + dt / 1.85 * (this.speed || 1));
    else if (this.mode === 'drag' && this.dragTo != null) this.P += (this.dragTo - this.P) * Math.min(1, dt * 18);
    if (this.mode !== 'idle') {
      // integrate the pull in small steps
      const n = Math.max(1, Math.round(dt / (1 / 120))), P0 = this.prevP ?? this.P;
      for (let i = 1; i <= n; i++) { this.setP(P0 + (this.P - P0) * i / n); this.stepTab(dt / n); }
      this.prevP = this.P;
    }
    if (this.visible) this.render();
    if (this.P >= 1) return this.finish(false);
    if (this.mode !== 'idle' || this.visible) this.raf = requestAnimationFrame(this.loop);
  };

  seek(t) {
    if (!this.renderer) return;
    this.mode = 'seek'; clearTimeout(this.autoTimer); clearTimeout(this.hardStop);
    this.simulateTo(clamp(t));
    this.render();
  }

  finish(skipped) {
    if (this.dead) return;
    this.dead = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* private mode */ }
    clearTimeout(this.autoTimer); clearTimeout(this.hardStop);
    cancelAnimationFrame(this.raf);
    window.removeEventListener('wheel', this.onWheel); window.removeEventListener('keydown', this.onKey);
    this.ro?.disconnect(); this.io?.disconnect();
    document.documentElement.classList.remove('lgz-pending');
    const root = this.root, skip = this.skip;
    root.classList.add('is-done'); skip?.remove();
    setTimeout(() => {
      root.remove();
      if (this.renderer) { this.renderer.dispose(); this.renderer.forceContextLoss?.(); }
    }, skipped ? 260 : 120);
    (this.el || document).dispatchEvent?.(new CustomEvent('lgzipper:done', { bubbles: true, detail: { skipped } }));
  }
}

let current = null;
function prefersReduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

async function mount(el, options = {}) {
  const opts = Object.assign({ color: 'oxblood', metal: 'brass', auto: true, force: false }, options);
  let done = false; try { done = sessionStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }
  if (!opts.force && (done || prefersReduced())) { document.documentElement.classList.remove('lgz-pending'); return null; }
  if (current) current.finish(true);
  const z = new Zipper(el || document.body, opts);
  current = z; z.t0 = performance.now();
  z.buildDom();
  // assets must be in within ~5 s (the closed-jacket poster covers the page meanwhile), otherwise reveal the page without the show
  const t0 = performance.now();
  try {
    // preload grain images for the tab textures
    [z._alb, z._nor] = await Promise.all([loadImage(BASE + 'tex/leather_albedo.jpg'), loadImage(BASE + 'tex/leather_normal.jpg')]);
    if (!opts.force && performance.now() - t0 > 4500) { z.finish(true); return null; }
    await z.init();
  } catch (err) {
    console.warn('[LGFx.zipper] falling back:', err);
    z.finish(true); return null;
  }
  if (z.dead) return null;
  if (!opts.force && performance.now() - t0 > 5000) { z.finish(true); return null; }
  z.start();
  return z;
}

window.LGFx = window.LGFx || {};
window.LGFx.zipper = {
  mount,
  seek: (t) => current && current.seek(t),
  play: () => current && current.play(),
  skip: () => current && current.finish(true),
  get instance() { return current; },
};
export default window.LGFx.zipper;
