import * as THREE from 'three';
import { createOcean } from './ocean.js';
import { createSky, SUN_DIR, FOG_DENSITY, HORIZON } from './sky.js';
import { createScenery } from './scenery.js';
import { Effects } from './effects.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(HORIZON, FOG_DENSITY);

const FOV = 50;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 9000);

scene.add(new THREE.HemisphereLight(0xb8d4ec, 0x1d3a44, 1.1));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);

const sky = createSky();
scene.add(sky.mesh);
const ocean = createOcean();
scene.add(ocean.mesh);
const effects = new Effects(scene);
const scenery = createScenery(scene, effects);
ocean.syncIslands();

// ---------- Camera rig: orbit around a target point on the water ----------
const HOME = { x: 0, z: 0 };
const cam = { x: 0, z: 0, yaw: 0.6, pitch: 0.28, dist: 170 };
const goal = { ...cam };

function applyCamera(dt) {
  const k = 1 - Math.exp(-dt * 5);
  for (const key of Object.keys(cam)) cam[key] += (goal[key] - cam[key]) * k;
  const cp = Math.cos(cam.pitch);
  camera.position.set(
    cam.x + Math.sin(cam.yaw) * cp * cam.dist,
    Math.sin(cam.pitch) * cam.dist,
    cam.z + Math.cos(cam.yaw) * cp * cam.dist,
  );
  camera.lookAt(cam.x, 0, cam.z);
}

function pan(right, forward) {
  const s = Math.sin(goal.yaw), c = Math.cos(goal.yaw);
  goal.x = THREE.MathUtils.clamp(goal.x + c * right - s * forward, -600, 600);
  goal.z = THREE.MathUtils.clamp(goal.z - s * right - c * forward, -600, 600);
}

function goHome() {
  goal.x = HOME.x;
  goal.z = HOME.z;
}

// ---------- Screens ----------
let state = 'loading';
const screens = { loading: $('loading'), menu: $('menu'), paused: $('pause') };
function setState(next) {
  state = next;
  for (const [name, el] of Object.entries(screens)) el.classList.toggle('hidden', name !== next);
  const inGame = next === 'play' || next === 'paused';
  $('hud').classList.toggle('hidden', !inGame);
  if (inGame) return;
  setSelection([]);
  // Menu: drift around the bay.
  Object.assign(goal, { x: 0, z: 0, pitch: 0.28, dist: 170 });
}

function startPlay() {
  Object.assign(goal, { x: HOME.x, z: HOME.z, pitch: 0.7, dist: 120 });
  setState('play');
}

$('playBtn').addEventListener('click', startPlay);
$('resumeBtn').addEventListener('click', () => setState('play'));
$('quitBtn').addEventListener('click', () => setState('menu'));
for (const btn of document.querySelectorAll('#diffRow .diff')) {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#diffRow .diff').forEach((b) => b.classList.toggle('active', b === btn));
  });
}

// ---------- Input ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (state === 'play') setState('paused');
    else if (state === 'paused') setState('play');
    return;
  }
  if (state !== 'play') return;
  if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    setSelection(ships);
    return;
  }
  keys.add(e.code);
  if (e.code === 'KeyH') goHome();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

canvas.addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  e.preventDefault();
  goal.dist = THREE.MathUtils.clamp(goal.dist * Math.exp(e.deltaY * 0.001), 35, 320);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Ship selection ----------
const { ships } = scenery;
const selBox = $('selbox');
const projected = new THREE.Vector3();

function shipScreenPos(ship) {
  projected.set(ship.x, ship.mesh.position.y + 3, ship.z).project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * window.innerWidth,
    y: (-projected.y * 0.5 + 0.5) * window.innerHeight,
    onScreen: projected.z < 1,
  };
}

// Ships are small on screen, so pick by distance to their projected center rather than exact mesh hits.
function pickShip(cx, cy) {
  const radius = THREE.MathUtils.clamp(3600 / goal.dist, 18, 60);
  let best = null, bestD = radius;
  for (const s of ships) {
    const p = shipScreenPos(s);
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (p.onScreen && d < bestD) { best = s; bestD = d; }
  }
  return best;
}

function setSelection(list, additive = false) {
  for (const s of ships) {
    if (!additive) s.selected = false;
    if (list.includes(s)) s.selected = additive ? !s.selected || list.length > 1 : true;
  }
  renderSelection();
}

const selectedShips = () => ships.filter((s) => s.selected);

const STATUS = { patrol: 'Patrolling', move: 'Under way', idle: 'Holding position' };
function renderSelection() {
  const sel = selectedShips();
  const title = $('selTitle'), body = $('selBody');
  if (sel.length === 0) {
    title.textContent = 'No selection';
    body.className = 'muted';
    body.textContent = 'Click a ship, or drag to select a group.';
  } else if (sel.length === 1) {
    const s = sel[0];
    title.textContent = `HMS ${s.name}`;
    body.className = '';
    body.innerHTML = `<div class="muted">Destroyer · ${STATUS[s.mode]}</div>
      <div class="hpbar"><div style="width:${s.hp}%"></div></div>
      Hull ${s.hp}/100 &nbsp;·&nbsp; ${(s.speed * 2).toFixed(1)} kn<br>
      <span class="muted">Right-click the water to move.</span>`;
  } else {
    title.textContent = `${sel.length} ships selected`;
    body.className = '';
    body.innerHTML = sel.map((s) => `HMS ${s.name} <span class="muted">· ${STATUS[s.mode]}</span>`).join('<br>');
  }
}
renderSelection();

const raycaster = new THREE.Raycaster();
const seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
function waterPoint(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(seaPlane, hit);
}

function commandMove(clientX, clientY) {
  const sel = selectedShips();
  if (!sel.length || !waterPoint(clientX, clientY)) return;
  scenery.orderMove(sel, hit.x, hit.z);
  effects.ring(hit.x, hit.z, { life: 0.8, grow: 5 });
  renderSelection();
}

// ---------- Pointer input ----------
// Mouse: left click/drag selects, right click moves, right/middle drag pans.
// Touch: tap a ship to select, tap water to move, drag to pan, pinch to zoom.
const pointers = new Map();
let pinchStart = 0;
let boxing = false;

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: 0, touch: e.pointerType === 'touch' });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (state !== 'play' || e.pointerType === 'touch') return;
    const over = pickShip(e.clientX, e.clientY);
    for (const s of ships) s.hovered = s === over;
    canvas.style.cursor = over ? 'pointer' : '';
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  p.moved += Math.abs(dx) + Math.abs(dy);

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStart > 0) goal.dist = THREE.MathUtils.clamp(goal.dist * (pinchStart / d), 35, 320);
    pinchStart = d;
  } else if (!p.touch && p.button === 0) {
    boxing = p.moved > 6;
    selBox.classList.toggle('hidden', !boxing);
    Object.assign(selBox.style, {
      left: `${Math.min(p.sx, p.x)}px`, top: `${Math.min(p.sy, p.y)}px`,
      width: `${Math.abs(p.x - p.sx)}px`, height: `${Math.abs(p.y - p.sy)}px`,
    });
  } else {
    const s = goal.dist * 0.0018;
    pan(-dx * s, dy * s);
  }
});

const endPointer = (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  const wasPinch = pinchStart > 0;
  if (pointers.size < 2) pinchStart = 0;
  if (e.type === 'pointercancel' || wasPinch) { boxing = false; selBox.classList.add('hidden'); return; }

  if (!p.touch && p.button === 0) {
    if (boxing) {
      const x0 = Math.min(p.sx, p.x), x1 = Math.max(p.sx, p.x);
      const y0 = Math.min(p.sy, p.y), y1 = Math.max(p.sy, p.y);
      const inside = ships.filter((s) => {
        const sp = shipScreenPos(s);
        return sp.onScreen && sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1;
      });
      setSelection(inside, e.shiftKey);
    } else {
      const ship = pickShip(e.clientX, e.clientY);
      if (ship) setSelection([ship], e.shiftKey);
      else if (!e.shiftKey) setSelection([]);
    }
    boxing = false;
    selBox.classList.add('hidden');
  } else if (!p.touch && p.button === 2 && p.moved < 6) {
    commandMove(e.clientX, e.clientY);
  } else if (p.touch && p.moved < 10) {
    const ship = pickShip(e.clientX, e.clientY);
    if (ship) setSelection([ship]);
    else commandMove(e.clientX, e.clientY);
  }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function handleKeys(dt) {
  const speed = goal.dist * 0.9 * dt;
  const has = (...codes) => codes.some((c) => keys.has(c));
  if (has('KeyW', 'ArrowUp')) pan(0, speed);
  if (has('KeyS', 'ArrowDown')) pan(0, -speed);
  if (has('KeyA', 'ArrowLeft')) pan(-speed, 0);
  if (has('KeyD', 'ArrowRight')) pan(speed, 0);
  if (has('KeyQ')) goal.yaw -= dt * 1.4;
  if (has('KeyE')) goal.yaw += dt * 1.4;
}

// ---------- Loop ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  effects.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y, FOV);
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let time = 0;
let panelTimer = 0;

// Gold, build queue and minimap have no game logic behind them yet, so only the selection panel shows.
for (const id of ['topbar', 'build', 'minimap']) $(id).classList.add('hidden');

function frame() {
  const realDt = Math.min(clock.getDelta(), 0.1);
  const dt = state === 'paused' ? 0 : realDt;
  time += dt;

  if (state === 'play') handleKeys(realDt);
  else if (state !== 'paused') goal.yaw += realDt * 0.035;

  applyCamera(realDt);
  const focus = { x: cam.x, z: cam.z };
  ocean.update(time, focus);
  sky.update(time, camera.position);
  scenery.update(time, dt, focus);
  effects.update(time, dt);

  panelTimer -= realDt;
  if (state === 'play' && panelTimer <= 0) {
    panelTimer = 0.25;
    renderSelection();
  }
  renderer.render(scene, camera);
}

// ---------- Boot ----------
renderer.compile(scene, camera);
renderer.setAnimationLoop(frame);

let progress = 0;
const fill = $('loadFill');
(function tickLoad() {
  progress = Math.min(1, progress + 0.05);
  fill.style.width = `${progress * 100}%`;
  if (progress < 1) requestAnimationFrame(tickLoad);
  else setTimeout(() => setState('menu'), 200);
})();
