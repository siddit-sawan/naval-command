import * as THREE from 'three';
import { mat, makeIsland } from './scenery.js';
import { TEAM_COLORS, HARBOR, CAPTURE } from './config.js';
import { bake } from './bake.js';

const deckGrey = mat(0x8d949a);
const grey = mat(0xa9b1b8);
const dark = mat(0x22282e);
const concrete = mat(0x9a9a92);
const subHull = mat(0x2b3138);

const teamMats = {};
function team(teamName) {
  if (!teamMats[teamName]) {
    const c = TEAM_COLORS[teamName];
    teamMats[teamName] = {
      hull: mat(c.hull),
      accent: new THREE.MeshBasicMaterial({ color: c.accent, side: THREE.DoubleSide }),
    };
  }
  return teamMats[teamName];
}

const geoCache = new Map();
function cached(key, build) {
  if (!geoCache.has(key)) geoCache.set(key, build());
  return geoCache.get(key);
}

// Top-down hull outline with a pointed bow at +x, extruded upward.
function hullGeo(len, beam, depth) {
  return cached(`hull${len}`, () => {
    const L = len / 2, B = beam / 2;
    const s = new THREE.Shape();
    s.moveTo(-L, -B * 0.9);
    s.lineTo(L * 0.4, -B);
    s.quadraticCurveTo(L * 0.8, -B * 0.85, L, 0);
    s.quadraticCurveTo(L * 0.8, B * 0.85, L * 0.4, B);
    s.lineTo(-L, B * 0.9);
    s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }).rotateX(-Math.PI / 2);
  });
}

function builder(group) {
  return (geo, m, x, y, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    group.add(o);
    return o;
  };
}

function turret(ship, x, y, scale, barrels, facing) {
  const node = new THREE.Group();
  node.position.set(x, y, 0);
  node.scale.setScalar(scale);
  node.add(new THREE.Mesh(cached('turretBase', () => new THREE.CylinderGeometry(1.1, 1.3, 1, 8)), grey));
  const barrelGeo = cached('barrel', () => new THREE.CylinderGeometry(0.13, 0.13, 4, 6).rotateZ(Math.PI / 2).translate(2.2, 0.2, 0));
  for (let i = 0; i < barrels; i++) {
    const b = new THREE.Mesh(barrelGeo, dark);
    b.position.z = (i - (barrels - 1) / 2) * 0.5;
    node.add(b);
  }
  bake(node, `turret${barrels}`);
  node.userData.keep = true; // turrets rotate, so they stay separate from the hull
  node.rotation.y = facing;
  ship.add(node);
  return { node, rest: facing, muzzle: new THREE.Vector3(4.2, 0.2, 0) };
}

function mastWithFlag(ship, m, x, height, top) {
  const add = builder(ship);
  add(cached(`mast${height}`, () => new THREE.CylinderGeometry(0.12, 0.18, height, 6)), dark, x, top - height / 2);
  const radar = add(cached('radar', () => new THREE.BoxGeometry(0.4, 0.3, 2.6)), dark, x, top - 0.6);
  radar.userData.keep = true;
  add(cached('flag', () => new THREE.PlaneGeometry(1.6, 1).translate(-0.8, 0, 0)), m.accent, x, top + 0.2);
  return radar;
}

const BUILDERS = {
  corvette(ship, m) {
    const add = builder(ship);
    add(hullGeo(14, 3.6, 2.4), [deckGrey, m.hull], 0, -1.3);
    add(cached('cBridge', () => new THREE.BoxGeometry(3.4, 1.6, 2.4)), grey, -0.6, 1.9);
    add(cached('cWin', () => new THREE.BoxGeometry(0.15, 0.4, 2.0)), dark, 1.15, 2.2);
    add(cached('cFunnel', () => new THREE.CylinderGeometry(0.5, 0.6, 1.4, 8)), grey, -3.4, 1.8);
    const radar = mastWithFlag(ship, m, -0.6, 3.2, 5.6);
    const guns = [turret(ship, 3.8, 1.5, 0.7, 1, 0)];
    return { guns, radar, funnel: new THREE.Vector3(-3.4, 2.6, 0) };
  },
  destroyer(ship, m) {
    const add = builder(ship);
    add(hullGeo(25, 5, 3), [deckGrey, m.hull], 0, -1.6);
    add(cached('dHouse', () => new THREE.BoxGeometry(6, 2.2, 3.6)), grey, 0.5, 2.5);
    add(cached('dBridge', () => new THREE.BoxGeometry(3.4, 1.4, 3.0)), grey, 1.4, 4.3);
    add(cached('dWin', () => new THREE.BoxGeometry(0.2, 0.5, 2.8)), dark, 3.15, 4.5);
    add(cached('dFunnel', () => new THREE.CylinderGeometry(0.9, 1.1, 2.6, 8)), grey, -3.6, 3.2);
    add(cached('dCap', () => new THREE.CylinderGeometry(0.92, 0.92, 0.5, 8)), dark, -3.6, 4.6);
    const radar = mastWithFlag(ship, m, 0.8, 5, 9.8);
    const guns = [turret(ship, 7, 1.9, 1, 1, 0), turret(ship, -8.5, 1.9, 1, 1, Math.PI)];
    return { guns, radar, funnel: new THREE.Vector3(-3.6, 5, 0) };
  },
  battleship(ship, m) {
    const add = builder(ship);
    add(hullGeo(36, 7.5, 3.6), [deckGrey, m.hull], 0, -1.8);
    add(cached('bHouse', () => new THREE.BoxGeometry(10, 3, 5.5)), grey, -1.5, 3.3);
    add(cached('bTower', () => new THREE.BoxGeometry(4, 3, 4)), grey, 0.5, 6.3);
    add(cached('bBridge', () => new THREE.BoxGeometry(3, 1.2, 4.4)), grey, 1.2, 8.4);
    add(cached('bWin', () => new THREE.BoxGeometry(0.2, 0.5, 4.2)), dark, 2.75, 8.5);
    const funnelGeo = cached('bFunnel', () => new THREE.CylinderGeometry(1.2, 1.4, 3.4, 8));
    add(funnelGeo, grey, -4.5, 6.4);
    add(funnelGeo, grey, -7.5, 6.0);
    const radar = mastWithFlag(ship, m, 0.5, 5, 13.5);
    const guns = [
      turret(ship, 11, 2.4, 1.5, 2, 0),
      turret(ship, 6.5, 3.6, 1.5, 2, 0),
      turret(ship, -12.5, 2.4, 1.5, 2, Math.PI),
    ];
    return { guns, radar, funnel: new THREE.Vector3(-4.5, 8.4, 0) };
  },
  submarine(ship, m) {
    const add = builder(ship);
    const body = add(cached('sBody', () => new THREE.CapsuleGeometry(1.5, 15, 4, 12).rotateZ(Math.PI / 2).scale(1, 0.85, 1)), subHull, 0, -0.5);
    add(cached('sSail', () => new THREE.BoxGeometry(3.2, 2.6, 1.1)), subHull, 2.5, 1.4);
    add(cached('sPlane', () => new THREE.BoxGeometry(1.2, 0.12, 3.6)), subHull, 2.6, 1.8);
    add(cached('sFin', () => new THREE.BoxGeometry(1.6, 3, 0.15)), subHull, -8.5, -0.4);
    add(cached('sFinH', () => new THREE.BoxGeometry(1.6, 0.15, 3.4)), subHull, -8.5, -0.4);
    add(cached('sStripe', () => new THREE.BoxGeometry(3.25, 0.35, 1.15)), m.accent, 2.5, 2.4);
    add(cached('sPeri', () => new THREE.CylinderGeometry(0.08, 0.08, 1.6, 5)), dark, 2.0, 3.3);
    body.userData.hull = true;
    return { guns: [], radar: null, funnel: null, bow: new THREE.Vector3(9, -0.5, 0) };
  },
};

export function makeShipModel(type, teamName) {
  const ship = new THREE.Group();
  const parts = BUILDERS[type](ship, team(teamName));
  bake(ship, `${type}-${teamName}`);
  ship.userData = { ...parts, normal: new THREE.Vector3(0, 1, 0) };
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
