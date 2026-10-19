import * as THREE from 'three';
import { createOcean } from './ocean.js';
import { createSky, SUN_DIR, FOG_DENSITY, HORIZON } from './sky.js';
import { createScenery } from './scenery.js';
import { Effects } from './effects.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { UNITS, UNIT_ORDER, MAP } from './config.js';
import { sfx, unlock, setMuted, isMuted } from './audio.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// High-DPI screens multiply the ocean shader's cost; 1.5 still looks sharp. Lowered further if frames run slow.
let pixelRatio = Math.min(window.devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
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
const effects = new Effects(scene, 3000);
const scenery = createScenery(scene, effects);

// ---------- CrazyGames SDK (optional; absent when running locally) ----------
const sdkReady = (async () => {
  try { await window.CrazyGames?.SDK?.init?.(); return true; } catch { return false; }
})();
function sdk(fn) {
  sdkReady.then((ok) => { if (ok) try { window.CrazyGames.SDK.game[fn]?.(); } catch { /* not available */ } });
}

// ---------- Camera rig: orbit around a target point on the water ----------
// Home view looks out to sea with the player's harbor along the bottom of the screen.
const HOME = { x: MAP.harbors.player.x, z: MAP.harbors.player.z - 60 };
const cam = { x: 0, z: 0, yaw: 0.6, pitch: 0.28, dist: 170 };
const goal = { ...cam };
const LIMIT = MAP.bounds + 50;

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
  goal.x = THREE.MathUtils.clamp(goal.x + c * right - s * forward, -LIMIT, LIMIT);
  goal.z = THREE.MathUtils.clamp(goal.z - s * right - c * forward, -LIMIT, LIMIT);
}

function lookAt(x, z) {
  goal.x = THREE.MathUtils.clamp(x, -LIMIT, LIMIT);
  goal.z = THREE.MathUtils.clamp(z, -LIMIT, LIMIT);
}

// ---------- Game lifecycle ----------
let state = 'loading';
let difficulty = 'normal';
let game = null;

function newGame(demo) {
  if (game) game.dispose();
  game = new Game(scene, effects, {
    demo,
    difficulty,
    hooks: {
      toast: (text, color) => hud.toast(text, color),
      onGameOver: (winner) => {
        if (demo) {
          setTimeout(() => { if (state === 'menu' || state === 'loading') newGame(true); }, 4000);
          return;
        }
        hud.showGameOver(game, winner);
        if (winner === 'player') sfx.victory(); else sfx.defeat();
        setState('over');
      },
    },
  });
  ocean.syncIslands();
}

const screens = { loading: $('loading'), menu: $('menu'), paused: $('pause'), over: $('gameover') };
function setState(next) {
  const prev = state;
  state = next;
  for (const [name, el] of Object.entries(screens)) el.classList.toggle('hidden', name !== next);
  $('hud').classList.toggle('hidden', !(next === 'play' || next === 'paused'));
  if (next === 'play') sdk('gameplayStart');
  else if (prev === 'play') sdk('gameplayStop');
  if (next === 'menu') {
    // Menu backdrop: two AI fleets fight it out while the camera drifts around the middle.
    if (prev !== 'loading') newGame(true);
    Object.assign(goal, { x: 0, z: 0, pitch: 0.28, dist: 190 });
  }
}

function startPlay() {
  unlock();
  sfx.click();
  newGame(false);
  cam.yaw = Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw));
  Object.assign(goal, { x: HOME.x, z: HOME.z, yaw: 0, pitch: 0.85, dist: 170 });
  setState('play');
  hud.toast('Capture outposts for income. Destroy the enemy harbor!');
}

function togglePause() {
  if (state === 'play') setState('paused');
  else if (state === 'paused') setState('play');
}

function toggleMute() {
  setMuted(!isMuted());
  hud.setMuted(isMuted());
}

$('playBtn').addEventListener('click', startPlay);
$('againBtn').addEventListener('click', startPlay);
$('menuBtn').addEventListener('click', () => setState('menu'));
$('resumeBtn').addEventListener('click', () => setState('play'));
$('quitBtn').addEventListener('click', () => setState('menu'));
for (const btn of document.querySelectorAll('#diffRow .diff')) {
  btn.addEventListener('click', () => {
    difficulty = btn.dataset.diff;
    document.querySelectorAll('#diffRow .diff').forEach((b) => b.classList.toggle('active', b === btn));
  });
}

// ---------- Selection & orders ----------
const playerShips = () => (game ? game.alive('player') : []);
const selectedShips = () => playerShips().filter((s) => s.selected);

function build(type) {
  if (state !== 'play') return;
  const err = game.queueBuild('player', type);
  if (err) {
    hud.toast(err, '#ff5a4f');
    sfx.denied();
  } else {
    sfx.click();
  }
}

const hud = new Hud({
  onBuild: build,
  onMinimapJump: (x, z) => { if (state === 'play') lookAt(x, z); },
  onMinimapOrder: (x, z) => { if (state === 'play') orderMove(x, z); },
  onMute: toggleMute,
  onPause: togglePause,
});

const selBox = $('selbox');
const projected = new THREE.Vector3();

function screenPos(x, y, z) {
  projected.set(x, y, z).project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * window.innerWidth,
    y: (-projected.y * 0.5 + 0.5) * window.innerHeight,
    onScreen: projected.z < 1,
  };
}

// Ships are small on screen, so pick by distance to their projected center rather than exact mesh hits.
function pickShip(cx, cy, team) {
  const radius = THREE.MathUtils.clamp(3600 / goal.dist, 18, 60);
  let best = null, bestD = radius;
  for (const s of game.alive(team)) {
    if (!game.visibleTo(s, 'player')) continue;
    const p = screenPos(s.x, s.mesh.position.y + 3, s.z);
    const d = Math.hypot(p.x - cx, p.y - cy) - s.stats.size * 0.3;
    if (p.onScreen && d < bestD) { best = s; bestD = d; }
  }
  return best;
}

function pickEnemyHarbor(cx, cy) {
  const h = game.harbors.enemy;
  if (!h.alive || !waterPoint(cx, cy)) return null;
  return Math.hypot(hit.x - h.x, hit.z - h.z) < h.radius + 10 ? h : null;
}

function setSelection(list, additive = false) {
  for (const s of playerShips()) {
    if (!additive) s.selected = false;
    if (list.includes(s)) s.selected = additive ? !s.selected || list.length > 1 : true;
  }
}

const raycaster = new THREE.Raycaster();
const seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
function waterPoint(clientX, clientY) {
  const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(seaPlane, hit);
}

function orderMove(x, z) {
  const sel = selectedShips();
  if (!sel.length) return;
  game.order(sel, { type: 'move', x, z });
  effects.ring(x, z, { life: 0.8, grow: 5 });
  sfx.order();
}

function command(clientX, clientY) {
  const sel = selectedShips();
  if (!sel.length) return;
  const target = pickShip(clientX, clientY, 'enemy') || pickEnemyHarbor(clientX, clientY);
  if (target) {
    game.order(sel, { type: 'attack', target });
    sfx.order();
    return;
  }
  if (waterPoint(clientX, clientY)) orderMove(hit.x, hit.z);
}

// ---------- Keyboard ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { togglePause(); return; }
  if (state !== 'play') return;
  if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    setSelection(playerShips());
    return;
  }
  const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (digit >= 0 && !e.repeat) { build(UNIT_ORDER[digit]); return; }
  if (e.code === 'KeyM' && !e.repeat) { toggleMute(); return; }
  if (e.code === 'KeyH') lookAt(HOME.x, HOME.z);
  if (e.code === 'Space') {
    e.preventDefault();
    const sel = selectedShips();
    if (sel.length) lookAt(sel.reduce((s, u) => s + u.x, 0) / sel.length, sel.reduce((s, u) => s + u.z, 0) / sel.length);
  }
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

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

// ---------- Pointer input ----------
// Mouse: left click/drag selects, right click moves/attacks, right/middle drag pans.
// Touch: tap a ship to select, tap water/enemy to command, drag to pan, pinch to zoom.
canvas.addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  e.preventDefault();
  goal.dist = THREE.MathUtils.clamp(goal.dist * Math.exp(e.deltaY * 0.001), 40, 380);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const pointers = new Map();
let pinchStart = 0;
let boxing = false;

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  unlock();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: 0, touch: e.pointerType === 'touch' });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

function updateHover(cx, cy) {
  const own = pickShip(cx, cy, 'player');
  const foe = own ? null : pickShip(cx, cy, 'enemy');
  const harbor = own || foe ? null : pickEnemyHarbor(cx, cy);
  for (const s of game.units) s.hovered = s === own || s === foe;
  game.harbors.enemy.hovered = !!harbor;
  canvas.style.cursor = (foe || harbor) && selectedShips().length ? 'crosshair' : own ? 'pointer' : '';
}

canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (state === 'play' && e.pointerType !== 'touch') updateHover(e.clientX, e.clientY);
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  p.moved += Math.abs(dx) + Math.abs(dy);

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchStart > 0) goal.dist = THREE.MathUtils.clamp(goal.dist * (pinchStart / d), 40, 380);
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
  if (e.type === 'pointercancel' || wasPinch || state !== 'play') {
    boxing = false;
    selBox.classList.add('hidden');
    return;
  }

  if (!p.touch && p.button === 0) {
    if (boxing) {
      const x0 = Math.min(p.sx, p.x), x1 = Math.max(p.sx, p.x);
      const y0 = Math.min(p.sy, p.y), y1 = Math.max(p.sy, p.y);
      const inside = playerShips().filter((s) => {
        const sp = screenPos(s.x, s.mesh.position.y + 3, s.z);
        return sp.onScreen && sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1;
      });
      setSelection(inside, e.shiftKey);
    } else {
      const ship = pickShip(e.clientX, e.clientY, 'player');
      if (ship) setSelection([ship], e.shiftKey);
      else if (!e.shiftKey) setSelection([]);
    }
    if (selectedShips().length) sfx.click();
    boxing = false;
    selBox.classList.add('hidden');
  } else if (!p.touch && p.button === 2 && p.moved < 6) {
    command(e.clientX, e.clientY);
  } else if (p.touch && p.moved < 10) {
    const ship = pickShip(e.clientX, e.clientY, 'player');
    if (ship) setSelection([ship]);
    else command(e.clientX, e.clientY);
  }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

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

// Where the screen corners land on the water, for the minimap's view outline.
function viewCorners() {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const r = raycaster.ray;
    if (r.direction.y < -0.02 && r.intersectPlane(seaPlane, hit)) {
      const d = Math.hypot(hit.x - camera.position.x, hit.z - camera.position.z);
      if (d < 900) return { x: hit.x, z: hit.z };
    }
    const flat = Math.hypot(r.direction.x, r.direction.z) || 1;
    return { x: camera.position.x + (r.direction.x / flat) * 900, z: camera.position.z + (r.direction.z / flat) * 900 };
  });
}

const clock = new THREE.Clock();
let time = 0;
let hudTimer = 0;

// Adaptive resolution: if frames average slower than ~45 fps for two seconds, render fewer pixels.
// Only ever steps down, so it can't oscillate; the first seconds are skipped while shaders compile.
const perf = { elapsed: 0, frames: 0, warmup: 3 };
function adaptResolution(rawDt) {
  if (document.hidden || rawDt > 0.25) return;
  if (perf.warmup > 0) { perf.warmup -= rawDt; return; }
  perf.elapsed += rawDt;
  perf.frames++;
  if (perf.elapsed < 2) return;
  const avg = perf.elapsed / perf.frames;
  perf.elapsed = 0;
  perf.frames = 0;
  if (avg > 1 / 45 && pixelRatio > 0.6) {
    pixelRatio = Math.max(0.6, pixelRatio - 0.2);
    renderer.setPixelRatio(pixelRatio);
    resize();
    perf.warmup = 1;
  }
}

function frame() {
  const rawDt = clock.getDelta();
  adaptResolution(rawDt);
  const realDt = Math.min(rawDt, 0.1);
  const dt = state === 'paused' ? 0 : realDt;
  time += dt;

  if (state === 'play') handleKeys(realDt);
  else if (state === 'menu' || state === 'loading') goal.yaw += realDt * 0.035;

  applyCamera(realDt);
  const focus = { x: cam.x, z: cam.z };
  ocean.update(time, focus);
  sky.update(time, camera.position);
  scenery.update(time, dt, focus);
  if (game) {
    game.listener = focus;
    game.update(time, dt, camera);
  }
  effects.update(time, dt);

  hudTimer -= realDt;
  if (game && (state === 'play' || state === 'paused') && hudTimer <= 0) {
    hudTimer = 0.1;
    hud.update(game, selectedShips());
    hud.drawMinimap(game, viewCorners());
  }
  renderer.render(scene, camera);
}

// ---------- Boot ----------
sdk('loadingStart');
newGame(true);
renderer.compile(scene, camera);
renderer.setAnimationLoop(frame);

let progress = 0;
const fill = $('loadFill');
(function tickLoad() {
  progress = Math.min(1, progress + 0.05);
  fill.style.width = `${progress * 100}%`;
  if (progress < 1) {
    requestAnimationFrame(tickLoad);
    return;
  }
  sdk('loadingStop');
  setTimeout(() => setState('menu'), 200);
})();

// Exposed for debugging from the browser console.
window.navalCommand = { get game() { return game; }, renderer, UNITS, get pixelRatio() { return pixelRatio; } };
