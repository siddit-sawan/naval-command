import * as THREE from 'three';
import { ISLANDS, sampleOcean } from './ocean.js';
import { Effects } from './effects.js';

const UP = new THREE.Vector3(0, 1, 0);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

const sand = mat(0xd9c38f);
const grass = mat(0x4f8a3b);
const rock = mat(0x7b7f80);
const bark = mat(0x7a5a3a);
const leaf = mat(0x3f8f3a, { side: THREE.DoubleSide });
const white = mat(0xf2f2ee);
const red = mat(0xc0392b);
const dark = mat(0x22282e);

// Deterministic jitter so vertices shared along seams move together.
function hash3(x, y, z) {
  const s = Math.sin(Math.round(x * 10) * 12.9898 + Math.round(y * 10) * 78.233 + Math.round(z * 10) * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function warpRadial(geo, seed, amount) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ang = Math.atan2(z, x);
    const f = 1 + 0.08 * Math.sin(ang * 3 + seed) + 0.04 * Math.sin(ang * 7 + seed * 1.7) + amount * (hash3(x, y, z) - 0.5);
    p.setXYZ(i, x * f, y, z * f);
  }
  geo.computeVertexNormals();
  return geo;
}

function makePalm(rng) {
  const palm = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, 7, 6).translate(0, 3.5, 0), bark);
  palm.add(trunk);
  const crown = new THREE.Group();
  crown.position.y = 7;
  const frondGeo = new THREE.ConeGeometry(0.9, 5, 3).translate(0, 2.5, 0).scale(1, 1, 0.25);
  for (let i = 0; i < 7; i++) {
    const holder = new THREE.Group();
    holder.rotation.y = (i / 7) * Math.PI * 2 + rng() * 0.4;
    const frond = new THREE.Mesh(frondGeo, leaf);
    frond.rotation.z = -1.75 - rng() * 0.35;
    holder.add(frond);
    crown.add(holder);
  }
  palm.add(crown);
  palm.rotation.set((rng() - 0.5) * 0.4, rng() * Math.PI * 2, (rng() - 0.5) * 0.4);
  palm.scale.setScalar(0.8 + rng() * 0.4);
  palm.userData = { crown, phase: rng() * 10 };
  return palm;
}

function makeLighthouse() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.1, 12, 12).translate(0, 6, 0), white));
  for (const y of [3, 8]) {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.62 - (y - 3) * 0.06, 1.85 - (y - 3) * 0.06, 1.6, 12).translate(0, y, 0), red));
  }
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.4, 12).translate(0, 12.2, 0), dark));
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.6, 10).translate(0, 13.2, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.4) }));
  g.add(lamp);
  g.add(new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.4, 10).translate(0, 14.7, 0), red));

  const beam = new THREE.Group();
  beam.position.y = 13.2;
  // Fades out along its length so the beam has no hard end.
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vAlong;
      void main() {
        vAlong = position.x / 90.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlong;
      void main() {
        float a = 0.22 * pow(1.0 - clamp(abs(vAlong), 0.0, 1.0), 2.0);
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.7) * a, a);
      }
    `,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const coneGeo = new THREE.ConeGeometry(7, 90, 24, 1, true).translate(0, -45, 0).rotateZ(Math.PI / 2);
  beam.add(new THREE.Mesh(coneGeo, beamMat));
  beam.add(new THREE.Mesh(coneGeo, beamMat).rotateY(Math.PI));
  g.add(beam);
  g.userData.beam = beam;
  return g;
}

function makeIsland({ x, z, r, h, seed, palms, lighthouse }) {
  const rng = mulberry32(seed);
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const beach = new THREE.Mesh(warpRadial(new THREE.CylinderGeometry(r, r * 1.12, 5, 30, 1), seed, 0.05), sand);
  beach.position.y = -2.2;
  g.add(beach);

  const hill = new THREE.Mesh(warpRadial(new THREE.CylinderGeometry(r * 0.22, r * 0.65, h, 18, 4), seed + 3, 0.25), grass);
  hill.position.y = 0.3 + h / 2 - 0.4;
  g.add(hill);

  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    const s = 1.5 + rng() * 2.5;
    const boulder = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rock);
    boulder.position.set(Math.cos(a) * r * 0.95, -0.2, Math.sin(a) * r * 0.95);
    boulder.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    g.add(boulder);
  }

  const palmList = [];
  for (let i = 0; i < palms; i++) {
    const a = rng() * Math.PI * 2;
    const d = r * (0.72 + rng() * 0.16);
    const palm = makePalm(rng);
    palm.position.set(Math.cos(a) * d, 0.2, Math.sin(a) * d);
    g.add(palm);
    palmList.push(palm);
  }

  let tower = null;
  if (lighthouse) {
    tower = makeLighthouse();
    tower.position.y = 0.3 + h - 0.6;
    g.add(tower);
  }

  ISLANDS.push({ x, z, r });
  return { group: g, palms: palmList, tower };
}

function makeBuoy(color, phase) {
  const g = new THREE.Group();
  const body = mat(color);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.6, 10).translate(0, 0.2, 0), body));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.6, 10).translate(0, 1.8, 0), body));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 5).translate(0, 3, 0), dark));
  const glow = new THREE.Color(color).multiplyScalar(4);
  const off = new THREE.Color(color).multiplyScalar(0.25);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6).translate(0, 3.6, 0), new THREE.MeshBasicMaterial({ color: off }));
  g.add(light);
  g.userData = { light, glow, off, phase, normal: new THREE.Vector3(0, 1, 0) };
  return g;
}

function makeShip(hullColor) {
  const ship = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-12, -2.3);
  shape.lineTo(5, -2.5);
  shape.quadraticCurveTo(10, -2.1, 12.5, 0);
  shape.quadraticCurveTo(10, 2.1, 5, 2.5);
  shape.lineTo(-12, 2.3);
  shape.closePath();
  const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 3, bevelEnabled: false }).rotateX(-Math.PI / 2);
  const hull = new THREE.Mesh(hullGeo, [mat(0x8d949a), mat(hullColor)]);
  hull.position.y = -1.6;
  ship.add(hull);

  const grey = mat(0xa9b1b8);
  const add = (geo, m, x, y, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); ship.add(o); return o; };
  add(new THREE.BoxGeometry(6, 2.2, 3.6), grey, 0.5, 2.5);
  add(new THREE.BoxGeometry(3.4, 1.4, 3.0), grey, 1.4, 4.3);
  add(new THREE.BoxGeometry(0.2, 0.5, 2.8), dark, 3.15, 4.5);
  add(new THREE.CylinderGeometry(0.12, 0.18, 5, 6), dark, 0.8, 7.3);
  const radar = add(new THREE.BoxGeometry(0.4, 0.3, 2.6), dark, 0.8, 9.6);
  add(new THREE.CylinderGeometry(0.9, 1.1, 2.6, 8), grey, -3.6, 3.2);
  add(new THREE.CylinderGeometry(0.92, 0.92, 0.5, 8), dark, -3.6, 4.6);

  const turret = (x, facing) => {
    const t = new THREE.Group();
    t.position.set(x, 1.9, 0);
    t.add(new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 1, 8), grey));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 4, 6).rotateZ(Math.PI / 2).translate(2.2, 0.2, 0), dark);
    t.add(barrel);
    t.rotation.y = facing;
    ship.add(t);
    return t;
  };
  const guns = [turret(7, 0), turret(-8.5, Math.PI)];

  ship.userData = { radar, guns, normal: new THREE.Vector3(0, 1, 0), funnel: new THREE.Vector3(-3.6, 5, 0) };
  return ship;
}

function makeGull() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6).scale(1.7, 0.8, 0.8), white);
  g.add(body);
  const wingShape = (side) => {
    const geo = new THREE.BufferGeometry();
    const s = side;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0.35, 0, 0, -0.35, 0, 0, -0.25, 0, 1.0 * s,
      0.35, 0, 0, -0.25, 0, 1.0 * s, 0.25, 0, 0.9 * s,
      0.25, 0, 0.9 * s, -0.25, 0, 1.0 * s, -0.45, 0, 1.9 * s,
    ], 3));
    geo.computeVertexNormals();
    return geo;
  };
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, side: THREE.DoubleSide, flatShading: true });
  const right = new THREE.Mesh(wingShape(1), wingMat);
  const left = new THREE.Mesh(wingShape(-1), wingMat);
  g.add(right, left);
  g.userData = { right, left };
  return g;
}

function makeDolphin() {
  const g = new THREE.Group();
  const skin = mat(0x5b7083);
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(2.2, 0.55, 0.6), skin));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 4).translate(-0.2, 0.75, 0).scale(1.2, 1, 0.3), skin));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 1.6).translate(-2.3, 0, 0), skin));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.8, 5).rotateZ(-Math.PI / 2).translate(2.4, -0.05, 0), skin));
  g.rotation.order = 'YXZ';
  g.visible = false;
  return g;
}

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createScenery(scene, effects) {
  const islands = [
    { x: -120, z: 60, r: 30, h: 14, seed: 11, palms: 4, lighthouse: true },
    { x: 140, z: -90, r: 26, h: 10, seed: 23, palms: 5 },
    { x: 40, z: 200, r: 34, h: 18, seed: 37, palms: 6 },
  ].map((def) => {
    const island = makeIsland(def);
    scene.add(island.group);
    return island;
  });

  const buoys = [
    [-20, 30, 0xd93a2b], [20, 30, 0x2fa84f], [-25, -35, 0xd93a2b], [25, -35, 0x2fa84f],
    [100, 40, 0xe8b923], [-60, -90, 0xe8b923],
  ].map(([x, z, color], i) => {
    const b = makeBuoy(color, i * 0.37);
    b.position.set(x, 0, z);
    scene.add(b);
    return b;
  });

  // Ships patrol in circles (center, radius, angular speed) until given a move order.
  const ringGeo = new THREE.RingGeometry(12.5, 13.6, 56).rotateX(-Math.PI / 2);
  const markerGeo = new THREE.RingGeometry(2.2, 3, 32).rotateX(-Math.PI / 2);
  const overlay = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false,
  });
  const ships = [
    { name: 'Valiant', cx: 0, cz: 0, r: 70, w: 0.06, color: 0x55606a, maxSpeed: 7 },
    { name: 'Resolute', cx: 20, cz: -20, r: 95, w: -0.045, color: 0x4a5560, maxSpeed: 6.5 },
    { name: 'Tempest', cx: 90, cz: 110, r: 40, w: 0.09, color: 0x606b52, maxSpeed: 8 },
  ].map((s, i) => {
    const mesh = makeShip(s.color);
    scene.add(mesh);
    const ring = new THREE.Mesh(ringGeo, overlay(0x4cd68a, 0.85));
    const marker = new THREE.Mesh(markerGeo, overlay(0x4cd68a, 0.9));
    const pathGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
    const path = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({
      color: 0x4cd68a, transparent: true, opacity: 0.45, depthTest: false, fog: false,
    }));
    for (const o of [ring, marker, path]) {
      o.visible = false;
      o.renderOrder = 5;
      o.frustumCulled = false;
      scene.add(o);
    }
    return {
      ...s, mesh, ring, marker, path, angle: i * 2.1, mode: 'patrol', x: 0, z: 0, heading: 0, speed: 0,
      target: null, hp: 100, selected: false, hovered: false, wakeAcc: 0, sprayAcc: 0, smokeAcc: 0,
    };
  });

  function steer(s, dt) {
    if (s.mode === 'move') {
      let dx = s.target.x - s.x, dz = s.target.z - s.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 6) {
        s.mode = 'idle';
      } else {
        dx /= dist;
        dz /= dist;
        // Bend the course away from islands that are close by.
        for (const is of ISLANDS) {
          const ox = s.x - is.x, oz = s.z - is.z;
          const d = Math.hypot(ox, oz);
          const clear = is.r + 45;
          if (d < clear) {
            const push = ((clear - d) / 25) * 1.5;
            dx += (ox / d) * push;
            dz += (oz / d) * push;
          }
        }
        const diff = wrapAngle(Math.atan2(dz, dx) - s.heading);
        const turn = 0.6 * dt * (0.3 + s.speed / s.maxSpeed);
        s.heading += THREE.MathUtils.clamp(diff, -turn, turn);
        const want = s.maxSpeed * Math.min(1, dist / 30) * Math.max(0.25, Math.cos(diff));
        s.speed += THREE.MathUtils.clamp(want - s.speed, -3 * dt, 1.5 * dt);
      }
    }
    if (s.mode === 'idle') s.speed = Math.max(0, s.speed - 2 * dt);
    s.x += Math.cos(s.heading) * s.speed * dt;
    s.z += Math.sin(s.heading) * s.speed * dt;
    // Never run aground.
    for (const is of ISLANDS) {
      const ox = s.x - is.x, oz = s.z - is.z;
      const d = Math.hypot(ox, oz);
      const min = is.r + 14;
      if (d < min) {
        s.x = is.x + (ox / d) * min;
        s.z = is.z + (oz / d) * min;
      }
    }
  }

  // Keep hulls from sailing through each other.
  function separate() {
    for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
        const a = ships[i], b = ships[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 0.01;
        if (d < 20) {
          const push = (20 - d) / 2;
          if (a.mode !== 'patrol') { a.x -= (dx / d) * push; a.z -= (dz / d) * push; }
          if (b.mode !== 'patrol') { b.x += (dx / d) * push; b.z += (dz / d) * push; }
        }
      }
    }
  }

  function orderMove(list, x, z) {
    // Fan a group out around the clicked point so they don't pile up.
    list.forEach((s, i) => {
      const a = (i / list.length) * Math.PI * 2;
      const r = list.length > 1 ? 16 : 0;
      s.target = { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
      s.mode = 'move';
    });
  }

  const gulls = Array.from({ length: 12 }, (_, i) => {
    const mesh = makeGull();
    scene.add(mesh);
    const home = islands[i % islands.length].group.position;
    return {
      mesh, cx: home.x + (Math.random() - 0.5) * 30, cz: home.z + (Math.random() - 0.5) * 30,
      r: 20 + Math.random() * 35, w: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2),
      angle: Math.random() * Math.PI * 2, height: 18 + Math.random() * 22, phase: Math.random() * 10,
    };
  });

  const dolphins = Array.from({ length: 3 }, () => {
    const mesh = makeDolphin();
    scene.add(mesh);
    return { mesh, start: Infinity, x: 0, z: 0, dx: 1, dz: 0, splashedIn: false, splashedOut: false };
  });
  let nextPod = 3;

  const tmpN = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const funnelWorld = new THREE.Vector3();

  function updateShip(s, t, dt) {
    if (s.mode === 'patrol') {
      s.angle += s.w * dt;
      s.x = s.cx + Math.cos(s.angle) * s.r;
      s.z = s.cz + Math.sin(s.angle) * s.r;
      const dir = Math.sign(s.w);
      s.heading = Math.atan2(Math.cos(s.angle) * dir, -Math.sin(s.angle) * dir);
      s.speed = Math.abs(s.w) * s.r;
    } else {
      steer(s, dt);
    }
    const x = s.x, z = s.z;
    fwd.set(Math.cos(s.heading), 0, Math.sin(s.heading));

    const h = sampleOcean(x, z, t, tmpN);
    s.ring.visible = s.selected || s.hovered;
    s.ring.material.color.set(s.selected ? 0x4cd68a : 0xcfe8ff);
    s.ring.material.opacity = s.selected ? 0.85 : 0.4;
    s.ring.position.set(x, h + 0.4, z);
    const showOrder = s.selected && s.mode === 'move';
    s.marker.visible = s.path.visible = showOrder;
    if (showOrder) {
      const th = sampleOcean(s.target.x, s.target.z, t) + 0.4;
      s.marker.position.set(s.target.x, th, s.target.z);
      s.marker.scale.setScalar(1 + 0.25 * Math.sin(t * 5));
      s.path.geometry.attributes.position.array.set([x, h + 0.4, z, s.target.x, th, s.target.z]);
      s.path.geometry.attributes.position.needsUpdate = true;
    }
    const n = s.mesh.userData.normal;
    // A big hull doesn't follow every ripple, so ease toward the surface tilt and damp it.
    n.lerp(tmpN.lerp(UP, 0.45), 1 - Math.exp(-dt * 2.5)).normalize();
    side.crossVectors(fwd, n).normalize();
    const f2 = new THREE.Vector3().crossVectors(n, side);
    basis.makeBasis(f2, n, side);
    s.mesh.quaternion.setFromRotationMatrix(basis);
    s.mesh.position.set(x, h * 0.85 - 0.1, z);

    const ud = s.mesh.userData;
    ud.radar.rotation.y += dt * 2.2;
    ud.guns[0].rotation.y = Math.sin(t * 0.3 + s.r) * 0.7;
    ud.guns[1].rotation.y = Math.PI + Math.sin(t * 0.25 + s.r * 2) * 0.6;

    const speed = s.speed;
    const churn = Math.min(1, speed / 4);
    s.wakeAcc += dt * 45 * churn;
    while (s.wakeAcc >= 1) {
      s.wakeAcc--;
      const off = (Math.random() - 0.5) * 3;
      const spread = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.2);
      effects.emit(
        x - fwd.x * 11.5 + side.x * off, 0, z - fwd.z * 11.5 + side.z * off,
        side.x * spread - fwd.x * 0.6, 0, side.z * spread - fwd.z * 0.6,
        { life: 7, size0: 2.2, size1: 8, alpha: 0.55, flags: Effects.FLOAT },
      );
    }
    // Bow wave peeling off both sides.
    s.sprayAcc += dt * 30 * churn;
    while (s.sprayAcc >= 1) {
      s.sprayAcc--;
      const sgn = Math.random() < 0.5 ? -1 : 1;
      const bx = x + fwd.x * 10 + side.x * sgn * 1.6;
      const bz = z + fwd.z * 10 + side.z * sgn * 1.6;
      effects.emit(bx, 0, bz, side.x * sgn * (1.5 + speed * 0.3), 0, side.z * sgn * (1.5 + speed * 0.3),
        { life: 4, size0: 1.5, size1: 5, alpha: 0.6, flags: Effects.FLOAT });
      if (Math.random() < 0.4) {
        effects.emit(bx, h + 0.5, bz, side.x * sgn * 2 + fwd.x * speed, 2 + Math.random() * 2.5, side.z * sgn * 2 + fwd.z * speed,
          { life: 0.8, size0: 0.8, size1: 0.4, alpha: 0.8, flags: Effects.GRAVITY });
      }
    }
    s.smokeAcc += dt * 7;
    if (s.smokeAcc >= 1) s.mesh.updateMatrixWorld();
    while (s.smokeAcc >= 1) {
      s.smokeAcc--;
      funnelWorld.copy(ud.funnel).applyMatrix4(s.mesh.matrixWorld);
      effects.emit(funnelWorld.x, funnelWorld.y, funnelWorld.z,
        1.6 + Math.random() * 0.6, 1.8 + Math.random(), 0.6 + Math.random() * 0.4,
        { life: 4.5, size0: 2, size1: 9, alpha: 0.35, color: [0.5, 0.52, 0.55] });
    }
  }

  function updateDolphins(t, focus) {
    if (t > nextPod) {
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 60;
      const heading = Math.random() * Math.PI * 2;
      const px = focus.x + Math.cos(a) * d, pz = focus.z + Math.sin(a) * d;
      dolphins.forEach((dl, i) => {
        Object.assign(dl, {
          start: t + i * 0.35 + Math.random() * 0.15,
          x: px + Math.cos(heading + 1.57) * (i - 1) * 3 - Math.cos(heading) * i * 2,
          z: pz + Math.sin(heading + 1.57) * (i - 1) * 3 - Math.sin(heading) * i * 2,
          dx: Math.cos(heading), dz: Math.sin(heading), splashedIn: false, splashedOut: false,
        });
      });
      nextPod = t + 6 + Math.random() * 6;
    }
    const DUR = 1.7, LEN = 14, PEAK = 4.5, BASE = -2;
    for (const dl of dolphins) {
      const u = (t - dl.start) / DUR;
      if (u < 0 || u > 1) { dl.mesh.visible = false; continue; }
      dl.mesh.visible = true;
      const x = dl.x + dl.dx * LEN * u, z = dl.z + dl.dz * LEN * u;
      const y = BASE + (PEAK - BASE) * 4 * u * (1 - u);
      dl.mesh.position.set(x, y, z);
      const slope = ((PEAK - BASE) * 4 * (1 - 2 * u)) / LEN;
      dl.mesh.rotation.set(0, Math.atan2(-dl.dz, dl.dx), Math.atan(slope));
      if (!dl.splashedOut && u > 0.12) { dl.splashedOut = true; effects.splash(x, z, t, 0.6); }
      if (!dl.splashedIn && u > 0.88) { dl.splashedIn = true; effects.splash(x, z, t, 0.8); }
    }
  }

  return {
    ships,
    orderMove,
    update(t, dt, focus) {
      for (const isl of islands) {
        for (const palm of isl.palms) {
          const { crown, phase } = palm.userData;
          crown.rotation.x = Math.sin(t * 1.3 + phase) * 0.08;
          crown.rotation.z = Math.sin(t * 0.9 + phase * 2) * 0.06;
        }
        if (isl.tower) isl.tower.userData.beam.rotation.y = t * 0.8;
      }

      for (const b of buoys) {
        const h = sampleOcean(b.position.x, b.position.z, t, tmpN);
        const ud = b.userData;
        ud.normal.lerp(tmpN, 1 - Math.exp(-dt * 6)).normalize();
        b.position.y = h - 0.3;
        q.setFromUnitVectors(UP, ud.normal);
        b.quaternion.copy(q);
        const on = (t + ud.phase) % 2.4 < 0.35;
        ud.light.material.color.copy(on ? ud.glow : ud.off);
      }

      for (const s of ships) updateShip(s, t, dt);
      separate();

      for (const gl of gulls) {
        gl.angle += gl.w * dt;
        const x = gl.cx + Math.cos(gl.angle) * gl.r;
        const z = gl.cz + Math.sin(gl.angle) * gl.r;
        const dir = Math.sign(gl.w);
        const fx = -Math.sin(gl.angle) * dir, fz = Math.cos(gl.angle) * dir;
        gl.mesh.position.set(x, gl.height + Math.sin(t * 0.4 + gl.phase) * 3, z);
        gl.mesh.rotation.order = 'YXZ';
        gl.mesh.rotation.set(dir * 0.35, Math.atan2(-fz, fx), 0);
        // Bursts of flapping between glides.
        const flapping = THREE.MathUtils.smoothstep(Math.sin(t * 0.5 + gl.phase), -0.2, 0.3);
        const flap = 0.12 + flapping * 0.65 * Math.sin(t * 9 + gl.phase);
        gl.mesh.userData.right.rotation.x = -flap;
        gl.mesh.userData.left.rotation.x = flap;
      }

      updateDolphins(t, focus);
    },
  };
}
