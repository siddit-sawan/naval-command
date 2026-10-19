import * as THREE from 'three';
import { ISLANDS, sampleOcean } from './ocean.js';
import { MAP } from './config.js';
import { bake } from './bake.js';

const UP = new THREE.Vector3(0, 1, 0);
export const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...extra });

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
  bake(crown);
  crown.userData.keep = true; // the crown sways
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

// Builds an island and registers it with the ocean (shore foam, calmer water) and ship steering.
export function makeIsland({ x, z, r, h, seed, palms = 0, lighthouse = false, hill = true }) {
  const rng = mulberry32(seed);
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const beach = new THREE.Mesh(warpRadial(new THREE.CylinderGeometry(r, r * 1.12, 5, 30, 1), seed, 0.05), sand);
  beach.position.y = -2.2;
  g.add(beach);

  if (hill) {
    const mound = new THREE.Mesh(warpRadial(new THREE.CylinderGeometry(r * 0.22, r * 0.65, h, 18, 4), seed + 3, 0.25), grass);
    mound.position.y = 0.3 + h / 2 - 0.4;
    g.add(mound);
  }

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

  bake(g);
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
  light.userData.keep = true; // blinks, so it can't be merged
  g.add(light);
  bake(g, `buoy${color}`);
  g.userData = { light, glow, off, phase, normal: new THREE.Vector3(0, 1, 0) };
  return g;
}

function makeGull() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6).scale(1.7, 0.8, 0.8), white);
  g.add(body);
  const wingShape = (s) => {
    const geo = new THREE.BufferGeometry();
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
  bake(g, 'dolphin');
  g.rotation.order = 'YXZ';
  g.visible = false;
  return g;
}

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Decorative world: islands, buoys, gulls and dolphins. Gameplay objects live in game.js.
export function createScenery(scene, effects) {
  const islands = MAP.islands.map((def) => {
    const island = makeIsland(def);
    scene.add(island.group);
    return island;
  });

  // Channel markers leading out of each harbor.
  const buoyDefs = [];
  for (const { spawn } of Object.values(MAP.harbors)) {
    const dir = Math.sign(spawn.z);
    buoyDefs.push([-28, spawn.z - dir * 10, 0xd93a2b], [28, spawn.z - dir * 10, 0x2fa84f]);
    buoyDefs.push([-30, spawn.z - dir * 60, 0xd93a2b], [30, spawn.z - dir * 60, 0x2fa84f]);
  }
  buoyDefs.push([90, 60, 0xe8b923], [-90, -60, 0xe8b923]);
  const buoys = buoyDefs.map(([x, z, color], i) => {
    const b = makeBuoy(color, i * 0.37);
    b.position.set(x, 0, z);
    scene.add(b);
    return b;
  });

  const gulls = Array.from({ length: 14 }, (_, i) => {
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
  const q = new THREE.Quaternion();

  function updateDolphins(t, focus) {
    if (t > nextPod) {
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 60;
      const heading = Math.random() * Math.PI * 2;
      const px = focus.x + Math.cos(a) * d, pz = focus.z + Math.sin(a) * d;
      // Dolphins don't jump out of dry land.
      const onLand = ISLANDS.some((is) => Math.hypot(px - is.x, pz - is.z) < is.r + 25);
      dolphins.forEach((dl, i) => {
        Object.assign(dl, {
          start: onLand ? Infinity : t + i * 0.35 + Math.random() * 0.15,
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
