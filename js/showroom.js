import * as THREE from 'three';
import { createSky, SUN_DIR } from './sky.js';
import { makeShipModel } from './models.js';
import { LIVERIES, STORE_ORDER } from './livery.js';
import { UNIT_ORDER, EXCLUSIVE_ORDER, UNITS } from './config.js';

// The Showroom: a small separate 3D viewer in the Shop where any ship can be inspected in any livery.
// Drag to orbit, wheel to zoom; it turns slowly on its own until you touch it. Its renderer is separate
// from the battle's, and it only draws while its window is open.

const LETTER = { corvette: 'K', destroyer: 'D', submarine: 'S', battleship: 'B' };

/** equippedId(): the livery to show first. owns(id): whether the player owns that livery. */
export function createShowroom({ canvas, shipBar, liveryBar, label, equippedId, owns, ownsShip }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);

  scene.add(new THREE.HemisphereLight(0xb8d4ec, 0x1d3a44, 0.7));
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(100);
  scene.add(sun);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), createSky().mesh.material));
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 100).texture;
  scene.environmentIntensity = 0.9;
  pmrem.dispose();

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(90, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x14465c, roughness: 0.25, metalness: 0.2 }),
  );
  scene.add(water);

  let type = 'destroyer';
  let livery = 'dazzle';
  let ship = null;
  let dist = 60;
  let yaw = 0.9;
  let pitch = 0.22;
  let spin = true;
  let running = false;

  function fit() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function syncButtons() {
    for (const b of shipBar.children) b.classList.toggle('active', b.dataset.id === type);
    for (const b of liveryBar.children) b.classList.toggle('active', b.dataset.id === livery);
  }

  function build() {
    if (ship) { scene.remove(ship); ship.userData.dispose?.(); }
    const base = UNITS[type].base || type;
    ship = makeShipModel(base, livery, `${LETTER[base]} 14`, UNITS[type].base ? type : '');
    if (UNITS[type].scale) ship.scale.setScalar(UNITS[type].scale);
    scene.add(ship);
    dist = UNITS[type].size * 2.6 + 18;
    label.textContent = `${UNITS[type].label} · ${LIVERIES[livery].name}`;
    syncButtons();
  }

  for (const id of [...UNIT_ORDER, ...EXCLUSIVE_ORDER]) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.id = id;
    b.textContent = UNITS[id].label;
    b.onclick = () => { type = id; build(); };
    shipBar.appendChild(b);
  }
  for (const id of STORE_ORDER) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.id = id;
    b.onclick = () => { livery = id; build(); };
    liveryBar.appendChild(b);
  }

  // Orbit controls.
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; spin = false; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw -= (e.clientX - drag.x) * 0.008;
    pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * 0.006, -0.05, 1.2);
    drag = { x: e.clientX, y: e.clientY };
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const size = UNITS[type].size;
    dist = THREE.MathUtils.clamp(dist * (1 + Math.sign(e.deltaY) * 0.1), size * 1.2, size * 6 + 30);
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { spin = true; });

  const target = new THREE.Vector3();
  let last = 0;
  function tick(now) {
    if (!running) return;
    if (canvas.closest('.modal').classList.contains('hidden')) { running = false; return; }
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    fit();
    if (spin) yaw += dt * 0.35;
    target.set(0, UNITS[type].size * 0.18, 0);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(target);
    camera.lookAt(target);
    renderer.render(scene, camera);
  }

  return {
    // Call right after the window is shown.
    open(shipId = null) {
      if (shipId) type = shipId;
      for (const b of shipBar.children) b.textContent = `${UNITS[b.dataset.id].exclusive && !ownsShip(b.dataset.id) ? '🔒 ' : ''}${UNITS[b.dataset.id].label}`;
      livery = equippedId();
      for (const b of liveryBar.children) b.textContent = `${owns(b.dataset.id) ? '' : '🔒 '}${LIVERIES[b.dataset.id].name}`;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      build();
      if (!running) { running = true; requestAnimationFrame(tick); }
    },
  };
}
