/* =====================================================================
   PAGE CRÉDITS : la danseuse sur sa boîte à musique (Three.js r128 + GLTFLoader, chargés avant ce fichier)
   Reprise de la scène du réveil, sans le réveil (heure, clé, plaque, barre, geste, clics, wake lock).
   Utilisation : const s = window.createCreditsScene({ container, audio, totalSeconds, ... });
   s.start() lance la danse et la musique pendant totalSeconds, puis la danseuse ralentit et la musique s'éteint.
   ===================================================================== */
(function () {
'use strict';

const MODEL_URL = '/assets/ballerine.glb';   // le modèle 3D est un fichier séparé (binaire) : servi tel quel
const NOTE_MS = 330;                          // une note toutes les 0,33 s (24 notes ≈ 7,9 s par mélodie)
const DIR = -1;                               // sens de rotation (horaire)

function createCreditsScene(opts) {
const THREE = window.THREE;
const { container, audio: ctx, totalSeconds } = opts;
const DECEL_MS = (opts.decelSeconds || 4) * 1000;   // durée de la décélération finale
let disposed = false;

/* =====================================================================
   OUTILS
   ===================================================================== */
const col = h => new THREE.Color(h).convertSRGBToLinear();
const mat = (h, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.7, metalness: 0 }, o, { color: col(h) }));
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 2; return t;
}

/* =====================================================================
   SCÈNE, CAMÉRA, LUMIÈRES
   ===================================================================== */
const scene = new THREE.Scene();
scene.background = col(0xd8d3cb);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 60);
const MOBILE = matchMedia('(pointer:coarse)').matches || Math.min(innerWidth, innerHeight) < 700;
const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE && devicePixelRatio < 1.5, powerPreference: 'high-performance' });
renderer.setPixelRatio(MOBILE ? Math.min(devicePixelRatio, 1.25) : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;      // les ombres ne sont recalculées que quand la danseuse bouge
renderer.domElement.style.display = 'block';
renderer.domElement.style.touchAction = 'none';
container.appendChild(renderer.domElement);

// environnement : une pièce lumineuse avec grandes fenêtres, pour des reflets réalistes sur la peau, le satin, l'or
(function () {
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.72, 0.68, 0.62), side: THREE.BackSide })));
  const win = (x, y, z, w, hh, ry, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 0.97, k * 0.92), side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; es.add(m); };
  win(-11.5, 4, 2, 8, 7, Math.PI / 2, 7); win(11.5, 4, -3, 6, 6, Math.PI / 2, 3.5); win(0, 5, -11.5, 10, 6, 0, 4); win(0, 6.8, 0, 6, 1, 0, 0.1);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 2.0), side: THREE.DoubleSide })); top.rotation.x = Math.PI / 2; top.position.y = 6.9; es.add(top);
  scene.environment = pm.fromScene(es, 0.03).texture; pm.dispose();
  es.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
})();
scene.add(new THREE.HemisphereLight(col(0xfff6ee), col(0xa59482), 0.4));
const key1 = new THREE.DirectionalLight(col(0xfff0e0), 1.5);
key1.position.set(-3.5, 5.5, 4.5); key1.target.position.set(0, 1.5, 0); key1.castShadow = true;
key1.shadow.mapSize.set(MOBILE ? 512 : 1024, MOBILE ? 512 : 1024); key1.shadow.bias = -0.0006; key1.shadow.normalBias = 0.02;
Object.assign(key1.shadow.camera, { left: -2.8, right: 2.8, top: 4.2, bottom: -0.6, near: 2, far: 14 });
scene.add(key1, key1.target);
const rim = new THREE.DirectionalLight(col(0xe3ecff), 0.9);
rim.position.set(3.5, 3.5, -4); rim.target.position.set(0, 1.6, 0); scene.add(rim, rim.target);

/* =====================================================================
   LA SALLE : parquet, murs à boiseries
   ===================================================================== */
const R = rng(7);
const floorTex = canvasTex(512, 512, (g, w, h) => {
  const rows = 8, rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -R() * 120;
    while (x < w) {
      const len = 120 + R() * 150;
      g.fillStyle = `hsl(${31 + R() * 6},${40 + R() * 10}%,${66 + R() * 12}%)`;
      g.fillRect(x, r * rh, len, rh);
      g.strokeStyle = 'rgba(95,62,35,0.40)'; g.lineWidth = 1.5; g.strokeRect(x, r * rh, len, rh);
      for (let k = 0; k < 7; k++) { g.strokeStyle = 'rgba(125,88,52,0.12)'; g.beginPath(); const yy = r * rh + R() * rh; g.moveTo(x, yy); g.lineTo(x + len, yy + (R() - 0.5) * 3); g.stroke(); }
      x += len;
    }
  }
}, 14, 10);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 13), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }));
floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 2.2); floor.receiveShadow = true; scene.add(floor);

const WALL_Z = -3.8;
const wall = new THREE.Mesh(new THREE.PlaneGeometry(22, 7.5), mat(0xe9e5df, { roughness: 0.95 }));
wall.position.set(0, 3.75, WALL_Z); scene.add(wall);

// halo lumineux derrière la danseuse (contre-jour)
const haloTex = canvasTex(256, 256, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,252,247,0.85)'); gr.addColorStop(1, 'rgba(255,252,247,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const halo = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false }));
halo.position.set(0, 2.6, WALL_Z + 0.02); scene.add(halo);

const trimM = mat(0xf3f0eb, { roughness: 0.8 });
const fieldM = mat(0xe4e0da, { roughness: 0.95 });
const beadGeo = new THREE.SphereGeometry(0.012, 5, 3);
function beadsAround(w, h, sp) {
  const out = [];
  for (let x = -w / 2; x <= w / 2 + 1e-6; x += sp) { out.push([x, h / 2], [x, -h / 2]); }
  for (let y = -h / 2 + sp; y < h / 2 - 1e-6; y += sp) { out.push([-w / 2, y], [w / 2, y]); }
  return out;
}
function panel(cx, cy, w, h) {
  const g = new THREE.Group(), t = 0.07, d = 0.05;
  [[0, h / 2 - t / 2, w, t], [0, -h / 2 + t / 2, w, t], [-w / 2 + t / 2, 0, t, h], [w / 2 - t / 2, 0, t, h]].forEach(([x, y, ww, hh]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, d), trimM); m.position.set(x, y, d / 2); g.add(m);
  });
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(w - 2 * t, h - 2 * t), fieldM); inner.position.z = 0.006; g.add(inner);
  const iw = w - 0.36, ih = h - 0.36;                          // second cadre fin, plus petit
  [[0, ih / 2, iw, 0.022], [0, -ih / 2, iw, 0.022], [-iw / 2, 0, 0.022, ih], [iw / 2, 0, 0.022, ih]].forEach(([x, y, ww, hh]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, 0.03), trimM); m.position.set(x, y, 0.02); g.add(m);
  });
  const bp = Math.abs(cx) > 5 ? [] : beadsAround(w - 0.22, h - 0.22, 0.055);           // petite frise de perles
  const beads = new THREE.InstancedMesh(beadGeo, trimM, bp.length); const dm = new THREE.Object3D();
  bp.forEach(([x, y], i) => { dm.position.set(x, y, 0.03); dm.updateMatrix(); beads.setMatrixAt(i, dm.matrix); });
  g.add(beads);
  g.position.set(cx, cy, WALL_Z); scene.add(g);
}
[-6.8, -3.4, 0, 3.4, 6.8].forEach(x => { panel(x, 3.25, 2.8, 3.25); panel(x, 0.72, 2.8, 0.95); });
const rail = new THREE.Mesh(new THREE.BoxGeometry(22, 0.1, 0.1), trimM); rail.position.set(0, 1.42, WALL_Z + 0.05); scene.add(rail);
const base = new THREE.Mesh(new THREE.BoxGeometry(22, 0.22, 0.08), trimM); base.position.set(0, 0.11, WALL_Z + 0.04); scene.add(base);

const woodTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#4d281a'; g.fillRect(0, 0, w, h);
  const r = rng(3);
  for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${r() < .5 ? '40,18,10' : '130,80,55'},${0.05 + r() * 0.12})`; g.lineWidth = 0.6 + r() * 1.4; g.beginPath(); const y = r() * h; g.moveTo(0, y); g.bezierCurveTo(w * .3, y + (r() - .5) * 6, w * .7, y + (r() - .5) * 6, w, y + (r() - .5) * 4); g.stroke(); }
});
const boxStart = scene.children.length;
// ombre de contact sous la boîte : le monument se termine nettement
{ const sc = document.createElement('canvas'); sc.width = sc.height = 256; const g = sc.getContext('2d'), gr = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  gr.addColorStop(0, 'rgba(40,25,15,0.55)'); gr.addColorStop(0.6, 'rgba(40,25,15,0.22)'); gr.addColorStop(1, 'rgba(40,25,15,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 3.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.004; scene.add(sh); }
const PLINTH_TOP = 1.02, FRONT_Z = 1.0, KEY_Y = 0.575;      // plateau tournant = 1.02

const dancer = new THREE.Group(); scene.add(dancer);
const goldM = new THREE.MeshStandardMaterial({ color: col(0xd9a63c), metalness: 0.9, roughness: 0.26, envMapIntensity: 1.0 });
const brassD = new THREE.MeshStandardMaterial({ color: col(0xa97a28), metalness: 0.85, roughness: 0.38, envMapIntensity: 0.9 });

/* =====================================================================
   LA BOÎTE À MUSIQUE : coffret d'acajou verni, filets dorés, intérieur en velours, plateau tournant en laiton
   ===================================================================== */
const woodBox = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.34, envMapIntensity: 0.75 });
const woodDark = new THREE.MeshStandardMaterial({ map: woodTex, color: col(0xb89a8a), roughness: 0.4, envMapIntensity: 0.6 });
const velvet = new THREE.MeshStandardMaterial({ color: col(0x7a1624), roughness: 1, metalness: 0 });
const SEG = 64, RB = 1.0;
const cyl = (r1, r2, h, m, y) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, SEG), m); o.position.y = y; o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
const tor = (r, t, m, y) => { const o = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, SEG), m); o.rotation.x = Math.PI / 2; o.position.y = y; o.castShadow = true; scene.add(o); return o; };
const ring = (n, r, y, geo, m) => { const im = new THREE.InstancedMesh(geo, m, n), d = new THREE.Object3D(); for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; d.position.set(Math.sin(a) * r, y, Math.cos(a) * r); d.rotation.set(0, a, 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); } im.castShadow = true; scene.add(im); return im; };

// socle moulé (plinthe, doucine)
cyl(1.2, 1.24, 0.09, woodDark, 0.045);
cyl(1.02, 1.17, 0.07, woodDark, 0.125);
// corps cylindrique d'acajou
cyl(RB, RB, 0.83, woodBox, 0.55);
tor(RB, 0.022, goldM, 0.19); tor(RB, 0.022, goldM, 0.93);
ring(72, RB + 0.012, 0.905, new THREE.SphereGeometry(0.016, 6, 4), goldM);
ring(72, RB + 0.012, 0.215, new THREE.SphereGeometry(0.016, 6, 4), goldM);
// pilastres dorés + losanges et médaillons (sauf devant : le médaillon central)
const pil = new THREE.BoxGeometry(0.075, 0.6, 0.035), diam = new THREE.OctahedronGeometry(0.05, 0), medal = new THREE.CylinderGeometry(0.055, 0.055, 0.02, 12);
const sel = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
{ const im = new THREE.InstancedMesh(pil, goldM, 11), d = new THREE.Object3D(); sel.forEach((i, k) => { const a = i / 12 * Math.PI * 2; d.position.set(Math.sin(a) * (RB + 0.008), 0.575, Math.cos(a) * (RB + 0.008)); d.rotation.set(0, a, 0); d.updateMatrix(); im.setMatrixAt(k, d.matrix); }); im.castShadow = true; scene.add(im);
  const im2 = new THREE.InstancedMesh(diam, goldM, 12); for (let i = 0; i < 12; i++) { if (i === 0 || i === 11) continue; const a = (i + 0.5) / 12 * Math.PI * 2; d.position.set(Math.sin(a) * (RB + 0.02), 0.575, Math.cos(a) * (RB + 0.02)); d.rotation.set(0, a, 0); d.scale.set(1.0, 1.9, 0.5); d.updateMatrix(); im2.setMatrixAt(i - 1, d.matrix); } im2.count = 10; scene.add(im2);
  const im3 = new THREE.InstancedMesh(medal, goldM, 24); let k = 0; d.rotation.order = 'YXZ'; for (let i = 0; i < 12; i++) { if (i === 0 || i === 11) continue; const a = (i + 0.5) / 12 * Math.PI * 2; [0.34, 0.8].forEach(y => { d.position.set(Math.sin(a) * (RB + 0.01), y, Math.cos(a) * (RB + 0.01)); d.scale.set(0.55, 1, 0.55); d.rotation.set(Math.PI / 2, a, 0); d.updateMatrix(); im3.setMatrixAt(k++, d.matrix); }); } im3.count = k; scene.add(im3); }
// médaillon doré devant (cartouche décoratif)
{ const m1 = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 12, 48), goldM); m1.position.set(0, KEY_Y, FRONT_Z + 0.004); scene.add(m1);
  const m2 = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.01, 10, 48), goldM); m2.position.set(0, KEY_Y, FRONT_Z + 0.004); scene.add(m2);
  const beadG = new THREE.SphereGeometry(0.018, 6, 4);
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, b = new THREE.Mesh(beadG, goldM); b.position.set(Math.cos(a) * 0.29, KEY_Y + Math.sin(a) * 0.29, FRONT_Z + 0.006); scene.add(b); } }
// corniche : doucine renversée, tore doré, couronne de perles
cyl(RB + 0.07, RB, 0.07, woodDark, 0.965);
tor(RB + 0.075, 0.026, goldM, 1.0);
ring(64, RB + 0.07, 0.99, new THREE.SphereGeometry(0.02, 6, 4), goldM);
ring(24, RB + 0.07, 1.03, new THREE.SphereGeometry(0.032, 8, 6), goldM);
cyl(RB + 0.06, RB + 0.06, 0.012, woodDark, 1.0);
// velours du plateau
cyl(RB - 0.04, RB - 0.04, 0.02, velvet, 0.99);
tor(RB - 0.04, 0.014, goldM, 1.0);

// plateau tournant (tourne avec la danseuse) : disque de laiton, étoile dorée gravée
const turntable = new THREE.Group(); turntable.position.set(0, PLINTH_TOP, 0); scene.add(turntable);
const ttDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.55, 0.045, 64), brassD); ttDisc.position.y = -0.0225; turntable.add(ttDisc);
const ttRing = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.014, 12, 64), goldM); ttRing.rotation.x = Math.PI / 2; turntable.add(ttRing);
for (let i = 0; i < 12; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.004, i % 2 ? 0.014 : 0.026), goldM); r.rotation.y = i * Math.PI / 6; r.position.y = 0.002; turntable.add(r); }
const ttBoss = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.012, 32), goldM); ttBoss.position.y = 0.004; turntable.add(ttBoss);
turntable.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
// tout le socle est regroupé et réduit pour laisser la place à la danseuse
const BOX_S = 0.88, boxG = new THREE.Group(); boxG.scale.setScalar(BOX_S); scene.add(boxG);
scene.children.slice(boxStart).filter(o => o !== dancer && o !== boxG).forEach(o => boxG.add(o));

/* =====================================================================
   SON : boîte à musique synthétisée (le contexte audio est déverrouillé par le clic sur « Crédits » ou « Lancer »)
   ===================================================================== */
let volume = opts.volume == null ? 0.8 : opts.volume;
const volGain = v => v * v * 2.2;                      // courbe de volume plus naturelle pour l'oreille
const master = ctx.createGain(); master.gain.value = 0;
const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -8; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.12;
master.connect(comp); comp.connect(ctx.destination);   // évite la saturation quand le volume est fort
function playNote(f, vol = 0.22) {
  const t = ctx.currentTime, g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5); g.connect(master);
  [[1, 1], [2.76, 0.4], [5.4, 0.22], [8.93, 0.1]].forEach(([m, a]) => { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * m; og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(t + 1.6); });
}
const melody = [0, 4, 7, 12, 7, 4, 2, 5, 9, 14, 9, 5, 4, 7, 11, 16, 11, 7, 0, 4, 7, 12, 7, 4];
let noteIdx = 0, noteTimer = null;
function nextNote() { playNote(523.25 * Math.pow(2, melody[noteIdx % melody.length] / 12)); noteIdx++; }

/* =====================================================================
   DÉROULEMENT : idle → playing (totalSeconds) → ending (décélération + fondu) → done
   Un seul « tempo » (1 → 0) commande la musique ET la danseuse : une note = toujours le même angle de rotation.
   ===================================================================== */
let state = 'idle', seqStart = 0, endStart = 0, tempo = 0;
const moving = () => state === 'playing' || state === 'ending';
function tick() {
  if (!moving() || tempo < 0.18) return;               // en fin de décélération, les dernières notes s'espacent puis s'arrêtent
  nextNote();
  noteTimer = setTimeout(tick, NOTE_MS / tempo);
}
function start() {
  clearTimeout(noteTimer);
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(volGain(volume), t);
  state = 'playing'; tempo = 1; noteIdx = 0; seqStart = performance.now(); forceDraw = true;
  tick();
}
function beginEnding(now) {
  state = 'ending'; endStart = now;
  const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + DECEL_MS / 1000);   // fondu
  if (opts.onEnding) opts.onEnding();
}

/* =====================================================================
   LA DANSEUSE : modèle 3D (fichier .glb séparé)
   Mise à l'échelle, pied d'appui posé sur le socle, rotation autour de ce pied.
   ===================================================================== */
let customDancer = null;
const spinner = () => customDancer || dancer;
function eachVertex(root, fn) {
  const v = new THREE.Vector3(); root.updateMatrixWorld(true);
  root.traverse(o => { if (!o.isMesh || !o.geometry.attributes.position) return; const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); fn(v); } });
}
function useModel(root) {
  let minY = Infinity, maxY = -Infinity; eachVertex(root, v => { if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; });
  root.scale.multiplyScalar(2.8 / (maxY - minY));
  let lo = Infinity, hi = -Infinity; eachVertex(root, v => { if (v.y < lo) lo = v.y; if (v.y > hi) hi = v.y; });
  let sx = 0, sz = 0, n = 0; eachVertex(root, v => { if (v.y < lo + 0.012 * (hi - lo)) { sx += v.x; sz += v.z; n++; } });   // l'axe passe par la pointe
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    if (o.material) { o.material.envMapIntensity = 0.7; o.material.roughness = Math.max(o.material.roughness, 0.55);
    ['map', 'normalMap', 'roughnessMap'].forEach(k => { if (o.material[k]) o.material[k].anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); }); } } });
  root.position.set(-(n ? sx / n : 0), -lo, -(n ? sz / n : 0));
  customDancer = new THREE.Group(); customDancer.add(root); customDancer.position.y = PLINTH_TOP * BOX_S;
  customDancer.rotation.y = dancer.rotation.y;          // si la danse a déjà commencé, elle reprend au même angle
  scene.add(customDancer); shadowDirty = true; forceDraw = true;
}
new THREE.GLTFLoader().load(MODEL_URL, gltf => { if (disposed) return; useModel(gltf.scene); if (opts.onLoaded) opts.onLoaded(); },
  undefined, err => { if (disposed) return; console.error(err); if (opts.onError) opts.onError((err && err.message) || String(err)); });

/* =====================================================================
   CAMÉRA : cadrage adaptatif + parallaxe (inclinaison du téléphone), poussière dorée
   ===================================================================== */
const motes = (() => {
  const n = MOBILE ? 16 : 28, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 4.6; pos[i * 3 + 1] = 0.4 + Math.random() * 3.8; pos[i * 3 + 2] = -1.4 + Math.random() * 3.2; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(184,148,106,1)'); gr.addColorStop(0.45, 'rgba(198,166,128,0.7)'); gr.addColorStop(1, 'rgba(205,176,140,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  const p = new THREE.Points(g, new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: 0.22, transparent: true, opacity: 0.75, depthWrite: false, fog: false }));
  p.userData = { pos, vel: Float32Array.from({ length: n }, () => 0.12 + Math.random() * 0.22), ph: Float32Array.from({ length: n }, () => Math.random() * 6.28) };
  p.frustumCulled = false; scene.add(p); return p;
})();
const FOV = 38, LOOK = new THREE.Vector3(0, 1.8, 0);
let camDist = 6.5, tiltX = 0, tiltY = 0, sx = 0, sy = 0;
function frame() {
  const a = innerWidth / innerHeight, t = Math.tan(FOV * Math.PI / 360);
  camera.aspect = a; camera.fov = FOV; camera.updateProjectionMatrix();
  camDist = Math.max(4.25 / (2 * t), 3.2 / (2 * t * a));
  renderer.setSize(innerWidth, innerHeight);
}
const onResize = () => { frame(); shadowDirty = true; forceDraw = true; };
const onTilt = e => { if (e.gamma == null) return; tiltX = Math.max(-1, Math.min(1, e.gamma / 30)); tiltY = Math.max(-1, Math.min(1, (e.beta - 50) / 30)); };
addEventListener('resize', onResize); addEventListener('deviceorientation', onTilt); frame();

/* =====================================================================
   QUALITÉ : paliers automatiques (Auto) ou forcés (Max / Éco)
   ===================================================================== */
let forceDraw = true, last = performance.now(), lastDraw = 0, tier = 0, accT = 0, accN = 0, shadowDirty = true, frameNo = 0, frozen = false;
let adapt = true;
const bootT = performance.now();
function setTier(t, prOverride) {
  forceDraw = true;           // 0 = pleine définition ; 1 = définition réduite ; 2 = 1x ; 3 = sans ombres
  tier = t; motes.visible = t < 2; renderer.setPixelRatio(prOverride || (MOBILE ? [Math.min(devicePixelRatio, 1.25), 1, 0.85, 0.7] : [Math.min(devicePixelRatio, 1.5), Math.min(devicePixelRatio, 1.25), 1, 0.85])[t]); renderer.setSize(innerWidth, innerHeight);
  const sh = t < 3; if (renderer.shadowMap.enabled !== sh) { renderer.shadowMap.enabled = sh; shadowDirty = true; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); }
}
function setQuality(m) {        // 0 = Auto, 1 = Max, 2 = Éco
  adapt = m === 0;
  if (m === 1) setTier(0, Math.min(devicePixelRatio, 2)); else setTier(m === 2 ? 2 : 0); accT = 0; accN = 0;
}
setQuality(opts.quality || 0);

/* =====================================================================
   BOUCLE DE RENDU : pleine cadence pendant la danse, ~24 images/s au repos, figée quand le réglage est ouvert au repos
   ===================================================================== */
let raf = 0;
function animate(now) {
  raf = requestAnimationFrame(animate);
  if (frozen && !moving() && !forceDraw) return;
  const rel = now - bootT;
  const minGap = (!moving() && rel > 5000) ? 50 : (tier >= 2 ? 33 : 0);   // repos : ~24 images/s ; machine lente : 30 stables
  if (!forceDraw && now - lastDraw < minGap - 2) return;
  const raw = now - last, dt = Math.min(0.05, raw / 1000); last = now; lastDraw = now;
  if (adapt && (moving() || rel < 5000) && rel > 2000 && tier < 3) { accT += raw; accN++; if (accN >= 40) { if (accT / accN > 22) setTier(tier + 1); accT = 0; accN = 0; } }
  if (state === 'playing' && now - seqStart >= totalSeconds * 1000) beginEnding(now);
  if (state === 'ending') {
    const k = Math.min(1, (now - endStart) / DECEL_MS);
    tempo = (1 - k) * (1 - k);                                                          // décélération douce
    if (k >= 1) { state = 'done'; tempo = 0; clearTimeout(noteTimer); shadowDirty = true; if (opts.onStopped) opts.onStopped(); }
  }
  if (moving()) spinner().rotation.y += DIR * 1.1 * tempo * dt;                        // la danseuse suit exactement le rythme
  sx += (tiltX * 0.6 - sx) * 0.08; sy += (tiltY * 0.3 - sy) * 0.08;
  camera.position.set(Math.sin(now / 5000) * 0.18 + sx, 1.7 - sy, camDist);
  camera.lookAt(LOOK);
  if (motes.visible) {                                       // la poussière dorée tombe du haut, en se balançant doucement
    const u = motes.userData, P = u.pos, n = u.vel.length;
    for (let i = 0; i < n; i++) {
      P[i * 3 + 1] -= u.vel[i] * dt; P[i * 3] += Math.sin(now / 1400 + u.ph[i]) * 0.05 * dt;
      if (P[i * 3 + 1] < 0.1) { P[i * 3 + 1] = 4.3 + Math.random() * 0.4; P[i * 3] = (Math.random() - 0.5) * 4.6; }
    }
    motes.geometry.attributes.position.needsUpdate = true;
  }
  key1.intensity = 1.5 + Math.sin(now / 3200) * 0.07;                                  // la lumière « respire » très légèrement
  turntable.rotation.y = spinner().rotation.y;
  if (moving() && renderer.shadowMap.enabled && (++frameNo % (MOBILE ? 4 : 2)) === 0) renderer.shadowMap.needsUpdate = true;
  else if (shadowDirty) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
  renderer.render(scene, camera); forceDraw = false;
}
raf = requestAnimationFrame(animate);

/* =====================================================================
   COMMANDES ET NETTOYAGE
   ===================================================================== */
function setVolume(v) {
  volume = v;
  if (state === 'playing') { const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(volGain(v), t); }
}
// petit son d'essai après un réglage du volume, quand la musique ne joue pas
function previewNote() {
  if (moving()) return;
  if (ctx.state === 'suspended') ctx.resume();
  const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(volGain(volume), t);
  nextNote();
}
function dispose() {
  disposed = true; state = 'done';
  cancelAnimationFrame(raf); clearTimeout(noteTimer);
  removeEventListener('resize', onResize); removeEventListener('deviceorientation', onTilt);
  try { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(0, ctx.currentTime); master.disconnect(); comp.disconnect(); } catch (e) {}
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    [].concat(o.material || []).forEach(m => { Object.keys(m).forEach(k => { if (m[k] && m[k].isTexture) m[k].dispose(); }); m.dispose(); });
  });
  if (scene.environment) scene.environment.dispose();
  renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
}

return {
  start,
  setVolume,
  setQuality,
  previewNote,
  setFrozen(v) { frozen = !!v; forceDraw = true; },
  dispose
};
}

window.createCreditsScene = createCreditsScene;
})();
