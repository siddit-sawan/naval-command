import * as THREE from 'three';
import { UNITS, HARBOR, ECONOMY, CAPTURE, MAP, REVEAL_TIME, DIFFICULTY, TEAM_COLORS } from './config.js';
import { makeShipModel, makeHarbor, makeOutpost } from './models.js';
import { ISLANDS, sampleOcean } from './ocean.js';
import { Effects } from './effects.js';
import { sfx } from './audio.js';
import { EnemyAI } from './ai.js';

export const other = (team) => (team === 'player' ? 'enemy' : 'player');

const UP = new THREE.Vector3(0, 1, 0);
const SHIP_NAMES = [
  'Valiant', 'Resolute', 'Tempest', 'Defiant', 'Intrepid', 'Vigilant', 'Dauntless', 'Swiftsure',
  'Indomitable', 'Relentless', 'Courageous', 'Audacious', 'Invincible', 'Formidable', 'Triumph', 'Victorious',
];

const overlayMat = (color, opacity) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false,
});

const ringGeos = new Map();
function ringGeo(size) {
  if (!ringGeos.has(size)) {
    const r = size * 0.55;
    ringGeos.set(size, new THREE.RingGeometry(r, r + 1.1, 56).rotateX(-Math.PI / 2));
  }
  return ringGeos.get(size);
}
const markerGeo = new THREE.RingGeometry(2.2, 3, 32).rotateX(-Math.PI / 2);
const barBgGeo = new THREE.PlaneGeometry(1, 0.2);
const barFgGeo = new THREE.PlaneGeometry(1, 0.2).translate(0.5, 0, 0);
const barBgMat = overlayMat(0x101820, 0.75);
const shellGeo = new THREE.SphereGeometry(0.45, 6, 4);
const shellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.2) });
const torpGeo = new THREE.CapsuleGeometry(0.3, 2.4, 2, 6).rotateZ(Math.PI / 2);
const torpMat = new THREE.MeshBasicMaterial({ color: 0x1a1f24 });

// Scratch objects reused every frame to avoid garbage-collection hitches.
const TMP = {
  tmpN: new THREE.Vector3(), fwd: new THREE.Vector3(), side: new THREE.Vector3(),
  f2: new THREE.Vector3(), up: new THREE.Vector3(), basis: new THREE.Matrix4(), funnel: new THREE.Vector3(),
};
const EFFECTS_RANGE = 380;

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function makeHealthBar(width) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(barBgGeo, barBgMat);
  const fg = new THREE.Mesh(barFgGeo, overlayMat(0x4cd68a, 0.95));
  fg.position.set(-0.5, 0, 0.001);
  g.add(bg, fg);
  g.scale.set(width, width * 0.9, 1);
  g.renderOrder = 6;
  bg.renderOrder = 6;
  fg.renderOrder = 7;
  g.userData.fg = fg;
  g.visible = false;
  return g;
}

function setHealthBar(bar, frac) {
  const fg = bar.userData.fg;
  fg.scale.x = Math.max(0.001, frac);
  fg.material.color.set(frac > 0.6 ? 0x4cd68a : frac > 0.3 ? 0xf0b429 : 0xff5a4f);
}

// One of each projectile, so the loading screen can compile their shaders before the first shot.
export function warmupMeshes() {
  return [new THREE.Mesh(shellGeo, shellMat), new THREE.Mesh(torpGeo, torpMat)];
}

export class Game {
  /**
   * hooks: { toast(text, color), onGameOver(winner) }. In demo mode both fleets are AI-controlled and silent.
   */
  constructor(scene, effects, { difficulty = 'normal', demo = false, hooks = {} } = {}) {
    this.scene = scene;
    this.effects = effects;
    this.demo = demo;
    this.diff = DIFFICULTY[difficulty];
    this.hooks = { toast() {}, onGameOver() {}, ...hooks };
    this.root = new THREE.Group();
    scene.add(this.root);
    this.islandCount = ISLANDS.length;

    this.time = 0;
    this.t = 0;
    this.units = [];
    this.projectiles = [];
    this.listener = { x: 0, z: 0 };
    this.over = null;
    this.nextId = 1;
    this.nameIndex = 0;
    this.alerts = { unit: -99, harbor: -99 };

    this.teams = {};
    this.harbors = {};
    for (const team of ['player', 'enemy']) {
      this.teams[team] = { gold: ECONOMY.startGold, queue: [], buildT: 0, built: 0, lost: 0, kills: 0 };
      const def = MAP.harbors[team];
      const { group, gun } = makeHarbor(def.x, def.z, team, team === 'player' ? 101 : 202);
      this.root.add(group);
      const bar = makeHealthBar(30);
      this.root.add(bar);
      this.harbors[team] = {
        kind: 'harbor', team, x: def.x, z: def.z, spawn: def.spawn, radius: HARBOR.radius,
        hp: HARBOR.hp, maxHp: HARBOR.hp, alive: true, gun, cooldown: 2, group, bar, dyingT: -1,
        hovered: false, lastHit: -99,
      };
    }

    this.outposts = MAP.outposts.map(({ x, z }) => {
      const o = makeOutpost(x, z);
      this.root.add(o.group);
      return { x, z, owner: null, progress: 0, ...o };
    });

    this.ai = demo
      ? [new EnemyAI(this, 'enemy', DIFFICULTY.normal), new EnemyAI(this, 'player', DIFFICULTY.normal)]
      : [new EnemyAI(this, 'enemy', this.diff)];

    // A couple of starting ships each so the sea isn't empty.
    for (const team of ['player', 'enemy']) {
      for (const type of ['destroyer', 'corvette']) this.spawn(team, type, true);
    }
  }

  dispose() {
    this.scene.remove(this.root);
    // Harbors registered themselves as islands; drop them so the next game starts clean.
    ISLANDS.length = this.islandCount;
  }

  // ---------- Queries ----------

  alive(team) {
    return this.units.filter((u) => u.alive && (!team || u.team === team));
  }

  incomeOf(team) {
    const owned = this.outposts.filter((o) => o.owner === team).length;
    const mult = team === 'enemy' && !this.demo ? this.diff.income : 1;
    return (ECONOMY.baseIncome + owned * ECONOMY.outpostIncome) * mult;
  }

  // Submarines are hidden unless an enemy is close enough to detect them, or they recently fired.
  visibleTo(e, team) {
    if (e.team === team || e.kind !== 'ship' || !e.stats.stealth) return true;
    return e.spotted;
  }

  distTo(a, b) {
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    return b.kind === 'harbor' ? d - b.radius * 0.8 : d;
  }

  findTarget(u, radius) {
    let best = null, bestD = radius;
    const foe = other(u.team);
    for (const e of this.units) {
      if (!e.alive || e.team !== foe || !this.visibleTo(e, u.team)) continue;
      const d = this.distTo(u, e);
      if (d < bestD) { best = e; bestD = d; }
    }
    const h = this.harbors[foe];
    if (h.alive && this.distTo(u, h) < bestD) best = h;
    return best;
  }

  volumeAt(x, z) {
    if (this.demo) return 0;
    return THREE.MathUtils.clamp(1 - Math.hypot(x - this.listener.x, z - this.listener.z) / 450, 0, 1);
  }

  // ---------- Commands ----------

  queueBuild(team, type) {
    const t = this.teams[team];
    const stats = UNITS[type];
    if (t.queue.length >= ECONOMY.maxQueue) return 'Build queue is full';
    if (t.gold < stats.cost) return 'Not enough gold';
    t.gold -= stats.cost;
    t.queue.push(type);
    return null;
  }

  order(units, cmd) {
    const list = units.filter((u) => u.alive);
    const n = list.length;
    list.forEach((u, i) => {
      u.engage = null;
      if (cmd.type === 'attack') {
        u.mode = 'attack';
        u.attackTarget = cmd.target;
        u.target = null;
        return;
      }
      // Fan a group out around the point so ships don't pile up.
      const a = (i / n) * Math.PI * 2;
      const r = n > 1 ? 8 + 5 * Math.sqrt(n) : 0;
      u.target = { x: cmd.x + Math.cos(a) * r, z: cmd.z + Math.sin(a) * r };
      u.attackTarget = null;
      u.mode = cmd.type; // 'move' or 'attackmove'
    });
  }

  // ---------- Spawning ----------

  spawn(team, type, initial = false) {
    const stats = UNITS[type];
    const h = this.harbors[team];
    const toSea = -Math.sign(h.z);
    const mesh = makeShipModel(type, team);
    this.root.add(mesh);
    const ring = new THREE.Mesh(ringGeo(stats.size), overlayMat(0x4cd68a, 0.85));
    const marker = new THREE.Mesh(markerGeo, overlayMat(0x4cd68a, 0.9));
    const path = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(6, 3)),
      new THREE.LineBasicMaterial({ color: 0x4cd68a, transparent: true, opacity: 0.45, depthTest: false, fog: false }),
    );
    const bar = makeHealthBar(Math.max(8, stats.size * 0.5));
    for (const o of [ring, marker, path, bar]) {
      o.visible = false;
      o.renderOrder = Math.max(o.renderOrder, 5);
      o.frustumCulled = false;
      this.root.add(o);
    }

    const x = h.spawn.x + (Math.random() - 0.5) * (initial ? 60 : 24);
    const z = h.z + toSea * (initial ? 80 + Math.random() * 20 : 62);
    const name = team === 'player' ? SHIP_NAMES[this.nameIndex++ % SHIP_NAMES.length] : null;
    const u = {
      kind: 'ship', id: this.nextId++, type, stats, team, name,
      x, z, heading: toSea > 0 ? Math.PI / 2 : -Math.PI / 2, speed: initial ? 0 : stats.speed * 0.4,
      hp: stats.hp, maxHp: stats.hp, alive: true, mode: 'idle', target: null, attackTarget: null, engage: null,
      cooldown: Math.random() * stats.reload, scanT: Math.random() * 0.3, spotted: false, revealedUntil: 0,
      mesh, ring, marker, path, bar, selected: false, hovered: false, sinkT: 0, lastHit: -99,
      wakeAcc: 0, sprayAcc: 0, smokeAcc: 0,
    };
    this.units.push(u);
    if (!initial) {
      this.order([u], { type: 'move', x: h.spawn.x + (Math.random() - 0.5) * 60, z: h.spawn.z + (Math.random() - 0.5) * 30 });
    }
    return u;
  }

  // ---------- Simulation ----------

  update(t, dt, camera) {
    this.t = t;
    if (dt <= 0) {
      this.updateVisuals(dt, camera);
      return;
    }
    this.time += dt;

    if (!this.over) {
      for (const team of ['player', 'enemy']) this.updateEconomy(team, dt);
      for (const ai of this.ai) ai.update(dt);
    }
    this.updateSpotting();
    for (const u of this.units) this.updateUnit(u, dt);
    this.separate();
    this.units = this.units.filter((u) => u.alive || u.sinkT < 5);
    for (const h of Object.values(this.harbors)) this.updateHarbor(h, dt);
    this.updateOutposts(dt);
    this.updateProjectiles(dt);
    this.updateVisuals(dt, camera);
  }

  updateEconomy(team, dt) {
    const t = this.teams[team];
    t.gold += this.incomeOf(team) * dt;
    if (!t.queue.length) { t.buildT = 0; return; }
    if (this.alive(team).length >= ECONOMY.maxShips) return;
    t.buildT += dt;
    const type = t.queue[0];
    if (t.buildT >= UNITS[type].build) {
      t.queue.shift();
      t.buildT = 0;
      t.built++;
      this.spawn(team, type);
      if (team === 'player' && !this.demo) {
        this.hooks.toast(`${UNITS[type].label} ready`, TEAM_COLORS.player.css);
        sfx.built();
      }
    }
  }

  updateSpotting() {
    for (const u of this.units) {
      if (!u.alive || !u.stats.stealth) continue;
      if (this.time < u.revealedUntil) { u.spotted = true; continue; }
      const foe = other(u.team);
      const h = this.harbors[foe];
      u.spotted = (h.alive && Math.hypot(u.x - h.x, u.z - h.z) < HARBOR.detect)
        || this.units.some((e) => e.alive && e.team === foe && Math.hypot(u.x - e.x, u.z - e.z) < e.stats.detect);
    }
  }

  validTarget(u, e) {
    return e && e.alive && this.visibleTo(e, u.team) && !(e.kind === 'harbor' && e.dyingT >= 0);
  }

  updateUnit(u, dt) {
    if (!u.alive) {
      this.updateSinking(u, dt);
      return;
    }
    const s = u.stats;
    if (u.attackTarget && !this.validTarget(u, u.attackTarget)) {
      u.attackTarget = null;
      if (u.mode === 'attack') u.mode = 'idle';
    }
    if (u.engage && (!this.validTarget(u, u.engage) || this.distTo(u, u.engage) > s.range + 60)) u.engage = null;

    u.scanT -= dt;
    if (u.scanT <= 0) {
      u.scanT = 0.3 + Math.random() * 0.1;
      // Attack-move hunts anything nearby; other orders only shoot what is already in range.
      const radius = u.mode === 'attackmove' ? s.range + 45 : s.range;
      const found = this.findTarget(u, radius);
      if (found) u.engage = found;
    }

    // Decide where to go.
    let dest = null;
    const chase = u.mode === 'attack' ? u.attackTarget : u.mode === 'attackmove' ? u.engage : null;
    if (chase) {
      if (this.distTo(u, chase) > s.range * 0.85) dest = chase;
    } else if ((u.mode === 'move' || u.mode === 'attackmove') && u.target) {
      if (Math.hypot(u.target.x - u.x, u.target.z - u.z) < 6 + s.size * 0.2) {
        u.mode = 'idle';
        u.target = null;
      } else {
        dest = u.target;
      }
    }
    this.steer(u, dest, dt);

    // Shoot.
    u.cooldown -= dt;
    let fireAt = null;
    if (u.attackTarget && this.distTo(u, u.attackTarget) <= s.range) fireAt = u.attackTarget;
    else if (u.engage && this.distTo(u, u.engage) <= s.range) fireAt = u.engage;
    u.aimAt = fireAt || u.attackTarget || u.engage;
    if (fireAt && u.cooldown <= 0) {
      this.fire(u, fireAt);
      u.cooldown = s.reload * (0.9 + Math.random() * 0.2);
    }
  }

  steer(u, dest, dt) {
    const s = u.stats;
    if (dest) {
      let dx = dest.x - u.x, dz = dest.z - u.z;
      const dist = Math.hypot(dx, dz) || 1;
      dx /= dist;
      dz /= dist;
      // Bend the course away from nearby islands.
      for (const is of ISLANDS) {
        const ox = u.x - is.x, oz = u.z - is.z;
        const d = Math.hypot(ox, oz);
        const clear = is.r + 45;
        if (d < clear) {
          const push = ((clear - d) / 25) * 1.5;
          dx += (ox / d) * push;
          dz += (oz / d) * push;
        }
      }
      const diff = wrapAngle(Math.atan2(dz, dx) - u.heading);
      const turn = s.turn * dt * (0.3 + u.speed / s.speed);
      u.heading += THREE.MathUtils.clamp(diff, -turn, turn);
      const want = s.speed * Math.min(1, dist / 30) * Math.max(0.25, Math.cos(diff));
      u.speed += THREE.MathUtils.clamp(want - u.speed, -3 * dt, 1.5 * dt);
    } else {
      u.speed = Math.max(0, u.speed - 2 * dt);
    }
    u.x += Math.cos(u.heading) * u.speed * dt;
    u.z += Math.sin(u.heading) * u.speed * dt;
    // Never run aground or sail off the map.
    for (const is of ISLANDS) {
      const ox = u.x - is.x, oz = u.z - is.z;
      const d = Math.hypot(ox, oz) || 1;
      const min = is.r + s.size * 0.3 + 6;
      if (d < min) {
        u.x = is.x + (ox / d) * min;
        u.z = is.z + (oz / d) * min;
      }
    }
    u.x = THREE.MathUtils.clamp(u.x, -MAP.bounds, MAP.bounds);
    u.z = THREE.MathUtils.clamp(u.z, -MAP.bounds, MAP.bounds);
  }

  // Keep hulls from sailing through each other.
  separate() {
    const live = this.units.filter((u) => u.alive);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        // Submarines can pass beneath surface ships.
        if (a.stats.stealth !== b.stats.stealth) continue;
        const min = (a.stats.size + b.stats.size) * 0.4;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 0.01;
        if (d < min) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
    }
  }

  // ---------- Combat ----------

  fire(u, target) {
    const s = u.stats;
    const acc = u.team === 'enemy' || this.demo ? this.diff.accuracy : 0.9;
    const vol = this.volumeAt(u.x, u.z);
    if (s.weapon === 'torpedo') {
      const lead = this.leadPoint(u, target, 24);
      const dx = lead.x - u.x, dz = lead.z - u.z;
      const d = Math.hypot(dx, dz) || 1;
      const bow = u.mesh.userData.bow.clone().applyMatrix4(u.mesh.matrixWorld);
      const mesh = new THREE.Mesh(torpGeo, torpMat);
      mesh.rotation.y = -Math.atan2(dz, dx);
      this.root.add(mesh);
      this.projectiles.push({
        kind: 'torpedo', team: u.team, x: bow.x, z: bow.z, dx: dx / d, dz: dz / d, speed: 24,
        traveled: 0, maxDist: s.range * 1.6, damage: s.damage, mesh, bubbleAcc: 0,
      });
      u.revealedUntil = this.time + REVEAL_TIME;
      sfx.torpedo(vol);
      return;
    }

    const guns = u.mesh.userData.guns;
    const dist = this.distTo(u, target);
    const dur = 0.4 + dist / 110;
    const lead = this.leadPoint(u, target, dist / dur);
    const scatter = (1 - acc) * 26 + dist * 0.02;
    u.mesh.updateMatrixWorld();
    guns.forEach((g, i) => {
      const from = g.muzzle.clone().applyMatrix4(g.node.matrixWorld);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * scatter;
      const mesh = new THREE.Mesh(shellGeo, shellMat);
      mesh.position.copy(from);
      this.root.add(mesh);
      this.projectiles.push({
        kind: 'shell', team: u.team, from, to: { x: lead.x + Math.cos(a) * r, z: lead.z + Math.sin(a) * r },
        t: -i * 0.08, dur, arc: 4 + dist * 0.18, damage: s.damage / guns.length, splash: s.splash || 0,
        subBonus: s.subBonus || 1, target, mesh, trailAcc: 0,
      });
      this.muzzleFlash(from, g);
    });
    sfx.gun(vol, u.type === 'battleship');
  }

  leadPoint(u, target, projectileSpeed) {
    if (target.kind !== 'ship') return { x: target.x, z: target.z };
    const time = Math.hypot(target.x - u.x, target.z - u.z) / projectileSpeed;
    return {
      x: target.x + Math.cos(target.heading) * target.speed * time,
      z: target.z + Math.sin(target.heading) * target.speed * time,
    };
  }

  muzzleFlash(p, gun) {
    const fx = this.effects;
    const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(gun.node.getWorldQuaternion(new THREE.Quaternion()));
    for (let i = 0; i < 6; i++) {
      fx.emit(p.x, p.y, p.z, dir.x * 8 + (Math.random() - 0.5) * 3, Math.random() * 2, dir.z * 8 + (Math.random() - 0.5) * 3,
        { life: 0.25, size0: 2.5, size1: 0.5, alpha: 1, color: [1, 0.75, 0.35] });
    }
    for (let i = 0; i < 3; i++) {
      fx.emit(p.x, p.y, p.z, dir.x * 3, 1 + Math.random(), dir.z * 3,
        { life: 1.6, size0: 2, size1: 6, alpha: 0.4, color: [0.6, 0.6, 0.62] });
    }
  }

  explode(x, y, z, power = 1) {
    const fx = this.effects;
    for (let i = 0; i < 26 * power; i++) {
      const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 6) * power;
      fx.emit(x, y, z, Math.cos(a) * sp, 2 + Math.random() * 6 * power, Math.sin(a) * sp,
        { life: 0.5 + Math.random() * 0.4, size0: 3 * power, size1: 1, alpha: 1, color: [1, 0.5 + Math.random() * 0.3, 0.15] });
    }
    for (let i = 0; i < 12 * power; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 3 * power;
      fx.emit(x, y + 1, z, Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp,
        { life: 2.5 + Math.random() * 1.5, size0: 3 * power, size1: 10 * power, alpha: 0.5, color: [0.22, 0.22, 0.24] });
    }
    for (let i = 0; i < 10 * power; i++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8;
      fx.emit(x, y + 1, z, Math.cos(a) * sp, 6 + Math.random() * 10, Math.sin(a) * sp,
        { life: 1.2, size0: 0.8, size1: 0.3, alpha: 1, color: [1, 0.8, 0.4], flags: Effects.GRAVITY });
    }
  }

  // Which ship (or harbor) of `team`'s enemies sits at this point?
  hitAt(x, z, foe, extra = 0) {
    let best = null, bestD = Infinity;
    for (const e of this.units) {
      if (!e.alive || e.team !== foe) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < e.stats.size * 0.42 + 2 + extra && d < bestD) { best = e; bestD = d; }
    }
    const h = this.harbors[foe];
    if (!best && h.alive && Math.hypot(h.x - x, h.z - z) < h.radius + extra) best = h;
    return best;
  }

  updateProjectiles(dt) {
    const fx = this.effects;
    this.projectiles = this.projectiles.filter((p) => {
      if (p.kind === 'shell') {
        p.t += dt;
        if (p.t < 0) { p.mesh.visible = false; return true; }
        p.mesh.visible = true;
        const k = Math.min(1, p.t / p.dur);
        const x = p.from.x + (p.to.x - p.from.x) * k;
        const z = p.from.z + (p.to.z - p.from.z) * k;
        const y = p.from.y * (1 - k) + 4 * p.arc * k * (1 - k);
        p.mesh.position.set(x, y, z);
        p.trailAcc += dt * 24;
        while (p.trailAcc >= 1) {
          p.trailAcc--;
          fx.emit(x, y, z, 0, 0.3, 0, { life: 0.5, size0: 0.9, size1: 0.2, alpha: 0.6, color: [1, 0.8, 0.5] });
        }
        if (k < 1) return true;
        this.root.remove(p.mesh);
        this.impact(p, x, z);
        return false;
      }

      // Torpedo: runs just under the surface and hits the first enemy hull in its path.
      const step = p.speed * dt;
      p.x += p.dx * step;
      p.z += p.dz * step;
      p.traveled += step;
      const h = sampleOcean(p.x, p.z, this.t);
      p.mesh.position.set(p.x, h - 0.4, p.z);
      p.bubbleAcc += dt * 30;
      while (p.bubbleAcc >= 1) {
        p.bubbleAcc--;
        fx.emit(p.x - p.dx * 2, 0, p.z - p.dz * 2, (Math.random() - 0.5), 0, (Math.random() - 0.5),
          { life: 2.5, size0: 0.8, size1: 2.5, alpha: 0.6, flags: Effects.FLOAT });
      }
      const victim = this.hitAt(p.x, p.z, other(p.team));
      const aground = ISLANDS.some((is) => Math.hypot(p.x - is.x, p.z - is.z) < is.r)
        && !(victim && victim.kind === 'harbor');
      if (victim) {
        this.root.remove(p.mesh);
        this.damage(victim, p.damage, p.team);
        this.explode(p.x, h + 0.5, p.z, 1.3);
        fx.splash(p.x, p.z, this.t, 1.4);
        sfx.explosion(this.volumeAt(p.x, p.z));
        return false;
      }
      if (aground || p.traveled > p.maxDist) {
        this.root.remove(p.mesh);
        if (aground) this.explode(p.x, h + 0.5, p.z, 0.6);
        return false;
      }
      return true;
    });
  }

  impact(p, x, z) {
    const foe = other(p.team);
    const vol = this.volumeAt(x, z);
    const victim = this.hitAt(x, z, foe);
    const h = sampleOcean(x, z, this.t);
    if (victim) {
      // Destroyers carry depth charges, so they hit submarines much harder.
      const vsSub = victim.kind === 'ship' && victim.stats.stealth;
      this.damage(victim, p.damage * (vsSub ? p.subBonus || 1 : 1), p.team);
      this.explode(x, h + 1.5, z, p.splash ? 1.2 : 0.7);
      sfx.explosion(vol, !!p.splash);
    } else {
      this.effects.splash(x, z, this.t, p.splash ? 1.3 : 0.8);
      sfx.splash(vol);
    }
    if (p.splash) {
      for (const e of this.units) {
        if (e.alive && e.team === foe && e !== victim && Math.hypot(e.x - x, e.z - z) < p.splash + e.stats.size * 0.3) {
          this.damage(e, p.damage * 0.5, p.team);
        }
      }
    }
  }

  damage(e, amount, byTeam) {
    if (!e.alive) return;
    e.hp -= amount;
    e.lastHit = this.time;
    if (e.team === 'player' && !this.demo) {
      if (e.kind === 'harbor' && this.time - this.alerts.harbor > 12) {
        this.alerts.harbor = this.time;
        this.hooks.toast('Your harbor is under attack!', TEAM_COLORS.enemy.css);
      } else if (e.kind === 'ship' && this.time - this.alerts.unit > 20) {
        this.alerts.unit = this.time;
        this.hooks.toast('Your fleet is under fire!', TEAM_COLORS.enemy.css);
      }
    }
    if (e.hp > 0) return;
    e.hp = 0;
    if (e.kind === 'harbor') {
      this.destroyHarbor(e);
      return;
    }
    e.alive = false;
    e.selected = false;
    e.sinkT = 0;
    this.teams[e.team].lost++;
    this.teams[byTeam].kills++;
    this.explode(e.x, 2, e.z, 1.6);
    sfx.explosion(this.volumeAt(e.x, e.z), true);
  }

  updateSinking(u, dt) {
    u.sinkT += dt;
    const k = u.sinkT / 5;
    const m = u.mesh;
    m.visible = true;
    const h = sampleOcean(u.x, u.z, this.t);
    m.position.set(u.x, h - k * k * 14, u.z);
    m.rotateX(dt * 0.12);
    m.rotateZ(dt * 0.08);
    u.smokeAcc += dt * 14 * (1 - k);
    while (u.smokeAcc >= 1) {
      u.smokeAcc--;
      this.effects.emit(u.x + (Math.random() - 0.5) * u.stats.size * 0.5, h + 2, u.z + (Math.random() - 0.5) * 4,
        1.2, 2 + Math.random() * 2, 0.5, { life: 4, size0: 3, size1: 11, alpha: 0.45, color: [0.15, 0.15, 0.17] });
      if (Math.random() < 0.3) {
        this.effects.emit(u.x, h + 1, u.z, (Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2,
          { life: 0.6, size0: 3, size1: 1, alpha: 0.9, color: [1, 0.55, 0.2] });
      }
    }
    for (const o of [u.ring, u.marker, u.path, u.bar]) o.visible = false;
    if (u.sinkT >= 5) {
      for (const o of [u.mesh, u.ring, u.marker, u.path, u.bar]) this.root.remove(o);
    }
  }

  destroyHarbor(h) {
    h.alive = false;
    h.dyingT = 0;
    const winner = other(h.team);
    this.over = { winner, at: this.time };
    for (const u of this.units) {
      if (u.team === h.team) u.attackTarget = u.engage = null;
    }
  }

  updateHarbor(h, dt) {
    if (h.dyingT >= 0) {
      // Chain of explosions, then the game-over screen.
      const before = h.dyingT;
      h.dyingT += dt;
      if (Math.floor(before * 5) !== Math.floor(h.dyingT * 5) && h.dyingT < 3.5) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 28;
        this.explode(h.x + Math.cos(a) * r, 4, h.z + Math.sin(a) * r, 1.8);
        sfx.explosion(this.volumeAt(h.x, h.z) * 0.8 + 0.2, true);
      }
      if (before < 3.5 && h.dyingT >= 3.5) this.hooks.onGameOver(this.over.winner);
      return;
    }
    // The fortress gun covers the harbor approaches.
    h.cooldown -= dt;
    const foe = other(h.team);
    let best = null, bestD = HARBOR.range + h.radius;
    for (const e of this.units) {
      if (!e.alive || e.team !== foe || !this.visibleTo(e, h.team)) continue;
      const d = Math.hypot(e.x - h.x, e.z - h.z);
      if (d < bestD) { best = e; bestD = d; }
    }
    if (best) {
      const g = h.gun;
      const want = -Math.atan2(best.z - h.z, best.x - h.x);
      g.node.rotation.y += THREE.MathUtils.clamp(wrapAngle(want - g.node.rotation.y), -dt * 1.5, dt * 1.5);
      if (h.cooldown <= 0) {
        h.cooldown = HARBOR.reload;
        h.group.updateMatrixWorld();
        const from = g.muzzle.clone().applyMatrix4(g.node.matrixWorld);
        const dist = Math.hypot(best.x - from.x, best.z - from.z);
        const dur = 0.4 + dist / 110;
        const lead = this.leadPoint(h, best, dist / dur);
        const mesh = new THREE.Mesh(shellGeo, shellMat);
        this.root.add(mesh);
        const r = Math.random() * 6;
        const a = Math.random() * Math.PI * 2;
        this.projectiles.push({
          kind: 'shell', team: h.team, from, to: { x: lead.x + Math.cos(a) * r, z: lead.z + Math.sin(a) * r },
          t: 0, dur, arc: 6 + dist * 0.18, damage: HARBOR.damage, splash: 0, target: best, mesh, trailAcc: 0,
        });
        this.muzzleFlash(from, g);
        sfx.gun(this.volumeAt(h.x, h.z), true);
      }
    }
  }

  updateOutposts(dt) {
    for (const o of this.outposts) {
      let p = 0, e = 0;
      for (const u of this.units) {
        if (!u.alive || Math.hypot(u.x - o.x, u.z - o.z) > CAPTURE.radius) continue;
        if (u.team === 'player') p++; else e++;
      }
      const before = o.owner;
      const boost = (n) => CAPTURE.rate * (1 + 0.35 * Math.min(n - 1, 2)) * dt;
      if (p && !e) o.progress = Math.min(1, o.progress + boost(p));
      else if (e && !p) o.progress = Math.max(-1, o.progress - boost(e));
      else if (!p && !e) {
        // Uncontested forts drift back to whoever holds them.
        const rest = o.owner === 'player' ? 1 : o.owner === 'enemy' ? -1 : 0;
        o.progress += THREE.MathUtils.clamp(rest - o.progress, -dt * 0.05, dt * 0.05);
      }
      if (o.progress >= 1) o.owner = 'player';
      else if (o.progress <= -1) o.owner = 'enemy';
      else if ((o.owner === 'player' && o.progress <= 0) || (o.owner === 'enemy' && o.progress >= 0)) o.owner = null;

      if (o.owner !== before && !this.demo) {
        if (o.owner === 'player') { this.hooks.toast('Outpost captured', TEAM_COLORS.player.css); sfx.captured(); }
        else if (o.owner === 'enemy') { this.hooks.toast('The enemy captured an outpost', TEAM_COLORS.enemy.css); sfx.lost(); }
        else if (before === 'player') { this.hooks.toast('Outpost lost', TEAM_COLORS.enemy.css); sfx.lost(); }
      }

      const side = o.progress > 0 ? 'player' : 'enemy';
      o.ring.material.uniforms.uColor.value.set(o.progress === 0 ? 0xffffff : TEAM_COLORS[side].accent);
      o.ring.material.uniforms.uProgress.value = Math.abs(o.progress);
      o.flag.material.color.set(o.owner ? TEAM_COLORS[o.owner].accent : 0xdddddd);
      o.flag.rotation.y = Math.sin(this.t * 2 + o.x) * 0.3;
    }
  }

  // ---------- Visuals ----------

  updateVisuals(dt, camera) {
    const { tmpN, fwd, side, f2, basis } = TMP;
    const t = this.t;

    for (const u of this.units) {
      if (!u.alive) continue;
      const s = u.stats;
      const visible = this.demo || this.visibleTo(u, 'player');
      u.mesh.visible = visible;
      fwd.set(Math.cos(u.heading), 0, Math.sin(u.heading));
      // Float like a real hull: sample the water at bow, middle and stern, ride on the average and
      // pitch with the slope between bow and stern, so crests don't wash over the deck.
      const h = sampleOcean(u.x, u.z, t, tmpN);
      const reach = s.size * 0.4;
      const hBow = sampleOcean(u.x + fwd.x * reach, u.z + fwd.z * reach, t);
      const hStern = sampleOcean(u.x - fwd.x * reach, u.z - fwd.z * reach, t);
      const settle = 1 - Math.exp(-dt * 4);
      const ride = (hBow + 2 * h + hStern) / 4;
      u.ride = u.ride === undefined ? ride : u.ride + (ride - u.ride) * settle;
      const pitch = Math.atan2(hBow - hStern, 2 * reach) * 0.8;
      u.pitch = u.pitch === undefined ? pitch : u.pitch + (pitch - u.pitch) * settle;
      // Roll follows the wave surface sideways; bigger hulls roll less.
      const n = u.mesh.userData.normal;
      n.lerp(tmpN.lerp(UP, Math.min(0.85, 0.35 + s.size / 80)), 1 - Math.exp(-dt * 2.5)).normalize();
      f2.set(fwd.x * Math.cos(u.pitch), Math.sin(u.pitch), fwd.z * Math.cos(u.pitch));
      side.crossVectors(f2, n).normalize();
      TMP.up.crossVectors(side, f2);
      basis.makeBasis(f2, TMP.up, side);
      u.mesh.quaternion.setFromRotationMatrix(basis);
      u.mesh.position.set(u.x, u.ride + (s.stealth ? -0.6 : 0.1), u.z);
      u.mesh.updateMatrixWorld();

      const ud = u.mesh.userData;
      if (ud.radar) ud.radar.rotation.y += dt * 2.2;
      if (ud.flag) ud.flag.rotation.y = Math.sin(t * 3 + u.id) * 0.35;
      this.aimGuns(u, dt);

      // Overlays.
      const enemyHover = u.team !== 'player' && u.hovered;
      u.ring.visible = visible && (u.selected || u.hovered);
      u.ring.material.color.set(enemyHover ? 0xff5a4f : u.selected ? 0x4cd68a : 0xcfe8ff);
      u.ring.material.opacity = u.selected ? 0.85 : 0.5;
      u.ring.position.set(u.x, h + 0.4, u.z);
      const target = u.mode === 'attack' ? u.attackTarget : u.target;
      const showOrder = u.selected && target && (u.mode === 'move' || u.mode === 'attackmove' || u.mode === 'attack');
      u.marker.visible = u.path.visible = !!showOrder;
      if (showOrder) {
        const color = u.mode === 'attack' ? 0xff5a4f : 0x4cd68a;
        u.marker.material.color.set(color);
        u.path.material.color.set(color);
        const th = sampleOcean(target.x, target.z, t) + 0.4;
        u.marker.position.set(target.x, th, target.z);
        u.marker.scale.setScalar((u.mode === 'attack' ? 3 : 1) * (1 + 0.25 * Math.sin(t * 5)));
        u.path.geometry.attributes.position.array.set([u.x, h + 0.4, u.z, target.x, th, target.z]);
        u.path.geometry.attributes.position.needsUpdate = true;
      }
      u.bar.visible = visible && (u.selected || u.hovered || u.hp < u.maxHp);
      if (u.bar.visible) {
        u.bar.position.set(u.x, h + s.size * 0.3 + 7, u.z);
        u.bar.quaternion.copy(camera.quaternion);
        setHealthBar(u.bar, u.hp / u.maxHp);
      }

      // Wakes and smoke far from the camera can't be seen, so don't pay for them.
      const near = Math.hypot(u.x - this.listener.x, u.z - this.listener.z) < EFFECTS_RANGE;
      if (dt > 0 && visible && near) this.emitShipEffects(u, h, fwd, side, dt);
    }

    for (const h of Object.values(this.harbors)) {
      h.bar.visible = h.alive && (h.hp < h.maxHp || h.hovered);
      if (h.bar.visible) {
        h.bar.position.set(h.x, 32, h.z);
        h.bar.quaternion.copy(camera.quaternion);
        setHealthBar(h.bar, h.hp / h.maxHp);
      }
      // Burning when badly damaged.
      if (dt > 0 && h.hp < h.maxHp * 0.5 && Math.random() < dt * 6 * (1 - h.hp / h.maxHp)) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 25;
        this.effects.emit(h.x + Math.cos(a) * r, 5, h.z + Math.sin(a) * r, 1, 3, 0.5,
          { life: 4, size0: 4, size1: 12, alpha: 0.45, color: [0.15, 0.15, 0.16] });
      }
    }
  }

  aimGuns(u, dt) {
    const guns = u.mesh.userData.guns;
    if (!guns.length) return;
    const tgt = u.aimAt && this.validTarget(u, u.aimAt) ? u.aimAt : null;
    for (const g of guns) {
      let want = g.rest;
      if (tgt) want = -wrapAngle(Math.atan2(tgt.z - u.z, tgt.x - u.x) - u.heading);
      g.node.rotation.y += THREE.MathUtils.clamp(wrapAngle(want - g.node.rotation.y), -dt * 2, dt * 2);
    }
  }

  emitShipEffects(u, h, fwd, side, dt) {
    const fx = this.effects;
    const s = u.stats;
    const churn = Math.min(1, u.speed / 4);
    const half = s.size / 2;
    const beam = s.size / 8;
    u.wakeAcc += dt * (s.stealth ? 12 : 8 + s.size * 0.6) * churn;
    while (u.wakeAcc >= 1) {
      u.wakeAcc--;
      const off = (Math.random() - 0.5) * beam;
      const spread = (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.2);
      fx.emit(u.x - fwd.x * half * 0.95 + side.x * off, 0, u.z - fwd.z * half * 0.95 + side.z * off,
        side.x * spread - fwd.x * 0.6, 0, side.z * spread - fwd.z * 0.6,
        { life: 6, size0: beam, size1: beam * 3.6, alpha: s.stealth ? 0.35 : 0.55, flags: Effects.FLOAT });
    }
    if (s.stealth) return;
    u.sprayAcc += dt * 16 * churn;
    while (u.sprayAcc >= 1) {
      u.sprayAcc--;
      const sgn = Math.random() < 0.5 ? -1 : 1;
      const bx = u.x + fwd.x * half * 0.8 + side.x * sgn * beam * 0.6;
      const bz = u.z + fwd.z * half * 0.8 + side.z * sgn * beam * 0.6;
      fx.emit(bx, 0, bz, side.x * sgn * (1.5 + u.speed * 0.3), 0, side.z * sgn * (1.5 + u.speed * 0.3),
        { life: 3.5, size0: 1.5, size1: 5, alpha: 0.55, flags: Effects.FLOAT });
      if (Math.random() < 0.35) {
        fx.emit(bx, h + 0.5, bz, side.x * sgn * 2 + fwd.x * u.speed, 2 + Math.random() * 2.5, side.z * sgn * 2 + fwd.z * u.speed,
          { life: 0.8, size0: 0.8, size1: 0.4, alpha: 0.8, flags: Effects.GRAVITY });
      }
    }
    const funnel = u.mesh.userData.funnel;
    if (!funnel) return;
    // Damaged ships smoke black.
    const hurt = 1 - u.hp / u.maxHp;
    u.smokeAcc += dt * (4 + hurt * 10);
    while (u.smokeAcc >= 1) {
      u.smokeAcc--;
      const p = TMP.funnel.copy(funnel).applyMatrix4(u.mesh.matrixWorld);
      const c = 0.5 - hurt * 0.35;
      fx.emit(p.x, p.y, p.z, 1.6 + Math.random() * 0.6, 1.8 + Math.random(), 0.6 + Math.random() * 0.4,
        { life: 4, size0: 1.5 + s.size * 0.03, size1: 6 + s.size * 0.15, alpha: 0.35 + hurt * 0.2, color: [c, c + 0.02, c + 0.05] });
    }
  }
}
