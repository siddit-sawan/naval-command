import * as THREE from 'three';
import { mat, makeIsland } from './scenery.js';
import { TEAM_COLORS, HARBOR, CAPTURE } from './config.js';
import { bake } from './bake.js';
import { hullLivery, hullUVs, subLivery, pennantDecal, LIVERIES } from './livery.js';

const deckGrey = mat(0x8d949a);
const grey = mat(0xa9b1b8);
const dark = mat(0x22282e);
const concrete = mat(0x9a9a92);
const subHull = mat(0x2b3138);
const white = mat(0xe8eaec);
const glass = mat(0x1d2b38);
const redOxide = mat(0x7a2a22); // anti-fouling paint below the waterline
const orange = mat(0xe07a1f);
const portLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.25, 0.2) });
const starboardLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 3, 0.4) });
const mastLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.4) });

// Painted steel with a little sheen, so hulls pick up the sky reflection.
const SHIP_FINISH = { roughness: 0.55, metalness: 0.35 };

// Materials for a team ('player' / 'enemy', used by harbors) or for a ship livery id.
const teamMats = {};
function team(key) {
  if (!teamMats[key]) {
    const lv = LIVERIES[key];
    const c = lv ? { hull: lv.base, accent: lv.accent } : TEAM_COLORS[key];
    teamMats[key] = {
      name: key,
      hull: mat(c.hull),
      stripe: mat(c.accent),
      accent: new THREE.MeshBasicMaterial({ color: c.accent, side: THREE.DoubleSide }),
    };
  }
  return teamMats[key];
}

const geoCache = new Map();
function cached(key, build) {
  if (!geoCache.has(key)) geoCache.set(key, build());
  return geoCache.get(key);
}

// Top-down hull outline with a pointed bow at +x, extruded upward.
function hullShape(L, B) {
  const s = new THREE.Shape();
  s.moveTo(-L, -B * 0.9);
  s.lineTo(L * 0.4, -B);
  s.quadraticCurveTo(L * 0.8, -B * 0.85, L, 0);
  s.quadraticCurveTo(L * 0.8, B * 0.85, L * 0.4, B);
  s.lineTo(-L, B * 0.9);
  s.closePath();
  return s;
}

function hullGeo(len, beam, depth) {
  return cached(`hull${len}`, () => hullUVs(
    new THREE.ExtrudeGeometry(hullShape(len / 2, beam / 2), { depth, bevelEnabled: false }).rotateX(-Math.PI / 2),
    len, beam, depth,
  ));
}

// A thin band hugging the hull, for the waterline paint and the team stripe.
function hullBand(len, beam, height) {
  return cached(`band${len}-${height}`, () =>
    new THREE.ExtrudeGeometry(hullShape(len / 2 + 0.06, beam / 2 + 0.06), { depth: height, bevelEnabled: false })
      .rotateX(-Math.PI / 2));
}

// Painted hull (see livery.js), waterline paint, team stripe, deck railings and anchors shared by all
// surface ships. Also records where the pennant number goes.
function surfaceHull(ship, m, { len, beam, depth, y }) {
  const add = builder(ship);
  const L = len / 2, B = beam / 2;
  const deckY = y + depth;
  add(hullGeo(len, beam, depth), hullLivery(ship.userData.type, m.name, { len, beam, depth, y }, SHIP_FINISH), 0, y);
  const freeboard = deckY - 0.1;
  ship.userData.pennantSpot = { x: L * 0.25, y: 0.1 + freeboard * 0.5, z: B * 0.99 + 0.05, h: freeboard * 0.55 };
  add(hullBand(len, beam, 0.5), redOxide, 0, -0.4);
  add(hullBand(len, beam, 0.28), m.stripe, 0, deckY - 0.55);

  // Railings: posts and a top rail down both sides, angling in toward the bow.
  const postGeo = cached('railPost', () => new THREE.BoxGeometry(0.06, 0.55, 0.06));
  for (const side of [-1, 1]) {
    for (let x = -L + 0.3; x <= L * 0.4; x += 1.6) {
      const z = (B * 0.9 + (B * 0.1 * (x + L)) / (1.4 * L)) * 0.97;
      add(postGeo, grey, x, deckY + 0.27, side * z);
    }
    add(cached(`rail${len}`, () => new THREE.BoxGeometry(1.4 * L, 0.05, 0.05)), grey, -0.3 * L, deckY + 0.55, side * B * 0.92);
    const bowLen = Math.hypot(0.55 * L, B);
    const bow = add(cached(`bowRail${len}`, () => new THREE.BoxGeometry(bowLen, 0.05, 0.05)), grey,
      0.675 * L, deckY + 0.55, side * B * 0.48);
    bow.rotation.y = side * Math.atan2(B, 0.55 * L);
    // Anchor in its hawse pipe near the bow.
    add(cached('anchor', () => new THREE.BoxGeometry(0.7, 0.6, 0.12)), dark, L * 0.62, deckY - 0.9, side * B * 0.86);
  }
  return deckY;
}

function navLights(ship, x, y, halfWidth) {
  const add = builder(ship);
  const geo = cached('navLight', () => new THREE.SphereGeometry(0.14, 6, 4));
  add(geo, portLight, x, y, -halfWidth);
  add(geo, starboardLight, x, y, halfWidth);
}

function lifeboat(ship, x, y, z) {
  const add = builder(ship);
  add(cached('boat', () => new THREE.CapsuleGeometry(0.35, 1.4, 3, 8).rotateZ(Math.PI / 2)), orange, x, y, z);
  add(cached('boatTop', () => new THREE.BoxGeometry(1.2, 0.18, 0.55)), white, x, y + 0.32, z);
  for (const dx of [-0.7, 0.7]) add(cached('davit', () => new THREE.BoxGeometry(0.1, 0.8, 0.1)), dark, x + dx, y + 0.1, z * 0.86);
}

// Close-in weapon system: a white radar dome over a small gun mount.
function ciws(ship, x, y, z = 0) {
  const add = builder(ship);
  add(cached('ciwsBase', () => new THREE.CylinderGeometry(0.5, 0.6, 0.6, 8)), grey, x, y, z);
  add(cached('ciwsDome', () => new THREE.SphereGeometry(0.45, 10, 8)), white, x, y + 0.75, z);
  add(cached('ciwsGun', () => new THREE.CylinderGeometry(0.07, 0.07, 1.1, 5).rotateZ(Math.PI / 2).translate(0.55, 0, 0)), dark, x + 0.2, y + 0.2, z);
}

// Grid of missile cells set into the deck.
function vls(ship, x, y, cols, rows) {
  const add = builder(ship);
  add(cached(`vls${cols}x${rows}`, () => new THREE.BoxGeometry(cols * 0.7 + 0.2, 0.3, rows * 0.7 + 0.2)), grey, x, y + 0.15, 0);
  const hatch = cached('vlsHatch', () => new THREE.BoxGeometry(0.55, 0.06, 0.55));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) add(hatch, dark, x + (i - (cols - 1) / 2) * 0.7, y + 0.32, (j - (rows - 1) / 2) * 0.7);
  }
}

function builder(group) {
  return (geo, m, x, y, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    group.add(o);
    return o;
  };
}

function buildTurret(barrels, finish) {
  const node = new THREE.Group();
  const add = builder(node);
  // Faceted gun house with a sloped front, sitting on a ring.
  add(cached('turretRing', () => new THREE.CylinderGeometry(1.25, 1.3, 0.25, 12)), dark, 0, -0.42);
  add(cached('turretBase', () => new THREE.CylinderGeometry(1.0, 1.25, 0.9, 8)), grey, 0, 0);
  add(cached('turretRoof', () => new THREE.BoxGeometry(1.2, 0.12, 1.4)), deckGrey, -0.2, 0.5);
  add(cached('turretScope', () => new THREE.BoxGeometry(0.3, 0.25, 0.3)), dark, -0.5, 0.65, 0.5);
  const barrelGeo = cached('barrel', () => new THREE.CylinderGeometry(0.1, 0.14, 4, 8).rotateZ(Math.PI / 2).translate(2.2, 0.2, 0));
  const muzzleGeo = cached('muzzleBrake', () => new THREE.CylinderGeometry(0.17, 0.17, 0.35, 8).rotateZ(Math.PI / 2).translate(4.1, 0.2, 0));
  const mantletGeo = cached('mantlet', () => new THREE.BoxGeometry(0.5, 0.45, 0.4).translate(1.05, 0.2, 0));
  for (let i = 0; i < barrels; i++) {
    const z = (i - (barrels - 1) / 2) * 0.55;
    add(barrelGeo, dark, 0, 0, z);
    add(muzzleGeo, dark, 0, 0, z);
    add(mantletGeo, grey, 0, 0, z);
  }
  bake(node, `turret${barrels}`, finish);
  return node;
}

function turret(ship, x, y, scale, barrels, facing) {
  const node = buildTurret(barrels, SHIP_FINISH);
  node.position.set(x, y, 0);
  node.scale.setScalar(scale);
  node.userData.keep = true; // turrets rotate, so they stay separate from the hull
  node.rotation.y = facing;
  ship.add(node);
  return { node, rest: facing, muzzle: new THREE.Vector3(4.3, 0.2, 0) };
}

// Fixed secondary guns: scenery only, baked into the hull.
function secondaryGun(ship, x, y, z, facing) {
  const node = buildTurret(2, SHIP_FINISH);
  node.position.set(x, y, z);
  node.scale.setScalar(0.55);
  node.rotation.y = facing;
  ship.add(node);
}

function mastWithFlag(ship, m, x, height, top, { radome = false, yard = 2.6 } = {}) {
  const add = builder(ship);
  add(cached(`mast${height}`, () => new THREE.CylinderGeometry(0.1, 0.2, height, 6)), dark, x, top - height / 2);
  add(cached(`yard${yard}`, () => new THREE.BoxGeometry(0.1, 0.1, yard)), dark, x, top - height * 0.35);
  add(cached('mastPlatform', () => new THREE.CylinderGeometry(0.6, 0.6, 0.12, 8)), grey, x, top - height * 0.55);
  if (radome) add(cached('radome', () => new THREE.SphereGeometry(0.55, 12, 8)), white, x, top - height * 0.55 + 0.6);
  add(cached('mastLight', () => new THREE.SphereGeometry(0.12, 6, 4)), mastLight, x, top + 0.75);
  add(cached('whip', () => new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4)), dark, x, top + 0.75);
  const radar = add(cached('radar', () => new THREE.BoxGeometry(0.35, 0.35, 2.6)), dark, x, top - 0.6);
  radar.userData.keep = true;
  const flag = add(cached('flag', () => new THREE.PlaneGeometry(1.6, 1).translate(-0.8, 0, 0)), m.accent, x - 0.1, top + 0.1);
  flag.userData.keep = true; // waves in the wind
  return { radar, flag };
}

const BUILDERS = {
  corvette(ship, m) {
    const add = builder(ship);
    const deckY = surfaceHull(ship, m, { len: 14, beam: 3.6, depth: 2.4, y: -1.3 });
    add(cached('cBridge', () => new THREE.BoxGeometry(3.4, 1.6, 2.4)), grey, -0.6, deckY + 0.8);
    add(cached('cBridgeTop', () => new THREE.BoxGeometry(2.2, 0.9, 2.0)), grey, -0.2, deckY + 2.05);
    add(cached('cWin', () => new THREE.BoxGeometry(0.12, 0.35, 1.8)), glass, 0.92, deckY + 2.15);
    add(cached('cWing', () => new THREE.BoxGeometry(0.7, 0.18, 3.0)), grey, 0.5, deckY + 1.55);
    navLights(ship, 0.5, deckY + 1.75, 1.45);
    add(cached('cFunnel', () => new THREE.CylinderGeometry(0.5, 0.6, 1.4, 8)), grey, -2.8, deckY + 0.7);
    add(cached('cFunnelCap', () => new THREE.CylinderGeometry(0.52, 0.52, 0.25, 8)), dark, -2.8, deckY + 1.5);
    add(cached('cFunnelBand', () => new THREE.CylinderGeometry(0.57, 0.57, 0.3, 8)), m.stripe, -2.8, deckY + 1.05);
    // Anti-ship missile canisters angled over the stern.
    const canister = cached('canister', () => new THREE.BoxGeometry(2.2, 0.45, 0.45));
    for (const z of [-0.55, 0.55]) {
      const c = add(canister, grey, -4.8, deckY + 0.6, z);
      c.rotation.z = 0.22;
    }
    for (const z of [-1.25, 1.25]) add(cached('raft', () => new THREE.CylinderGeometry(0.22, 0.22, 0.7, 8).rotateZ(Math.PI / 2)), white, -1.6, deckY + 0.3, z);
    const { radar, flag } = mastWithFlag(ship, m, -0.4, 3.0, deckY + 5.0, { radome: true, yard: 2.0 });
    const guns = [turret(ship, 3.8, deckY + 0.4, 0.7, 1, 0)];
    return { guns, radar, flag, funnel: new THREE.Vector3(-2.8, deckY + 1.6, 0) };
  },

  destroyer(ship, m) {
    const add = builder(ship);
    const deckY = surfaceHull(ship, m, { len: 25, beam: 5, depth: 3, y: -1.6 });
    vls(ship, 4.6, deckY, 3, 3);
    add(cached('dHouse', () => new THREE.BoxGeometry(6, 2.2, 3.6)), grey, 0.5, deckY + 1.1);
    add(cached('dBridge', () => new THREE.BoxGeometry(3.4, 1.4, 3.0)), grey, 1.4, deckY + 2.9);
    add(cached('dWin', () => new THREE.BoxGeometry(0.15, 0.45, 2.8)), glass, 3.12, deckY + 3.1);
    add(cached('dWing', () => new THREE.BoxGeometry(0.8, 0.25, 4.6)), grey, 2.6, deckY + 2.35);
    navLights(ship, 2.6, deckY + 2.6, 2.25);
    for (const z of [-1.95, 1.95]) lifeboat(ship, -1.2, deckY + 1.4, z);
    add(cached('dFunnel', () => new THREE.CylinderGeometry(0.9, 1.1, 2.6, 8)), grey, -3.6, deckY + 1.8);
    add(cached('dCap', () => new THREE.CylinderGeometry(0.92, 0.92, 0.5, 8)), dark, -3.6, deckY + 3.2);
    add(cached('dFunnelBand', () => new THREE.CylinderGeometry(0.99, 0.99, 0.45, 8)), m.stripe, -3.6, deckY + 2.55);
    for (const z of [-0.35, 0.35]) add(cached('exhaust', () => new THREE.CylinderGeometry(0.18, 0.18, 0.6, 6)), dark, -3.6, deckY + 3.6, z);
    // Hangar with a close-in gun on its roof, and depth-charge racks at the stern for hunting subs.
    add(cached('dHangar', () => new THREE.BoxGeometry(3, 2, 3.4)), grey, -6.1, deckY + 1.0);
    ciws(ship, -6.1, deckY + 2.3);
    for (const z of [-1.4, 1.4]) {
      add(cached('dcRack', () => new THREE.BoxGeometry(2.2, 0.15, 0.7)), dark, -11.2, deckY + 0.1, z);
      for (let i = 0; i < 3; i++) add(cached('dCharge', () => new THREE.CylinderGeometry(0.28, 0.28, 0.6, 8).rotateX(Math.PI / 2)), dark, -11.9 + i * 0.7, deckY + 0.45, z);
    }
    const { radar, flag } = mastWithFlag(ship, m, 0.8, 5, deckY + 8.4, { radome: true });
    const guns = [turret(ship, 7, deckY + 0.5, 1, 1, 0), turret(ship, -8.6, deckY + 0.5, 1, 1, Math.PI)];
    return { guns, radar, flag, funnel: new THREE.Vector3(-3.6, deckY + 3.6, 0) };
  },

  battleship(ship, m) {
    const add = builder(ship);
    const deckY = surfaceHull(ship, m, { len: 36, beam: 7.5, depth: 3.6, y: -1.8 });
    add(cached('bHouse', () => new THREE.BoxGeometry(10, 3, 5.5)), grey, -1.5, deckY + 1.5);
    // Pagoda tower: stacked decks topped by the bridge and a fire-control director.
    add(cached('bTower', () => new THREE.BoxGeometry(4, 3, 4)), grey, 0.5, deckY + 4.5);
    add(cached('bTower2', () => new THREE.BoxGeometry(3.2, 1.6, 3.4)), grey, 0.7, deckY + 6.8);
    add(cached('bBridge', () => new THREE.BoxGeometry(3, 1.2, 4.4)), grey, 1.2, deckY + 6.6);
    add(cached('bWin', () => new THREE.BoxGeometry(0.15, 0.45, 4.2)), glass, 2.72, deckY + 6.7);
    add(cached('bDirector', () => new THREE.BoxGeometry(2, 1.1, 2.2)), grey, 0.6, deckY + 8.2);
    add(cached('bRangefinder', () => new THREE.BoxGeometry(0.4, 0.4, 5)), dark, 0.6, deckY + 8.9);
    navLights(ship, 1.6, deckY + 6.0, 2.6);
    for (const z of [-2.1, 2.1]) add(cached('searchlight', () => new THREE.CylinderGeometry(0.3, 0.3, 0.4, 8).rotateZ(Math.PI / 2)), white, 1.8, deckY + 5.3, z);
    const funnelGeo = cached('bFunnel', () => new THREE.CylinderGeometry(1.2, 1.4, 3.4, 8));
    const capGeo = cached('bFunnelCap', () => new THREE.CylinderGeometry(1.22, 1.22, 0.4, 8));
    const bandGeo = cached('bFunnelBand', () => new THREE.CylinderGeometry(1.3, 1.3, 0.5, 8));
    add(funnelGeo, grey, -4.5, deckY + 4.6);
    add(capGeo, dark, -4.5, deckY + 6.4);
    add(bandGeo, m.stripe, -4.5, deckY + 5.6);
    add(funnelGeo, grey, -7.5, deckY + 4.2);
    add(capGeo, dark, -7.5, deckY + 6.0);
    add(bandGeo, m.stripe, -7.5, deckY + 5.2);
    // Secondary battery and anti-aircraft guns along the superstructure.
    for (const z of [-3.0, 3.0]) {
      secondaryGun(ship, 3.2, deckY + 0.35, z, z > 0 ? -Math.PI / 2 : Math.PI / 2);
      secondaryGun(ship, -6.4, deckY + 0.35, z, z > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    for (let i = 0; i < 4; i++) {
      for (const z of [-2.2, 2.2]) {
        add(cached('aaMount', () => new THREE.BoxGeometry(0.6, 0.4, 0.6)), grey, -5 + i * 2.2, deckY + 3.2, z);
        add(cached('aaBarrels', () => new THREE.BoxGeometry(1.2, 0.08, 0.3).translate(0.6, 0, 0)), dark, -5 + i * 2.2, deckY + 3.45, z);
      }
    }
    for (const z of [-2.0, 2.0]) lifeboat(ship, -2.5, deckY + 3.3, z);
    // Aircraft catapult and a little scout plane on the stern.
    const cat = add(cached('catapult', () => new THREE.BoxGeometry(6, 0.25, 0.5)), dark, -14.5, deckY + 0.5);
    cat.rotation.y = 0.35;
    add(cached('planeBody', () => new THREE.CylinderGeometry(0.2, 0.3, 2.4, 6).rotateZ(Math.PI / 2)), grey, -14.2, deckY + 1.0);
    add(cached('planeWing', () => new THREE.BoxGeometry(0.6, 0.06, 3.2)), grey, -13.9, deckY + 1.1);
    add(cached('planeTail', () => new THREE.BoxGeometry(0.4, 0.5, 0.06)), grey, -15.3, deckY + 1.2);
    const { radar, flag } = mastWithFlag(ship, m, 0.5, 4.5, deckY + 12.2, { radome: false, yard: 3.4 });
    const guns = [
      turret(ship, 11, deckY + 0.6, 1.5, 2, 0),
      turret(ship, 6.5, deckY + 1.8, 1.5, 2, 0),
      turret(ship, -12.5, deckY + 0.6, 1.5, 2, Math.PI),
    ];
    return { guns, radar, flag, funnel: new THREE.Vector3(-4.5, deckY + 6.6, 0) };
  },

  submarine(ship, m) {
    const add = builder(ship);
    add(cached('sBody', () => new THREE.CapsuleGeometry(1.5, 15, 4, 16).rotateZ(Math.PI / 2).scale(1, 0.85, 1)), subLivery(m.name, SHIP_FINISH), 0, -0.5);
    ship.userData.pennantSpot = { x: 2.3, y: 1.5, z: 0.58, h: 0.75 };
    add(cached('sDeck', () => new THREE.BoxGeometry(11, 0.12, 1.1)), dark, 0.5, 0.78);
    add(cached('sSail', () => new THREE.BoxGeometry(3.2, 2.6, 1.1)), subHull, 2.5, 1.4);
    add(cached('sSailTop', () => new THREE.BoxGeometry(2.6, 0.2, 0.9)), dark, 2.6, 2.75);
    add(cached('sWin', () => new THREE.BoxGeometry(0.1, 0.3, 0.8)), glass, 4.12, 2.3);
    add(cached('sPlane', () => new THREE.BoxGeometry(1.2, 0.12, 3.6)), subHull, 2.6, 1.8);
    add(cached('sStripe', () => new THREE.BoxGeometry(3.25, 0.3, 1.15)), m.accent, 2.5, 2.4);
    // Periscope, snorkel and antenna masts on the sail.
    add(cached('sPeri', () => new THREE.CylinderGeometry(0.08, 0.08, 1.8, 6)), dark, 2.0, 3.6);
    add(cached('sSnorkel', () => new THREE.CylinderGeometry(0.14, 0.14, 1.2, 6)), dark, 2.9, 3.3);
    add(cached('sAntenna', () => new THREE.CylinderGeometry(0.04, 0.04, 2.2, 4)), dark, 3.4, 3.8);
    for (const x of [-3, 5.5]) add(cached('sHatch', () => new THREE.CylinderGeometry(0.35, 0.35, 0.08, 10)), dark, x, 0.86);
    // Cruciform tail with a shrouded propeller.
    add(cached('sFin', () => new THREE.BoxGeometry(1.6, 3, 0.15)), subHull, -8.5, -0.4);
    add(cached('sFinH', () => new THREE.BoxGeometry(1.6, 0.15, 3.4)), subHull, -8.5, -0.4);
    add(cached('sProp', () => new THREE.ConeGeometry(0.45, 0.9, 8).rotateZ(Math.PI / 2)), dark, -10.1, -0.5);
    add(cached('sShroud', () => new THREE.CylinderGeometry(0.75, 0.75, 0.5, 12, 1, true).rotateZ(Math.PI / 2)), dark, -9.9, -0.5);
    return { guns: [], radar: null, flag: null, funnel: null, bow: new THREE.Vector3(9, -0.5, 0) };
  },
};

// Bridge eye point for the first-person view, in ship-local coordinates (+x is the bow).
const EYES = {
  corvette: [0.7, 4.6],
  destroyer: [1.8, 6.4],
  submarine: [2.4, 3.8],
  battleship: [1.4, 10.2],
};

// liveryId: a key of LIVERIES (see livery.js). pennant: hull number painted on both sides, e.g. "D 14".
export function makeShipModel(type, liveryId, pennant = '') {
  const ship = new THREE.Group();
  ship.userData.type = type;
  const parts = BUILDERS[type](ship, team(liveryId));
  const spot = ship.userData.pennantSpot;
  bake(ship, `${type}-${liveryId}`, SHIP_FINISH);

  const decal = pennantDecal(pennant, liveryId);
  const geo = cached(`pennant${type}`, () => new THREE.PlaneGeometry(spot.h * 2, spot.h));
  for (const side of [1, -1]) {
    const plate = new THREE.Mesh(geo, decal.material);
    plate.position.set(spot.x, spot.y, side * spot.z);
    if (side < 0) plate.rotation.y = Math.PI;
    plate.userData.keep = true;
    ship.add(plate);
  }
  const [ex, ey] = EYES[type];
  ship.userData = { ...parts, normal: new THREE.Vector3(0, 1, 0), eye: new THREE.Vector3(ex, ey, 0), dispose: decal.dispose };
  return ship;
}

// A harbor is a flat island with docks facing the open sea, warehouses, cranes and a fortress gun.
export function makeHarbor(x, z, teamName, seed) {
  const m = team(teamName);
  const { group } = makeIsland({ x, z, r: HARBOR.radius, h: 0, seed, hill: false });
  const add = builder(group);
  const toSea = -Math.sign(z); // docks point toward the middle of the map

  add(cached('hPad', () => new THREE.CylinderGeometry(30, 32, 2, 24)), concrete, 0, 0.3);
  const pierGeo = cached('hPier', () => new THREE.BoxGeometry(4, 1.2, 26));
  for (const px of [-18, 18]) add(pierGeo, concrete, px, 0.6, toSea * 44);

  const shedGeo = cached('hShed', () => new THREE.BoxGeometry(12, 5, 8));
  const roofGeo = cached('hRoof', () => new THREE.BoxGeometry(12.6, 0.6, 8.6));
  for (const [sx, sz] of [[-16, -10], [16, -10], [-16, 6]]) {
    add(shedGeo, grey, sx, 3.8, sz * toSea * -1);
    add(roofGeo, m.hull, sx, 6.5, sz * toSea * -1);
  }

  // Cranes over the piers.
  const craneGeo = cached('hCraneLeg', () => new THREE.BoxGeometry(0.8, 14, 0.8));
  const armGeo = cached('hCraneArm', () => new THREE.BoxGeometry(1, 1, 16));
  for (const cx of [-10, 10]) {
    add(craneGeo, mat(0xd4a017), cx, 8, toSea * 22);
    const arm = add(armGeo, mat(0xd4a017), cx, 15, toSea * 27);
    arm.userData.crane = true;
  }

  // Fortress gun on a bastion facing the sea.
  add(cached('hBastion', () => new THREE.CylinderGeometry(7, 8, 6, 8)), concrete, 0, 4, toSea * 18);
  const gun = turret(group, 0, 7.5, 2.2, 2, toSea > 0 ? -Math.PI / 2 : Math.PI / 2);
  gun.node.position.z = toSea * 18;

  add(cached('hPole', () => new THREE.CylinderGeometry(0.2, 0.2, 18, 6)), dark, 22, 10, 14 * -toSea);
  add(cached('hFlag', () => new THREE.PlaneGeometry(6, 3.5).translate(-3, 0, 0)), m.accent, 22, 17, 14 * -toSea);

  bake(group);
  return { group, gun };
}

const captureRingMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uProgress: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vPos;
    void main() {
      vPos = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uProgress;
    varying vec2 vPos;
    void main() {
      float a = atan(vPos.x, -vPos.y) / 6.2831853 + 0.5;
      float alpha = a < uProgress ? 0.75 : 0.15;
      gl_FragColor = vec4(uColor, alpha);
      #include <colorspace_fragment>
    }
  `,
  transparent: true, depthTest: false, depthWrite: false,
});

// Sea fort on stilts with a flag that changes color with its owner.
export function makeOutpost(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const add = builder(group);
  add(cached('oDeck', () => new THREE.CylinderGeometry(9, 9, 1.5, 6)), concrete, 0, 4);
  const legGeo = cached('oLeg', () => new THREE.CylinderGeometry(0.6, 0.6, 12, 6));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(legGeo, dark, Math.cos(a) * 7, -2, Math.sin(a) * 7);
  }
  add(cached('oTower', () => new THREE.CylinderGeometry(2.5, 3, 7, 6)), grey, 0, 8);
  add(cached('oCap', () => new THREE.CylinderGeometry(3.4, 3.4, 0.6, 6)), dark, 0, 11.8);
  add(cached('oPole', () => new THREE.CylinderGeometry(0.12, 0.12, 6, 5)), dark, 0, 15);
  const flagMat = new THREE.MeshBasicMaterial({ color: 0xdddddd, side: THREE.DoubleSide });
  const flag = add(cached('oFlag', () => new THREE.PlaneGeometry(3, 1.8).translate(-1.5, 0, 0)), flagMat, 0, 17);
  flag.userData.keep = true; // changes color with the owner

  const ring = new THREE.Mesh(
    cached('oRing', () => new THREE.RingGeometry(CAPTURE.radius - 1.2, CAPTURE.radius, 72).rotateX(-Math.PI / 2)),
    captureRingMaterial(),
  );
  ring.renderOrder = 4;
  ring.position.y = 0.6;
  group.add(ring);
  bake(group, 'outpost');
  return { group, flag, ring };
}
