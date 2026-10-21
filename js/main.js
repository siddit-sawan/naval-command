import * as THREE from 'three';
import { createOcean, sampleOcean } from './ocean.js';
import { createSky, SUN_DIR, FOG_DENSITY, HORIZON } from './sky.js';
import { createScenery } from './scenery.js';
import { Effects } from './effects.js';
import { Game, warmupMeshes } from './game.js';
import { createWeather } from './fog.js';
import { Hud } from './hud.js';
import { UNITS, UNIT_ORDER, EXCLUSIVE_ORDER, MAP, DEATHMATCH, rankedReward, RANKED_TOP } from './config.js';
import { sfx, unlock, setMuted, isMuted } from '../audio/audio.js';
import { sdk, showAd, isAdRunning } from './platform.js';
import { profile } from './profile.js';
import { createMenus } from './menu.js';
import { createBridge } from './bridge.js';
import { createTutorial } from './tutorial.js';
import { t, upper, translatePage } from './i18n.js';

translatePage(); // static text in index.html

const $ = (id) => document.getElementById(id);
const canvas = $('game');

// ---------- Graphics quality (chosen in the main menu, remembered per browser) ----------
const QUALITY = {
  high: { label: t('High'), maxPixelRatio: 2, ocean: 384, particles: 4000 },
  balanced: { label: t('Balanced'), maxPixelRatio: 1.5, ocean: 320, particles: 3000 },
  performance: { label: t('Performance'), maxPixelRatio: 1, ocean: 256, particles: 1800 },
};
const QUALITY_ORDER = ['high', 'balanced', 'performance'];
let qualityName = 'high';
try { if (QUALITY[localStorage.getItem('navalGraphics')]) qualityName = localStorage.getItem('navalGraphics'); } catch { /* storage blocked */ }
const quality = QUALITY[qualityName];

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Starts at the quality cap; lowered automatically if frames run slow.
let pixelRatio = Math.min(window.devicePixelRatio, quality.maxPixelRatio);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(HORIZON, FOG_DENSITY);

const FOV = 50;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 9000);

// The sky now also lights the scene through reflections, so the fill light is gentler.
scene.add(new THREE.HemisphereLight(0xb8d4ec, 0x1d3a44, 0.6));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
sun.position.copy(SUN_DIR).multiplyScalar(100);
scene.add(sun);

const sky = createSky();
scene.add(sky.mesh);

// Reflections: render the sky once into an environment map so hulls, glass and metal mirror it.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), sky.mesh.material));
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();
}

const ocean = createOcean(quality.ocean);
scene.add(ocean.mesh);
const effects = new Effects(scene, quality.particles);
const scenery = createScenery(scene, effects);
const weather = createWeather(scene);

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

// Orbit all the way around (yaw is unlimited) and tilt from just above the waves to top-down.
const PITCH_MIN = 0.12;
const PITCH_MAX = 1.48;
const DEFAULT_PITCH = 0.85;
function rotate(dYaw, dPitch) {
  goal.yaw += dYaw;
  goal.pitch = THREE.MathUtils.clamp(goal.pitch + dPitch, PITCH_MIN, PITCH_MAX);
}

// Back to the default north-facing view; turns the short way round.
function resetView() {
  cam.yaw = Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw));
  goal.yaw = 0;
  goal.pitch = DEFAULT_PITCH;
}

// ---------- Game lifecycle ----------
let state = 'loading';
let difficulty = 'normal';
let mode = 'fleet'; // 'fleet' commands the whole navy; 'manual' is a team deathmatch at the helm of one ship
let flagship = 'destroyer'; // the ship class you start in, in manual mode
let game = null;
const manual = () => game && game.manual;

function newGame(demo) {
  if (game) game.dispose();
  Object.assign(shipCam, { mode: 'overview', ship: null });
  game = new Game(scene, effects, {
    demo,
    difficulty,
    manual: mode === 'manual',
    flagship,
    weather,
    livery: profile.data.livery,
    upgrades: profile.upgradeEffects(),
    rankLevel: profile.rank().index,
    hooks: {
      toast: (text, color) => hud.toast(text, color),
      onGameOver: (winner) => {
        if (demo) {
          setTimeout(() => { if (state === 'menu' || state === 'loading') newGame(true); }, 4000);
          return;
        }
        hud.showGameOver(game, winner);
        menus.showMatchReward(game, winner);
        if (winner === 'player') { sfx.victory(); sdk('happytime'); } else sfx.defeat();
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
  if (next !== 'play' && document.pointerLockElement) document.exitPointerLock();
  if (next === 'menu' || next === 'over') tutorial.stop();
  if (next === 'menu') {
    // Menu backdrop: two AI fleets fight it out while the camera drifts around the middle.
    if (prev !== 'loading') newGame(true);
    Object.assign(goal, { x: 0, z: 0, pitch: 0.28, dist: 190 });
  }
}

function startPlay() {
  unlock();
  sfx.click();
  menus.closeModals();
  boostReadyAt = BOOST_FIRST;
  newGame(false);
  hud.setExclusives(ownedExclusives());
  cam.yaw = Math.atan2(Math.sin(cam.yaw), Math.cos(cam.yaw));
  Object.assign(goal, { x: HOME.x, z: HOME.z, yaw: 0, pitch: DEFAULT_PITCH, dist: 170 });
  view = 'bridge';
  look.yaw = 0;
  look.pitch = -0.08;
  setState('play');
  if (tutorial.start(manual() ? 'manual' : 'fleet')) return;
  hud.toast(manual()
    ? t('Team deathmatch: sink all five enemy ships! Lead your shots · 1-3 weapons')
    : t('Capture outposts for income. Destroy the enemy harbor!'));
}

function togglePause() {
  if (state === 'play') setState('paused');
  else if (state === 'paused') setState('play');
}

$('menuMuteBtn').addEventListener('click', () => { unlock(); toggleMute(); });

function toggleMute() {
  setMuted(!isMuted());
  hud.setMuted(isMuted());
}

$('playBtn').addEventListener('click', startPlay);
$('tutorialBtn').addEventListener('click', () => {
  profile.markTutorial(mode, false);
  startPlay();
});
$('pauseTutorialBtn').addEventListener('click', () => {
  setState('play');
  tutorial.start(manual() ? 'manual' : 'fleet', true);
});
// Between matches is the natural break for an ad.
$('againBtn').addEventListener('click', async () => {
  await showAd('midgame', adHooks);
  startPlay();
});
$('menuBtn').addEventListener('click', async () => {
  await showAd('midgame', adHooks);
  setState('menu');
});
$('resumeBtn').addEventListener('click', () => setState('play'));
$('quitBtn').addEventListener('click', () => setState('menu'));
for (const btn of document.querySelectorAll('#diffRow .diff')) {
  btn.addEventListener('click', () => {
    difficulty = btn.dataset.diff;
    document.querySelectorAll('#diffRow .diff').forEach((b) => b.classList.toggle('active', b === btn));
    if (difficulty === 'ranked') setMode('fleet'); // Ranked War is a fleet battle
    renderRankedInfo();
  });
}
function setMode(next) {
  mode = next;
  document.querySelectorAll('#modeRow .diff').forEach((b) => b.classList.toggle('active', b.dataset.mode === next));
  $('shipRow').classList.toggle('hidden', mode !== 'manual');
}
// Tells the player how hard Ranked War will be at their current rank.
function renderRankedInfo() {
  const el = $('rankedInfo');
  el.classList.toggle('hidden', difficulty !== 'ranked');
  const r = profile.rank();
  el.innerHTML = '⚔ ' + t('<b>Ranked War</b>: the enemy grows stronger as you rank up. As a <b>{rank}</b> you face <b>level {level} / {top}</b> and earn <b>×{mult}</b> rewards. Fleet battles only.', { rank: r.name, level: r.index, top: RANKED_TOP, mult: rankedReward(r.index) });
}
profile.onChange(renderRankedInfo);
renderRankedInfo();
for (const btn of document.querySelectorAll('#modeRow .diff')) {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === 'manual' && difficulty === 'ranked') {
      menus.notify(t('Ranked War is fleet battles only. Pick Easy, Normal or Hard for Manual.'), '#ff5a4f');
      return;
    }
    setMode(btn.dataset.mode);
  });
}
for (const btn of document.querySelectorAll('#shipRow .diff')) {
  btn.addEventListener('click', () => {
    flagship = btn.dataset.ship;
    document.querySelectorAll('#shipRow .diff').forEach((b) => b.classList.toggle('active', b === btn));
  });
}

// Graphics setting: the ocean mesh and particle pool are sized at startup, so changing it reloads.
const gfxBtn = $('gfxBtn');
gfxBtn.textContent = t('Graphics: {quality}', { quality: quality.label });
gfxBtn.addEventListener('click', () => {
  const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(qualityName) + 1) % QUALITY_ORDER.length];
  try { localStorage.setItem('navalGraphics', next); } catch { /* storage blocked */ }
  location.reload();
});

$('compassBtn').addEventListener('click', resetView);
const compassNeedle = $('compassNeedle');
let lastNeedle = null;

// ---------- Selection & orders ----------
const playerShips = () => (game ? game.alive('player') : []);
const selectedShips = () => playerShips().filter((s) => s.selected);

const ownedExclusives = () => EXCLUSIVE_ORDER.filter((id) => profile.ownsShip(id));

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

// ---------- Ads, rewards and menus ----------
// The game freezes and goes quiet while an ad plays.
let adPause = false;
let mutedBeforeAd = false;
const adHooks = {
  onStart() {
    adPause = true;
    mutedBeforeAd = isMuted();
    setMuted(true);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onEnd() {
    adPause = false;
    setMuted(mutedBeforeAd);
    hud.setMuted(isMuted());
  },
};
const menus = createMenus({
  adHooks,
  // Repaint the menu's backdrop fleet so the new livery shows straight away.
  onLiveryChange: () => { if (state === 'menu') newGame(true); },
});
const wheelhouse = createBridge(scene);
const tutorial = createTutorial({
  game: () => game,
  selected: () => selectedShips(),
  shipCamMode: () => shipCam.mode,
  look: () => look,
  goal: () => goal,
});
// Replay a tutorial from How to Play: it shows the next time that mode starts.
for (const btn of document.querySelectorAll('[data-tutorial]')) {
  btn.addEventListener('click', () => {
    profile.markTutorial(btn.dataset.tutorial, false);
    menus.notify(btn.dataset.tutorial === 'manual' ? t('The Manual tutorial will play next time you start that mode') : t('The Fleet tutorial will play next time you start that mode'), '#4cd68a');
  });
}

// In-match boost: watch an ad for gold, available a little while into the battle and then on a cooldown.
const BOOST_GOLD = 250;
const BOOST_FIRST = 45;
const BOOST_COOLDOWN = 150;
let boostReadyAt = BOOST_FIRST;
const boostBtn = $('boostBtn');
function updateBoost() {
  const wait = Math.ceil(boostReadyAt - game.time);
  boostBtn.disabled = wait > 0 || !!game.over;
  boostBtn.textContent = wait > 0 ? `📺 ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}`
    : game.deathmatch ? t('📺 Repair hull') : `📺 +${BOOST_GOLD} ⛃`;
}
boostBtn.addEventListener('click', async () => {
  if (state !== 'play' || game.time < boostReadyAt) return;
  const g = game;
  if (!(await showAd('rewarded', adHooks)) || g !== game || g.over) return;
  boostReadyAt = g.time + BOOST_COOLDOWN;
  if (g.deathmatch) {
    if (g.helm) g.helm.hp = g.helm.maxHp;
    hud.toast(t('Damage control: hull fully repaired'), '#4cd68a');
  } else {
    g.teams.player.gold += BOOST_GOLD;
    hud.toast(t('Reinforcement funds: +{n} gold', { n: BOOST_GOLD }), '#f0b429');
  }
  sfx.built();
});

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
    // Airborne planes from these battleships go after enemy ships too.
    if (target.kind === 'ship') for (const s of sel) game.directAircraft(s, { target });
    sfx.order();
    return;
  }
  if (waterPoint(clientX, clientY)) {
    for (const s of sel) game.directAircraft(s, { point: { x: hit.x, z: hit.z } });
    orderMove(hit.x, hit.z);
  }
}

// ---------- Manual mode ----------
function takeHelm(ship) {
  game.setHelm(ship);
  hud.toast(t('You now command HMS {name}', { name: ship.name }), '#3fa2ff');
  sfx.click();
}

// Click: take over one of your ships, or fire at the enemy / water under the cursor.
function helmClick(clientX, clientY) {
  const own = pickShip(clientX, clientY, 'player');
  if (own) {
    if (own !== game.helm) takeHelm(own);
    return;
  }
  const target = pickShip(clientX, clientY, 'enemy');
  const aim = target || (waterPoint(clientX, clientY) && { x: hit.x, z: hit.z });
  // Clicking an enemy directly counts as a missile lock in the chase view.
  if (aim) helmShoot(aim, target);
}

function helmShoot(aim, lockedOn = null) {
  const err = game.helmFire(aim, lockedOn);
  if (err && err !== t('Reloading')) hud.toast(err, '#ff5a4f');
  if (err) sfx.denied();
}

// Right-click: sail the helm ship to that point until a steering key is pressed.
function helmCommand(clientX, clientY) {
  const target = pickShip(clientX, clientY, 'enemy');
  if (target) { helmShoot(target, target); return; }
  if (!game.helm || !waterPoint(clientX, clientY)) return;
  game.order([game.helm], { type: 'move', x: hit.x, z: hit.z });
  effects.ring(hit.x, hit.z, { life: 0.8, grow: 5 });
  sfx.order();
}

// ---------- First-person bridge view (manual mode) ----------
// The camera rides on your ship's bridge. With the pointer locked the mouse looks around and a click
// fires at the crosshair; without it (touch, or lock refused) drag to look and tap to fire.
let view = 'bridge'; // or 'chase'
const look = { yaw: 0, pitch: -0.08 };
let zoomFov = FOV;
let currentFov = FOV;
let lockFailed = false;
let lockLostAt = -1e9;
const lookDir = new THREE.Vector3();
const eye = new THREE.Vector3();
const locked = () => document.pointerLockElement === canvas;
const bridge = () => manual() && view === 'bridge' && !!game.helm && (state === 'play' || state === 'paused');

// The look direction is relative to the ship (+x is the bow), so the view pitches and rolls with the
// hull and the wheelhouse around it.
const shipUp = new THREE.Vector3();
function updateLookDir(h) {
  const q = h.mesh.quaternion;
  lookDir.set(Math.cos(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.sin(look.yaw) * Math.cos(look.pitch))
    .applyQuaternion(q);
  shipUp.set(0, 1, 0).applyQuaternion(q);
}

// Called after the simulation has moved the ship, so the view never lags a frame behind the hull.
function placeBridgeCamera(h) {
  eye.copy(h.mesh.userData.eye).applyMatrix4(h.mesh.matrixWorld);
  updateLookDir(h);
  camera.position.copy(eye);
  camera.up.copy(shipUp);
  camera.lookAt(eye.x + lookDir.x, eye.y + lookDir.y, eye.z + lookDir.z);
  // Aiming rays are cast before the next render, so the matrix must be current now.
  camera.updateMatrixWorld();
  // The turrets train where the captain is looking (only on the ship you steer).
  if (h !== game.helm) return;
  const f = Math.hypot(lookDir.x, lookDir.z) || 1;
  h.aimPoint = { x: h.x + (lookDir.x / f) * 60, z: h.z + (lookDir.z / f) * 60 };
}

// The wheelhouse sits right around the eye, so the bridge view needs a closer near plane.
function setNear(n) {
  if (camera.near === n) return;
  camera.near = n;
  camera.updateProjectionMatrix();
}

function setFov(f) {
  if (Math.abs(f - currentFov) < 0.01) return;
  currentFov = f;
  camera.fov = f;
  camera.updateProjectionMatrix();
  effects.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y, f);
}

function turnLook(mx, my) {
  const k = 0.0024 * (zoomFov / FOV);
  look.yaw = Math.atan2(Math.sin(look.yaw + mx * k), Math.cos(look.yaw + mx * k));
  look.pitch = THREE.MathUtils.clamp(look.pitch - my * k, -0.6, 0.45);
}

// What the crosshair is on: an enemy, the enemy harbor, a point on the water, or (above the
// horizon) a point far off in that direction.
// The point on the crosshair line the guns converge on: at an enemy ship under it, on the water, or
// far off above the horizon. Shells fly straight down this line and gravity does the rest, so leading
// a moving ship and holding a little high at long range are up to you. range: horizontal distance.
function crosshairAim() {
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const target = pickShip(cx, cy, 'enemy');
  const flat = Math.hypot(lookDir.x, lookDir.z) || 1;
  let along = 2000;
  if (target) along = Math.hypot(target.x - eye.x, target.z - eye.z) / flat;
  else if (lookDir.y < -0.002) along = -eye.y / lookDir.y;
  return {
    x: eye.x + lookDir.x * along, y: eye.y + lookDir.y * along, z: eye.z + lookDir.z * along,
    range: along * flat, sky: !target && lookDir.y >= -0.002,
  };
}

function setView(next) {
  view = next;
  if (view === 'chase') {
    if (locked()) document.exitPointerLock();
    Object.assign(goal, { pitch: 0.32, dist: 85 });
  }
  if (game.helm) game.helm.aimPoint = null;
  hud.toast(view === 'bridge' ? t('Bridge view') : t('Chase view'), '#cfe0ec');
}

document.addEventListener('pointerlockchange', () => {
  if (locked()) return;
  lockLostAt = performance.now();
  // Esc releases the mouse; treat it as a pause like any first-person game (but not when an ad took it).
  if (state === 'play' && bridge() && !isAdRunning()) setState('paused');
});
document.addEventListener('pointerlockerror', () => { lockFailed = true; });

function requestLock() {
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { lockFailed = true; });
  } catch {
    lockFailed = true;
  }
}

const crosshair = $('crosshair');
const xhInfo = $('xhInfo');
const xhHint = $('xhHint');
// Missile lock: keep the crosshair on the same enemy ship, in range, for the weapon's lock time.
const lock = { target: null, t: 0 };
function lockedTarget() {
  const h = game.helm;
  const w = h && h.weapons[h.weaponIdx];
  if (w && w.kind === 'aircraft') return pickShip(window.innerWidth / 2, window.innerHeight / 2, 'enemy');
  return w && w.kind === 'missile' && lock.target && lock.t >= w.lock ? lock.target : null;
}

function updateCrosshair(dt) {
  const fp = bridge();
  crosshair.classList.toggle('hidden', !fp);
  if (!fp) return;
  const h = game.helm;
  const w = h.weapons[h.weaponIdx];
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const target = pickShip(cx, cy, 'enemy');
  const aim = crosshairAim();
  const dist = aim.range;
  const ready = h.cooldown <= 0;
  let status = ready ? t('READY') : t('RELOAD {s}s', { s: h.cooldown.toFixed(1) });
  let good = false, far = false;
  if (!game.weaponsOnline('player', h.weaponIdx)) {
    lock.target = null;
    const need = DEATHMATCH.unlock[h.weaponIdx];
    status = t(need > 1 ? 'OFFLINE · HOLD {n} OUTPOSTS' : 'OFFLINE · HOLD {n} OUTPOST', { n: need });
    far = true;
  } else if (w.kind === 'aircraft') {
    lock.target = null;
    status = h.plane ? (target ? t('CLICK: BOMB THIS SHIP') : t('CLICK: SEND AIRCRAFT HERE')) : ready ? t('CLICK TO LAUNCH') : t('READY IN {s}s', { s: Math.ceil(h.cooldown) });
    good = !!h.plane && !!target;
  } else if (w.kind === 'missile') {
    const valid = target && game.distTo(h, target) <= w.range;
    if (valid && lock.target === target) lock.t += state === 'play' ? dt : 0;
    else { lock.target = valid ? target : null; lock.t = 0; }
    if (lock.target && lock.t >= w.lock) { status = ready ? t('LOCKED · FIRE') : t('LOCKED · {status}', { status }); good = true; }
    else if (lock.target) status = t('LOCKING {n}%', { n: Math.round((lock.t / w.lock) * 100) });
    else far = !!target;
  } else {
    lock.target = null;
    if (w.kind === 'depth') status = ready ? t('DROP ASTERN') : status;
    else {
      far = !!target && dist > w.range;
      good = !!target && !far;
      const eta = dist / (w.kind === 'torpedo' ? w.speed : w.velocity);
      status = aim.sky ? t('RNG — · {status}', { status }) : t('RNG {range} · ETA {eta}s · {status}', { range: Math.round(dist), eta: eta.toFixed(1), status });
    }
  }
  crosshair.classList.toggle('lock', good);
  crosshair.classList.toggle('far', far);
  const zoom = FOV / zoomFov;
  xhInfo.textContent = [upper(w.name), status, zoom > 1.1 ? '×' + zoom.toFixed(1) : ''].filter(Boolean).join('  ·  ');
  xhHint.classList.toggle('hidden', locked() || lockFailed || 'ontouchstart' in window);
}

// ---------- Deathmatch HUD: weapon selector and score ----------
const weaponPanel = $('weapons');
let panelFor = null;
function selectWeapon(i) {
  const w = game.selectWeapon(i);
  if (!w) return;
  sfx.click();
  hud.toast(w.name, '#cfe0ec');
  updateWeaponPanel();
}
function updateWeaponPanel() {
  const h = game.deathmatch ? game.helm : null;
  weaponPanel.classList.toggle('hidden', !h);
  if (!h) return;
  if (panelFor !== h) {
    panelFor = h;
    weaponPanel.innerHTML = h.weapons.map((w, i) => `<button class="weapon-btn" data-i="${i}"><span class="key">${i + 1}</span>
      <span class="name">${w.name}</span><span class="desc">${t('{range} · {damage} dmg', { range: w.kind === 'depth' ? t('Drops astern') : t('Range {n}', { n: w.range }), damage: w.damage })}</span><div class="prog"></div></button>`).join('');
    for (const b of weaponPanel.querySelectorAll('.weapon-btn')) b.addEventListener('click', () => selectWeapon(+b.dataset.i));
  }
  weaponPanel.querySelectorAll('.weapon-btn').forEach((b, i) => {
    const w = h.weapons[i];
    const online = game.weaponsOnline('player', i);
    b.classList.toggle('active', i === h.weaponIdx);
    b.classList.toggle('locked', !online);
    b.querySelector('.prog').style.width = `${(1 - h.wcool[i] / w.reload) * 100}%`;
    const need = DEATHMATCH.unlock[i];
    const desc = !online ? t(need > 1 ? '🔒 Hold {n} outposts to arm' : '🔒 Hold {n} outpost to arm', { n: need })
      : w.kind === 'aircraft' ? (h.plane ? t('Airborne · click to direct') : t('Launch, then click to direct'))
        : t('{range} · {damage} dmg', { range: w.kind === 'depth' ? t('Drops astern') : t('Range {n}', { n: w.range }), damage: w.damage });
    const el = b.querySelector('.desc');
    if (el.textContent !== desc) el.textContent = desc;
  });
}
const scoreEl = $('score');
function updateScore() {
  if (!game.deathmatch) return;
  const mine = game.alive('player').length, theirs = game.alive('enemy').length;
  scoreEl.innerHTML = `<span class="you">⚓ ${mine}</span> ${t('vs')} <span class="foe">${theirs} ⚓</span> · ⚑ ${game.outpostsHeld('player')}/${game.outposts.length} · ${t('Sunk {n}', { n: game.teams.player.kills })}`;
}

// ---------- Fleet mode: cameras on a selected ship ----------
// Overview is the normal strategy camera. Chase, Orbit and Waterline follow the ship from outside
// (drag or Q/E/R/F to swing round, wheel to zoom); Bridge puts you in its wheelhouse (drag to look,
// wheel for binoculars). The ship keeps following your fleet orders.
const SHIP_CAMS = ['overview', 'chase', 'orbit', 'waterline', 'bridge'];
const shipCam = { mode: 'overview', ship: null, yaw: 0, pitch: 0, zoom: 1, orbit: 0, pos: new THREE.Vector3(), fresh: true };
const shipCamActive = () => !!game && !manual() && shipCam.mode !== 'overview' && !!shipCam.ship
  && shipCam.ship.alive && (state === 'play' || state === 'paused');

function setShipCam(mode, ship = shipCam.ship) {
  if (mode !== 'overview' && (!ship || !ship.alive)) {
    hud.toast(t('Select one of your ships first'), '#ff5a4f');
    return;
  }
  const leaving = shipCam.ship;
  Object.assign(shipCam, { mode, ship: mode === 'overview' ? null : ship, yaw: 0, pitch: 0, zoom: 1, fresh: true });
  shipCam.orbit = ship ? ship.heading + Math.PI * 0.75 : 0;
  if (mode === 'bridge') Object.assign(look, { yaw: 0, pitch: -0.08 });
  if (mode === 'overview' && leaving) lookAt(leaving.x, leaving.z);
  zoomFov = FOV;
  updateCamBar();
}

function cycleShipCam() {
  const ship = shipCamActive() ? shipCam.ship : selectedShips()[0];
  const i = SHIP_CAMS.indexOf(shipCam.mode);
  setShipCam(ship ? SHIP_CAMS[(i + 1) % SHIP_CAMS.length] : 'overview', ship);
}

function swingShipCam(dx, dy) {
  if (shipCam.mode === 'bridge') { turnLook(dx, dy); return; }
  shipCam.yaw -= dx * 0.006;
  shipCam.pitch = THREE.MathUtils.clamp(shipCam.pitch + dy * 0.004, -0.3, 1);
}

const camWant = new THREE.Vector3();
function placeShipCamera(dt) {
  const sh = shipCam.ship, st = sh.stats, zoom = shipCam.zoom;
  const fx = Math.cos(sh.heading), fz = Math.sin(sh.heading);
  const tgt = { x: sh.x, y: st.size * 0.12 + 2, z: sh.z };
  let yaw, dist, height;
  if (shipCam.mode === 'chase') {
    yaw = sh.heading + Math.PI + shipCam.yaw;
    dist = (st.size * 1.3 + 16) * zoom;
    height = (st.size * 0.35 + 5) * zoom + shipCam.pitch * 30;
    tgt.x += fx * st.size * 0.8;
    tgt.z += fz * st.size * 0.8;
  } else if (shipCam.mode === 'orbit') {
    shipCam.orbit += dt * 0.22;
    yaw = shipCam.orbit + shipCam.yaw;
    dist = (st.size * 1.6 + 22) * zoom;
    height = (st.size * 0.55 + 9) * zoom + shipCam.pitch * 30;
  } else {
    // Waterline: low off the bow quarter, looking up at the hull.
    yaw = sh.heading + Math.PI * 0.3 + shipCam.yaw;
    dist = (st.size * 0.85 + 9) * zoom;
    height = 1.6 + shipCam.pitch * 12;
    tgt.y = st.size * 0.18 + 2.5;
  }
  camWant.set(sh.x + Math.cos(yaw) * dist, 0, sh.z + Math.sin(yaw) * dist);
  camWant.y = Math.max(height, sampleOcean(camWant.x, camWant.z, time) + 1.2);
  if (shipCam.fresh) shipCam.pos.copy(camWant);
  else shipCam.pos.lerp(camWant, 1 - Math.exp(-dt * 5));
  shipCam.fresh = false;
  camera.position.copy(shipCam.pos);
  camera.lookAt(tgt.x, tgt.y, tgt.z);
  camera.updateMatrixWorld();
  // Keep the strategy camera over the ship so going back to Overview is seamless.
  lookAt(sh.x, sh.z);
}

const camBar = $('camBar');
for (const btn of camBar.querySelectorAll('button')) {
  btn.addEventListener('click', () => {
    sfx.click();
    setShipCam(btn.dataset.cam, shipCamActive() && !selectedShips().length ? shipCam.ship : selectedShips()[0] || shipCam.ship);
  });
}
function updateCamBar() {
  const show = !!game && !manual() && (state === 'play' || state === 'paused') && (selectedShips().length > 0 || shipCamActive());
  camBar.classList.toggle('hidden', !show);
  for (const btn of camBar.querySelectorAll('button')) btn.classList.toggle('active', btn.dataset.cam === shipCam.mode);
}

// The bridge screens of a ship you aren't steering show its own engine state.
const shipInput = (sh) => ({ throttle: sh.speed > 0.5 ? 1 : sh.speed < -0.5 ? -1 : 0, rudder: 0 });

// Edge scrolling: the strategy camera pans when the mouse rests against a screen edge.
const mouse = { x: 0, y: 0, inside: false };
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.inside = true;
});
document.documentElement.addEventListener('mouseleave', () => { mouse.inside = false; });
window.addEventListener('blur', () => { mouse.inside = false; });
const EDGE = 8;

// ---------- Keyboard ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && tutorial.active && state === 'play') {
    tutorial.next();
    return;
  }
  if (e.code === 'Escape' && state === 'play' && shipCamActive()) {
    setShipCam('overview');
    return;
  }
  if (e.code === 'Escape') {
    // Leaving pointer lock already paused the game; don't immediately unpause it again.
    if (performance.now() - lockLostAt > 300) togglePause();
    return;
  }
  if (state !== 'play') return;
  if (e.code === 'KeyV' && !e.repeat) {
    if (manual()) setView(view === 'bridge' ? 'chase' : 'bridge');
    else cycleShipCam();
    return;
  }
  if (manual() && (e.code === 'Tab' || e.code === 'Space')) {
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'Space') {
      if (bridge()) helmShoot(crosshairAim(), lockedTarget());
      else helmShoot(null, game.findTarget(game.helm, game.helm.weapons[game.helm.weaponIdx].range));
    }
    else if (game.cycleHelm()) takeHelm(game.helm);
    return;
  }
  if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey)) {
    if (manual()) return;
    e.preventDefault();
    setSelection(playerShips());
    return;
  }
  const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].indexOf(e.code);
  if (digit >= 0 && !e.repeat) {
    if (game.deathmatch) selectWeapon(digit);
    else if (digit < UNIT_ORDER.length) build(UNIT_ORDER[digit]);
    else if (ownedExclusives()[digit - UNIT_ORDER.length]) build(ownedExclusives()[digit - UNIT_ORDER.length]);
    return;
  }
  if (e.code === 'KeyM' && !e.repeat) { toggleMute(); return; }
  if (e.code === 'KeyH') lookAt(HOME.x, HOME.z);
  if (e.code === 'KeyC') {
    if (bridge() || (shipCamActive() && shipCam.mode === 'bridge')) Object.assign(look, { yaw: 0, pitch: -0.08 });
    else if (shipCamActive()) Object.assign(shipCam, { yaw: 0, pitch: 0 });
    else resetView();
  }
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
  if (manual()) {
    // The keys drive your ship instead of the camera, which follows it.
    game.helmInput.throttle = has('KeyW', 'ArrowUp') ? 1 : has('KeyS', 'ArrowDown') ? -0.35 : 0;
    game.helmInput.rudder = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
    const h = game.helm;
    if (h) {
      lookAt(h.x, h.z);
      // Chase view swings round behind the ship.
      if (view === 'chase') {
        const behind = Math.atan2(-Math.cos(h.heading), -Math.sin(h.heading));
        goal.yaw = cam.yaw + Math.atan2(Math.sin(behind - cam.yaw), Math.cos(behind - cam.yaw));
      }
    }
    if (bridge()) {
      if (has('KeyQ')) turnLook(-dt * 600, 0);
      if (has('KeyE')) turnLook(dt * 600, 0);
      if (has('KeyR')) turnLook(0, -dt * 300);
      if (has('KeyF')) turnLook(0, dt * 300);
      return;
    }
  } else {
    const panKey = has('KeyW', 'ArrowUp', 'KeyS', 'ArrowDown', 'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight');
    if (shipCamActive()) {
      // Panning hands control back to the strategy camera.
      if (panKey) setShipCam('overview');
      else {
        if (has('KeyQ')) swingShipCam(-dt * 600, 0);
        if (has('KeyE')) swingShipCam(dt * 600, 0);
        if (has('KeyR')) swingShipCam(0, -dt * 300);
        if (has('KeyF')) swingShipCam(0, dt * 300);
        return;
      }
    }
    const fast = has('ShiftLeft', 'ShiftRight') ? 2.5 : 1;
    if (has('KeyW', 'ArrowUp')) pan(0, speed * fast);
    if (has('KeyS', 'ArrowDown')) pan(0, -speed * fast);
    if (has('KeyA', 'ArrowLeft')) pan(-speed * fast, 0);
    if (has('KeyD', 'ArrowRight')) pan(speed * fast, 0);
    if (mouse.inside && !pointers.size && document.hasFocus()) {
      const w = window.innerWidth, h = window.innerHeight;
      if (mouse.x < EDGE) pan(-speed * fast, 0);
      else if (mouse.x > w - EDGE) pan(speed * fast, 0);
      if (mouse.y < EDGE) pan(0, speed * fast);
      else if (mouse.y > h - EDGE) pan(0, -speed * fast);
    }
  }
  if (has('KeyQ')) rotate(-dt * 1.4, 0);
  if (has('KeyE')) rotate(dt * 1.4, 0);
  if (has('KeyR')) rotate(0, dt * 0.9);
  if (has('KeyF')) rotate(0, -dt * 0.9);
}

// ---------- Pointer input ----------
// Mouse: left click/drag selects, right click moves/attacks, right drag (or Alt + left drag on a
//        touchpad) orbits and tilts the camera, middle drag pans.
// Touch: tap a ship to select, tap water/enemy to command, drag to pan, pinch to zoom,
//        twist two fingers to rotate, slide two fingers up/down to tilt.
canvas.addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  e.preventDefault();
  if (bridge() || (shipCamActive() && shipCam.mode === 'bridge')) {
    // Binoculars.
    zoomFov = THREE.MathUtils.clamp(zoomFov * Math.exp(e.deltaY * 0.001), 14, FOV);
    return;
  }
  if (shipCamActive()) {
    shipCam.zoom = THREE.MathUtils.clamp(shipCam.zoom * Math.exp(e.deltaY * 0.001), 0.45, 3);
    return;
  }
  // Zoom toward whatever is under the cursor, like a map.
  const before = !manual() && waterPoint(e.clientX, e.clientY) ? { x: hit.x, z: hit.z } : null;
  const old = goal.dist;
  goal.dist = THREE.MathUtils.clamp(goal.dist * Math.exp(e.deltaY * 0.001), 40, 520);
  if (before) {
    const k = 1 - goal.dist / old;
    lookAt(goal.x + (before.x - goal.x) * k, goal.z + (before.z - goal.z) * k);
  }
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const pointers = new Map();
let pinchStart = 0;
let pinchAngle = 0;
let boxing = false;

canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  unlock();
  if (bridge()) {
    if (locked()) {
      if (e.button === 0) helmShoot(crosshairAim(), lockedTarget());
      else if (e.button === 2) zoomFov = zoomFov < FOV * 0.7 ? FOV : FOV / 3;
      return;
    }
    if (e.pointerType !== 'touch' && !lockFailed && e.button === 0) {
      requestLock();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0, bridge: true });
    return;
  }
  if (e.button === 1) e.preventDefault(); // no browser auto-scroll on middle click
  canvas.setPointerCapture(e.pointerId);
  const orbit = e.pointerType !== 'touch' && (e.button === 2 || (e.button === 0 && e.altKey));
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: 0, touch: e.pointerType === 'touch', orbit });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
    pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
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
  if (state === 'play' && bridge() && locked()) {
    turnLook(e.movementX, e.movementY);
    return;
  }
  const p = pointers.get(e.pointerId);
  if (p && p.bridge) {
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved += Math.abs(dx) + Math.abs(dy);
    turnLook(-dx * 1.5, -dy * 1.5);
    return;
  }
  if (!p) {
    if (state === 'play' && e.pointerType !== 'touch') updateHover(e.clientX, e.clientY);
    return;
  }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  p.moved += Math.abs(dx) + Math.abs(dy);

  if (pointers.size === 1 && shipCamActive() && (p.orbit || p.button === 0 || p.touch)) {
    if (p.moved > 4) swingShipCam(dx * (shipCam.mode === 'bridge' ? -1.5 : 1), dy * (shipCam.mode === 'bridge' ? -1.5 : 1));
    return;
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (pinchStart > 0) {
      goal.dist = THREE.MathUtils.clamp(goal.dist * (pinchStart / d), 40, 520);
      // Twist to rotate; both fingers sliding vertically tilts.
      rotate(-Math.atan2(Math.sin(angle - pinchAngle), Math.cos(angle - pinchAngle)), dy * 0.002);
    }
    pinchStart = d;
    pinchAngle = angle;
  } else if (p.orbit) {
    rotate(-dx * 0.006, dy * 0.004);
  } else if (!p.touch && p.button === 0) {
    if (manual()) return;
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
  if (p.bridge) {
    if (e.type !== 'pointercancel' && state === 'play' && p.moved < 10 && game.helm) helmClick(e.clientX, e.clientY);
    return;
  }
  const wasPinch = pinchStart > 0;
  if (pointers.size < 2) pinchStart = 0;
  // A right-drag that rotated the camera isn't a right-click command; a plain right-click still is.
  if (e.type === 'pointercancel' || wasPinch || (p.orbit && (p.button !== 2 || p.moved >= 6)) || state !== 'play') {
    boxing = false;
    selBox.classList.add('hidden');
    return;
  }

  // A drag that swung a ship camera isn't a click.
  if (shipCamActive() && p.moved >= 6 && (p.button === 0 || p.touch)) return;
  if (manual()) {
    if (p.button === 0 && p.moved < (p.touch ? 10 : 6)) helmClick(e.clientX, e.clientY);
    else if (!p.touch && p.button === 2 && p.moved < 6) helmCommand(e.clientX, e.clientY);
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
// Double-click one of your ships to ride along with it.
canvas.addEventListener('dblclick', (e) => {
  if (state !== 'play' || manual()) return;
  const ship = pickShip(e.clientX, e.clientY, 'player');
  if (!ship) return;
  setSelection([ship]);
  setShipCam('chase', ship);
});
canvas.addEventListener('pointercancel', endPointer);

// ---------- Loop ----------
// Interface scale: full size on big screens, shrinking when the game sits in a small window (a CrazyGames embed
// that isn't fullscreen, a phone held sideways) so the HUD doesn't crowd the sea. Used by 'zoom' in style.css.
function uiScale(w, h) {
  const s = h > w ? w / 480 : Math.min(w / 1100, h / 650);
  return Math.round(Math.min(1, Math.max(h > w ? 0.8 : 0.6, s)) * 100) / 100;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  document.documentElement.style.setProperty('--ui', uiScale(w, h));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  effects.setScale(renderer.getDrawingBufferSize(new THREE.Vector2()).y, camera.fov);
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
  const dt = state === 'paused' || adPause ? 0 : realDt;
  time += dt;

  if (state === 'play') handleKeys(realDt);
  else if (state === 'menu' || state === 'loading') goal.yaw += realDt * 0.035;

  applyCamera(realDt);
  if (game && shipCam.mode !== 'overview' && !shipCamActive() && !manual()) setShipCam('overview');
  const fp = !!game && bridge();
  const fleetCam = shipCamActive();
  // The ship whose wheelhouse we're in: your helm in manual mode, or a fleet ship's Bridge camera.
  const onBridge = fp ? game.helm : fleetCam && shipCam.mode === 'bridge' ? shipCam.ship : null;
  // Compass needle points north relative to the current view.
  let viewYaw = cam.yaw;
  if (onBridge) {
    const a = onBridge.heading + look.yaw;
    viewYaw = Math.atan2(-Math.cos(a), -Math.sin(a));
  } else if (fleetCam) {
    const d = camera.getWorldDirection(camWant);
    viewYaw = Math.atan2(-d.x, -d.z);
  }
  const needleDeg = Math.round(THREE.MathUtils.radToDeg(viewYaw));
  if (needleDeg !== lastNeedle) {
    lastNeedle = needleDeg;
    compassNeedle.style.transform = `rotate(${needleDeg}deg)`;
  }
  const followed = onBridge || (fleetCam ? shipCam.ship : null);
  const focus = followed ? { x: followed.x, z: followed.z } : { x: cam.x, z: cam.z };
  ocean.update(time, focus);
  scenery.update(time, dt, focus);
  if (game) {
    // The followed ship hides its own selection ring and health bar from up close.
    game.fpShip = followed;
    game.listener = focus;
    game.aiHold = tutorial.active;
    game.update(time, dt, camera);
  }
  if (onBridge && onBridge.alive) placeBridgeCamera(onBridge);
  else if (fleetCam) placeShipCamera(realDt);
  const inBridge = !!onBridge && onBridge.alive;
  if (!inBridge) camera.up.set(0, 1, 0);
  setNear(inBridge ? 0.06 : 0.5);
  document.body.classList.toggle('bridge', inBridge);
  document.body.classList.toggle('tdm', !!game && game.deathmatch && (state === 'play' || state === 'paused'));
  if (inBridge) wheelhouse.update(true, onBridge, eye, game, onBridge === game.helm ? game.helmInput : shipInput(onBridge), time, realDt);
  else wheelhouse.update(false);
  setFov(inBridge ? zoomFov : FOV);

  // Fog: thicker in a fog front, and thickest when the camera is down inside a bank.
  weather.update(time);
  const p = camera.position;
  const density = weather.density(p.x, p.z, p.y);
  scene.fog.density = density;
  ocean.setFog(weather.banks, density);
  weather.setFogDensity(density);
  sky.update(time, p, weather.mist);
  sun.intensity = 2.4 * (1 - 0.45 * weather.mist);
  effects.update(time, dt);

  hudTimer -= realDt;
  if (game && (state === 'play' || state === 'paused') && hudTimer <= 0) {
    hudTimer = 0.1;
    hud.update(game, selectedShips());
    hud.drawMinimap(game, viewCorners());
    updateCrosshair(0.1);
    updateBoost();
    updateWeaponPanel();
    updateScore();
    updateCamBar();
    tutorial.update();
  }
  renderer.render(scene, camera);
}

// ---------- Boot ----------
// Compile every shader during the loading screen, including ones for things that start hidden
// (selection rings, health bars, shells), so nothing stutters the first time it appears.
async function precompile() {
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  const extras = warmupMeshes();
  for (const m of extras) scene.add(m);
  try {
    await renderer.compileAsync(scene, camera); // uses parallel compilation where the browser supports it
  } catch {
    renderer.compile(scene, camera);
  }
  for (const m of extras) scene.remove(m);
  for (const o of hidden) o.visible = false;
}

sdk('loadingStart');
newGame(true);
const fill = $('loadFill');
let progress = 0;
let compiled = false;
precompile().then(() => {
  compiled = true;
  renderer.setAnimationLoop(frame);
});
(function tickLoad() {
  // The bar creeps toward 90% while shaders compile, then finishes.
  progress = compiled ? Math.min(1, progress + 0.08) : Math.min(0.9, progress + (0.9 - progress) * 0.06);
  fill.style.width = `${progress * 100}%`;
  if (progress < 1) {
    requestAnimationFrame(tickLoad);
    return;
  }
  sdk('loadingStop');
  setTimeout(() => setState('menu'), 150);
})();

// Exposed for debugging from the browser console.
window.navalCommand = { get game() { return game; }, goal, renderer, scene, camera, UNITS, get pixelRatio() { return pixelRatio; } };

// Marketing screenshots: with ?thumb in the address, the page exposes its camera and game for scripted shots.
if (location.search.includes('thumb')) window.__nc = { cam, goal, weather, game: () => game };
