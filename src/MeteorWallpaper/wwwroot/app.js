import * as THREE from './three.module.js';
import { makeSpec, mulberry32, summarize } from './galaxy.js';

/* ------------------------------------------------------------------ *
 * Meteor wallpaper scene
 *
 * Every visible body comes from a SystemSpec (see galaxy.js): the host
 * passes ?seed=N, and the tray can push a new seed to rebuild in place.
 * ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
const seedFromUrl = Number(params.get('seed'));
const initialSeed = Number.isFinite(seedFromUrl) && seedFromUrl > 0
  ? Math.floor(seedFromUrl)
  : (Math.random() * 2147483647) | 0;

const state = {
  mode: params.get('mode') === 'earth' ? 'earth' : 'solar',
  dim: 0.6,
  fps: 30,
  paused: false,
  interactive: params.get('interactive') === '1',
  showStream: true,
  showPlanets: true,
  spin: 1
};

const host = window.chrome?.webview;
const post = (msg) => { try { host?.postMessage(msg); } catch { } };

/* ---------------------------------------------------------------- *
 * Renderer, scene, camera
 * ---------------------------------------------------------------- */

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance'
});

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.setClearColor(0x03050b, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 30000);

/* ---------------------------------------------------------------- *
 * Procedural textures (no external assets -> no licensing questions)
 * ---------------------------------------------------------------- */

function radialTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [pos, color] of stops) grd.addColorStop(pos, color);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TEX_SUN_CORE = radialTexture([
  [0.0, 'rgba(255,255,255,1)'],
  [0.18, 'rgba(255,236,190,0.95)'],
  [0.42, 'rgba(255,190,110,0.35)'],
  [0.72, 'rgba(255,140,60,0.08)'],
  [1.0, 'rgba(255,120,40,0)']
]);

const TEX_GLOW = radialTexture([
  [0.0, 'rgba(255,255,255,0.9)'],
  [0.25, 'rgba(200,225,255,0.35)'],
  [0.6, 'rgba(120,170,255,0.06)'],
  [1.0, 'rgba(80,120,255,0)']
]);

function makeSprite(texture, color, scale, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  }));
  s.scale.setScalar(scale);
  s.renderOrder = 5;
  return s;
}

/* ---------------------------------------------------------------- *
 * System state
 * ---------------------------------------------------------------- */

const world = new THREE.Group();  // sun + planets + dust belts
const sky = new THREE.Group();    // star field + milky way
scene.add(sky, world);

let spec = null;
let stars = null;
let sunMesh = null;
let sunGroup = null;
let belts = [];
let planetMeshes = [];
let viewpoint = 0;

/* ---------------------------------------------------------------- *
 * Star field
 * ---------------------------------------------------------------- */

function buildStars(rnd) {
  const count = 16000;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const c = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const r = 5000 + rnd() * 2500;
    const u = rnd() * 2 - 1;
    const t = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(t);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(t);

    const roll = rnd();
    if (roll < 0.12) c.setRGB(1.0, 0.86, 0.72);        // warm giants
    else if (roll < 0.35) c.setRGB(0.72, 0.83, 1.0);   // blue-white
    else c.setRGB(0.95, 0.96, 1.0);                    // white

    const b = 0.35 + Math.pow(rnd(), 2.2) * 0.9;
    col[i * 3] = c.r * b;
    col[i * 3 + 1] = c.g * b;
    col[i * 3 + 2] = c.b * b;

    size[i] = 0.8 + Math.pow(rnd(), 3.0) * 2.6;
    phase[i] = rnd();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 }, uPixel: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vColor = aColor;
        vTw = 0.72 + 0.28 * sin(uTime * 1.6 + aPhase * 6.2831);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize;
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        a = pow(a, 1.7);
        gl_FragColor = vec4(vColor * vTw, a * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geo, mat);
}

/* ---------------------------------------------------------------- *
 * Milky way: a dense, faint band of points
 * ---------------------------------------------------------------- */

function buildMilkyWay(s, rnd) {
  const count = 42000;
  const pos = new Float32Array(count * 3);
  const band = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(s.band[0], s.band[1], s.band[2]));

  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2;
    const spread = (rnd() + rnd() + rnd() - 1.5) * 0.22;
    const r = 4300 + rnd() * 600;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    const y = spread * r;
    const v = new THREE.Vector3(x, y, z).applyMatrix4(band);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const mat = new THREE.PointsMaterial({
    color: s.milky,
    size: 1.15,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geo, mat);
}

/* ---------------------------------------------------------------- *
 * Sun
 * ---------------------------------------------------------------- */

function buildSun(s) {
  const group = new THREE.Group();
  const g = s.glowScale;

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(s.radius, 48, 32),
    new THREE.MeshBasicMaterial({ color: s.core })
  );
  group.add(mesh);

  // Sprite scale is a world-space diameter. The 64 / 170 / 380 values were tuned
  // for radius 12 at ~360 units from the camera; everything scales with the star.
  group.add(makeSprite(TEX_SUN_CORE, s.core, 64 * g, 0.95));
  group.add(makeSprite(TEX_SUN_CORE, s.halo, 170 * g, 0.16));
  group.add(makeSprite(TEX_GLOW, s.outer, 380 * g, 0.035));

  const light = new THREE.PointLight(s.light, 3.2, 0, 0);
  group.add(light);

  return { group, mesh };
}

/* ---------------------------------------------------------------- *
 * Planets
 * ---------------------------------------------------------------- */

function buildPlanets(p) {
  const meshes = [];
  for (let i = 0; i < p.length; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(p[i].radius, 24, 18),
      new THREE.MeshBasicMaterial({ color: p[i].color })
    );
    mesh.position.set(p[i].r, 0, 0);
    world.add(mesh);
    meshes.push(mesh);
  }

  // A faint atmosphere on the "home" world makes it readable at a glance.
  const home = meshes[viewpoint];
  if (home) {
    home.add(makeSprite(TEX_GLOW, 0x8fc4ff, p[viewpoint].radius * 2.6, 0.55));
  }
  return meshes;
}

/* ---------------------------------------------------------------- *
 * Comet dust stream (parameterised)
 * ---------------------------------------------------------------- */

function streamPoint(b, theta, jitter) {
  const r = (b.a * (1 - b.e * b.e)) / (1 + b.e * Math.cos(theta));
  const x = Math.cos(theta) * r;
  const z = Math.sin(theta) * r;

  // perpendicular scatter so the stream is a ribbon, not a wire
  const nx = jitter[0];
  const ny = jitter[1];

  const v = new THREE.Vector3(x + nx, ny, z + nx * 0.4);

  // tilt the orbital plane
  v.applyAxisAngle(new THREE.Vector3(1, 0, 0), b.inc);
  v.applyAxisAngle(new THREE.Vector3(0, 1, 0), b.node);
  return v;
}

function buildBelt(b, rnd) {
  const count = b.count;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const c = new THREE.Color();
  const base = new THREE.Color(b.color);

  let i = 0;
  let guard = 0;
  while (i < count && guard < count * 40) {
    guard++;
    const theta = rnd() * Math.PI * 2;

    // density: heavier near perihelion, where the stream is densest
    const peri = Math.exp(-Math.pow((theta - Math.PI) / 1.1, 2));
    const weight = 0.25 + peri * 0.85 + rnd() * 0.55;
    if (rnd() > weight) continue;

    const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.6;
    const jitter = [gauss() * b.width, gauss() * b.width * 0.78];
    const v = streamPoint(b, theta, jitter);

    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;

    c.copy(base).offsetHSL(rnd() * 0.02 - 0.01, 0, rnd() * 0.18 - 0.09);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;

    size[i] = 0.9 + rnd() * 1.8;
    phase[i] = rnd();
    i++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.9 } },
    vertexShader: /* glsl */`
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vColor = aColor;
        vTw = 0.55 + 0.45 * sin(uTime * 0.8 + aPhase * 6.2831);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize;
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTw;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = length(d) * 2.0;
        float a = smoothstep(1.0, 0.0, r);
        a = pow(a, 2.0);
        gl_FragColor = vec4(vColor, a * uOpacity * vTw);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  return new THREE.Points(geo, mat);
}

/* ---------------------------------------------------------------- *
 * Meteors (earth mode)
 * ---------------------------------------------------------------- */

const METEOR_COUNT = 46;
const meteorGeo = new THREE.BufferGeometry();
const meteorPos = new Float32Array(METEOR_COUNT * 6);
const meteorCol = new Float32Array(METEOR_COUNT * 6);
meteorGeo.setAttribute('position', new THREE.BufferAttribute(meteorPos, 3));
meteorGeo.setAttribute('color', new THREE.BufferAttribute(meteorCol, 3));

const meteorLines = new THREE.LineSegments(meteorGeo, new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  blending: THREE.AdditiveBlending
}));
meteorLines.frustumCulled = false;
meteorLines.visible = false;
scene.add(meteorLines);

const meteors = [];
for (let i = 0; i < METEOR_COUNT; i++) {
  meteors.push({ alive: false, life: 0, maxLife: 1, head: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, len: 0 });
}

const RADIANT_LOCAL = new THREE.Vector3(0.42, 0.34, 0.84).normalize();

function spawnMeteor() {
  const m = meteors.find(x => !x.alive);
  if (!m) return;

  const spread = 260;
  const rp = RADIANT_LOCAL.clone().multiplyScalar(900).add(camera.position);
  const off = new THREE.Vector3(
    (Math.random() - 0.5) * 2,
    (Math.random() - 0.5) * 2,
    (Math.random() - 0.5) * 2
  ).normalize().multiplyScalar(Math.pow(Math.random(), 0.7) * spread);

  m.alive = true;
  m.life = 0;
  m.maxLife = 0.7 + Math.random() * 0.9;
  m.head.copy(rp).add(off);
  m.dir.copy(off).normalize();
  m.speed = 700 + Math.random() * 900;
  m.len = 40 + Math.random() * 80;
}

/* ---------------------------------------------------------------- *
 * Camera controller
 * ---------------------------------------------------------------- */

const cam = {
  azimuth: 2.2,
  elevation: 0.36,
  distance: 360,
  targetAzimuth: 2.2,
  targetElevation: 0.36,
  targetDistance: 360,
  dragging: false,
  lastX: 0,
  lastY: 0,
  autoSpeed: 0.018
};

const camEarth = { yaw: 0, pitch: 0.0, targetYaw: 0, targetPitch: 0.0 };

const earthPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();

function resetSolarCamera() {
  cam.azimuth = cam.targetAzimuth = spec.camera.azimuth;
  cam.elevation = cam.targetElevation = spec.camera.elevation;
  cam.distance = cam.targetDistance = spec.camera.distance;
}

function updateCamera(dt, time) {
  if (state.mode === 'solar') {
    if (!state.interactive) {
      cam.targetAzimuth += cam.autoSpeed * dt * state.spin;
      cam.targetElevation = spec.camera.elevation + Math.sin(time * 0.05) * 0.08;
    }
    cam.azimuth += (cam.targetAzimuth - cam.azimuth) * Math.min(1, dt * 3);
    cam.elevation += (cam.targetElevation - cam.elevation) * Math.min(1, dt * 3);
    cam.distance += (cam.targetDistance - cam.distance) * Math.min(1, dt * 2);

    const x = Math.cos(cam.azimuth) * Math.cos(cam.elevation) * cam.distance;
    const y = Math.sin(cam.elevation) * cam.distance;
    const z = Math.sin(cam.azimuth) * Math.cos(cam.elevation) * cam.distance;

    camera.position.set(x, y + 10, z);
    camera.lookAt(0, 0, 0);
  } else {
    const home = planetMeshes[viewpoint];
    home.getWorldPosition(earthPos);
    camera.position.lerp(earthPos.clone().add(new THREE.Vector3(0, spec.planets[viewpoint].radius + 16.8, 0)),
      Math.min(1, dt * 1.6));

    if (!state.interactive && !cam.dragging) camEarth.targetYaw += 0.010 * dt;
    camEarth.yaw += (camEarth.targetYaw - camEarth.yaw) * Math.min(1, dt * 3);
    camEarth.pitch += (camEarth.targetPitch - camEarth.pitch) * Math.min(1, dt * 3);

    const dir = new THREE.Vector3(
      Math.sin(camEarth.yaw) * Math.cos(camEarth.pitch),
      Math.sin(camEarth.pitch),
      Math.cos(camEarth.yaw) * Math.cos(camEarth.pitch)
    );
    lookAt.copy(camera.position).addScaledVector(dir, 140);
    camera.lookAt(lookAt);
  }
}

/* ---------------------------------------------------------------- *
 * Interaction (only meaningful in front-of-desktop mode)
 * ---------------------------------------------------------------- */

canvas.addEventListener('pointerdown', (e) => {
  if (!state.interactive) return;
  cam.dragging = true;
  cam.lastX = e.clientX;
  cam.lastY = e.clientY;
  document.body.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!cam.dragging || !state.interactive) return;
  const dx = e.clientX - cam.lastX;
  const dy = e.clientY - cam.lastY;
  cam.lastX = e.clientX;
  cam.lastY = e.clientY;

  if (state.mode === 'solar') {
    cam.targetAzimuth -= dx * 0.005;
    cam.targetElevation = THREE.MathUtils.clamp(cam.targetElevation + dy * 0.004, -1.2, 1.35);
  } else {
    camEarth.targetYaw -= dx * 0.003;
    camEarth.targetPitch = THREE.MathUtils.clamp(camEarth.targetPitch - dy * 0.0025, -0.30, 0.62);
  }
});

canvas.addEventListener('pointerup', (e) => {
  cam.dragging = false;
  document.body.classList.remove('dragging');
  try { canvas.releasePointerCapture(e.pointerId); } catch { }
});

canvas.addEventListener('wheel', (e) => {
  if (!state.interactive) return;
  e.preventDefault();
  if (state.mode === 'solar') {
    cam.targetDistance = THREE.MathUtils.clamp(cam.targetDistance * (1 + Math.sign(e.deltaY) * 0.08), 90, 1400);
  } else {
    camera.fov = THREE.MathUtils.clamp(camera.fov + Math.sign(e.deltaY) * 2, 28, 74);
    camera.updateProjectionMatrix();
  }
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.interactive) post({ type: 'exitInteract' });
});

/* ---------------------------------------------------------------- *
 * Scene construction
 * ---------------------------------------------------------------- */

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose(); // textures are shared, never disposed here
    }
  });
}

function clearGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}

function buildScene(next) {
  const t0 = performance.now();
  clearGroup(world);
  clearGroup(sky);

  spec = next;
  viewpoint = spec.viewpoint;
  planetMeshes = [];
  belts = [];

  const skyRnd = mulberry32((spec.seed ^ 0x85ebca6b) >>> 0);
  stars = buildStars(skyRnd);
  sky.add(stars);
  sky.add(buildMilkyWay(spec.sky, skyRnd));

  const sun = buildSun(spec.star);
  sunGroup = sun.group;
  sunMesh = sun.mesh;
  world.add(sunGroup);

  planetMeshes = buildPlanets(spec.planets);

  spec.belts.forEach((b, i) => {
    const belt = buildBelt(b, mulberry32((spec.seed ^ (0x9e3779b9 + i * 7919)) >>> 0));
    belts.push(belt);
    world.add(belt);
  });

  // Re-apply mode/visibility/colours now that the new bodies exist.
  setMode(state.mode);

  post({
    type: 'spec',
    value: {
      seed: spec.seed,
      planets: spec.planets.length,
      belts: spec.belts.length,
      star: spec.star.name,
      temp: spec.star.temp,
      palette: spec.palette,
      buildMs: Math.round(performance.now() - t0)
    }
  });
  post({ type: 'log', msg: 'built ' + summarize(spec) });
}

/* ---------------------------------------------------------------- *
 * Command bridge
 * ---------------------------------------------------------------- */

function applyDim() {
  renderer.toneMappingExposure = 0.35 + state.dim * 0.95;
}

function applyVisibility() {
  const earth = state.mode === 'earth';
  meteorLines.visible = earth;
  for (const b of belts) b.visible = !earth && state.showStream;
  for (let i = 0; i < planetMeshes.length; i++) {
    planetMeshes[i].visible = earth ? i === viewpoint : state.showPlanets;
  }
  if (sunGroup) sunGroup.visible = !earth;
}

function setMode(mode) {
  state.mode = mode === 'earth' ? 'earth' : 'solar';
  const earth = state.mode === 'earth';
  const home = planetMeshes[viewpoint];

  applyVisibility();
  if (home) home.material.color.setHex(earth ? 0x0a1b33 : spec.planets[viewpoint].color);

  if (earth) {
    home.getWorldPosition(earthPos);
    camera.position.copy(earthPos).add(new THREE.Vector3(0, spec.planets[viewpoint].radius + 16.8, 0));
    camEarth.yaw = camEarth.targetYaw = 0;
    camEarth.pitch = camEarth.targetPitch = 0;
    camera.fov = 52;
    camera.updateProjectionMatrix();
    for (const m of meteors) m.alive = false;
  } else {
    resetSolarCamera();
    camera.fov = 52;
    camera.updateProjectionMatrix();
  }
}

host?.addEventListener('message', (e) => {
  const data = e.data || {};
  switch (data.cmd) {
    case 'mode': setMode(data.value); break;
    case 'dim': state.dim = Number(data.value) || 0.6; applyDim(); break;
    case 'fps': state.fps = Math.max(10, Math.min(120, Number(data.value) || 30)); break;
    case 'paused': state.paused = !!data.value; break;
    case 'stream': state.showStream = !!data.value; applyVisibility(); break;
    case 'planets': state.showPlanets = !!data.value; applyVisibility(); break;
    case 'spin': state.spin = Math.max(0, Math.min(8, Number(data.value) || 0)); break;
    case 'nudge':
      cam.targetAzimuth += 0.9;
      camEarth.targetYaw += 0.9;
      break;
    case 'seed': {
      const next = Math.floor(Number(data.value));
      if (!Number.isFinite(next) || next <= 0) break;
      if (spec && next === spec.seed) break;
      buildScene(makeSpec(next));
      break;
    }
    case 'interactive':
      state.interactive = !!data.value;
      document.body.classList.toggle('interactive', state.interactive);
      if (state.interactive) showHint();
      break;
  }
});

/* ---------------------------------------------------------------- *
 * Hint overlay
 * ---------------------------------------------------------------- */

const hint = document.getElementById('hint');
let hintTimer = 0;
function showHint() {
  if (!hint) return;
  hint.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove('show'), 4200);
}

/* ---------------------------------------------------------------- *
 * Loop
 * ---------------------------------------------------------------- */

const clock = new THREE.Clock();
let elapsed = 0;
let last = performance.now();
let acc = 0;
let frames = 0;
let cometSpawn = 0;
let statFrames = 0;
let statTime = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const realDt = Math.min((now - last) / 1000, 0.25);
  last = now;

  // Heartbeat: lets the host tell "still camera" apart from "frozen / paused".
  statFrames++;
  statTime += realDt;
  if (statTime >= 5) {
    post({ type: 'stats', value: { fps: Math.round((statFrames / statTime) * 10) / 10, paused: state.paused } });
    statFrames = 0;
    statTime = 0;
  }

  if (state.paused) return;

  acc += realDt;
  const target = 1 / state.fps;
  if (acc < target) return;
  const dt = Math.min(acc, 0.1);
  acc = 0;
  elapsed += dt;

  // planets
  for (let i = 0; i < spec.planets.length; i++) {
    const p = spec.planets[i];
    const mesh = planetMeshes[i];
    const angle = p.phase + (elapsed * Math.PI * 2) / (p.period * 180);
    mesh.position.set(Math.cos(angle) * p.r, 0, Math.sin(angle) * p.r);
  }

  // uniforms
  if (stars) stars.material.uniforms.uTime.value = elapsed;
  for (const b of belts) b.material.uniforms.uTime.value = elapsed;
  if (sunMesh) sunMesh.rotation.y += dt * 0.05;

  updateCamera(dt, elapsed);

  if (state.mode === 'earth') {
    cometSpawn -= dt;
    if (cometSpawn <= 0) {
      spawnMeteor();
      cometSpawn = 0.05 + Math.random() * 0.35;
    }
    updateMeteors(dt);
  }

  renderer.render(scene, camera);

  if (++frames === 2) {
    window.__mwReady = true;
    post({ type: 'ready' });
  }
}

function updateMeteors(dt) {
  for (let i = 0; i < METEOR_COUNT; i++) {
    const m = meteors[i];
    const o = i * 6;

    if (!m.alive) {
      meteorPos.fill(0, o, o + 6);
      meteorCol.fill(0, o, o + 6);
      continue;
    }

    m.life += dt;
    if (m.life > m.maxLife) {
      m.alive = false;
      meteorPos.fill(0, o, o + 6);
      meteorCol.fill(0, o, o + 6);
      continue;
    }

    const t = m.life / m.maxLife;
    m.head.addScaledVector(m.dir, m.speed * dt);

    const tail = m.head.clone().addScaledVector(m.dir, -m.len);

    meteorPos[o] = m.head.x; meteorPos[o + 1] = m.head.y; meteorPos[o + 2] = m.head.z;
    meteorPos[o + 3] = tail.x; meteorPos[o + 4] = tail.y; meteorPos[o + 5] = tail.z;

    const fade = Math.sin(Math.PI * Math.min(1, t * 1.15));
    const b = Math.pow(1 - t, 1.4) * 1.2;
    meteorCol[o] = 0.75 * b; meteorCol[o + 1] = 0.86 * b; meteorCol[o + 2] = 1.0 * b;
    meteorCol[o + 3] = 0.35 * b * fade; meteorCol[o + 4] = 0.45 * b * fade; meteorCol[o + 5] = 0.7 * b * fade;
  }

  meteorGeo.attributes.position.needsUpdate = true;
  meteorGeo.attributes.color.needsUpdate = true;
}

/* ---------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------- */

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
window.addEventListener('resize', onResize);

buildScene(makeSpec(initialSeed));
applyDim();
planetMeshes[viewpoint].getWorldPosition(earthPos);
lookAt.copy(earthPos);

requestAnimationFrame(animate);
