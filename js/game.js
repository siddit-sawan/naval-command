import * as THREE from 'three';
import { rankedDifficulty, UNITS, HARBOR, ECONOMY, CAPTURE, MAP, REVEAL_TIME, DIFFICULTY, TEAM_COLORS, HELM_ARMOR, DEATHMATCH, LOADOUTS, AIRCRAFT } from './config.js';
import { makeShipModel, makeHarbor, makeOutpost, makeAircraftModel } from './models.js';
import { ISLANDS, sampleOcean } from './ocean.js';
import { Effects } from './effects.js';
import { sfx } from './audio.js';
import { EnemyAI, FleetAI } from './ai.js';

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
const missileGeo = new THREE.CylinderGeometry(0.22, 0.3, 2.8, 6).rotateZ(Math.PI / 2);
const missileMat = new THREE.MeshBasicMaterial({ color: 0xe8ecef });
const chargeGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.8, 8);

// Scratch objects reused every frame to avoid garbage-collection hitches.
const TMP = {
  tmpN: new THREE.Vector3(), fwd: new THREE.Vector3(), side: new THREE.Vector3(),
  f2: new THREE.Vector3(), up: new THREE.Vector3(), basis: new THREE.Matrix4(), funnel: new THREE.Vector3(),
};
const EFFECTS_RANGE = 380;
const HULL_LETTER = { corvette: 'K', destroyer: 'D', submarine: 'S', battleship: 'B' };
// Direct-fire shells in fleet battles (deathmatch weapons set their own), and the harbor fortress gun.
const SHELL_VELOCITY = 240;
const HARBOR_GUN = { damage: HARBOR.damage, velocity: 240, spread: 4, range: HARBOR.range + HARBOR.radius };

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
  return [new THREE.Mesh(shellGeo, shellMat), new THREE.Mesh(torpGeo, torpMat), new THREE.Mesh(missileGeo, missileMat)];
}

export class Game {
  /**
   * hooks: { toast(text, color), onGameOver(winner) }. In demo mode both fleets are AI-controlled and silent.
   * Manual mode is a team deathmatch: the player steers one ship (the helm, starting as `flagship`)
   * and aims its weapons by hand; each side has five ships and the last fleet afloat wins.
   * weather (optional) hides ships in fog; see fog.js. livery: the player fleet's paint scheme (livery.js).
   */
  constructor(scene, effects, { difficulty = 'normal', demo = false, manual = false, flagship = 'destroyer', weather = null, livery = 'dazzle', upgrades = null, rankLevel = 0, hooks = {} } = {}) {
    this.scene = scene;
    this.effects = effects;
    this.demo = demo;
    this.manual = manual && !demo;
    this.deathmatch = this.manual;
    this.overNotified = false;
    this.aircraft = [];
    this.weaponLevel = 0; // deathmatch: how many of the player's weapon slots are online, for the alerts
    this.aiHold = false; // set while a tutorial runs: the AI fleets hold position and the enemy doesn't build
    this.helm = null;
    this.helmInput = { throttle: 0, rudder: 0 };
    this.fpShip = null; // set by the camera: the ship it rides with hides its own overlays
    this.weather = weather;
    this.livery = livery;
    // Shop upgrades boost the player in real matches only (the menu backdrop fights stay even).
    this.up = demo || !upgrades ? { income: 1, gold: 0, ships: [], build: 1, hp: 1, cap: 0, exclusive: [] } : upgrades;
    this.difficulty = difficulty;
    if (weather) weather.reset();
    this.escortT = 0;
    this.rankLevel = rankLevel;
    this.diff = difficulty === 'ranked' ? rankedDifficulty(rankLevel) : DIFFICULTY[difficulty];
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
    this.alerts = { unit: -99, harbor: -99, fog: -99 };

    this.teams = {};
    this.harbors = {};
    for (const team of ['player', 'enemy']) {
      const gold = team === 'player' && !demo ? this.diff.playerGold + this.up.gold : ECONOMY.startGold;
      this.teams[team] = { gold, queue: [], buildT: 0, built: 0, lost: 0, kills: 0 };
      const def = MAP.harbors[team];
      const { group, gun } = makeHarbor(def.x, def.z, team, team === 'player' ? 101 : 202);
      this.root.add(group);
      const bar = makeHealthBar(30);
      this.root.add(bar);
      const hp = team === 'enemy' && !demo ? this.diff.enemyHarborHp : HARBOR.hp;
      this.harbors[team] = {
        kind: 'harbor', team, x: def.x, z: def.z, spawn: def.spawn, radius: HARBOR.radius,
        hp, maxHp: hp, alive: true, gun, cooldown: 2, group, bar, dyingT: -1,
        hovered: false, lastHit: -99,
      };
    }

    this.outposts = MAP.outposts.map(({ x, z }) => {
      const o = makeOutpost(x, z);
      this.root.add(o.group);
      return { x, z, owner: null, progress: 0, ...o };
    });

    if (this.deathmatch) {
      this.setupDeathmatch(flagship);
      return;
    }
    this.ai = demo
      ? [new EnemyAI(this, 'enemy', DIFFICULTY.normal), new EnemyAI(this, 'player', DIFFICULTY.normal)]
      : [new EnemyAI(this, 'enemy', this.diff)];

    // A couple of starting ships each so the sea isn't empty.
    for (const team of ['player', 'enemy']) {
      for (const type of ['destroyer', 'corvette']) this.spawn(team, type, true);
    }
    for (const type of this.up.ships) this.spawn('player', type, true);
  }

  // Two identical fleets in line abreast, facing each other across the middle of the map.
  setupDeathmatch(flagship) {
    this.ai = [new FleetAI(this, 'enemy', this.diff), new FleetAI(this, 'player', this.diff)];
    const lineup = [flagship, ...DEATHMATCH.escorts];
    for (const team of ['player', 'enemy']) {
      const side = team === 'player' ? 1 : -1;
      lineup.forEach((type, i) => {
        // Flagship in the middle, escorts alternating out to either side.
        const slot = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
        this.spawn(team, type, true, {
          x: slot * DEATHMATCH.spacing * side, z: DEATHMATCH.startZ * side + Math.abs(slot) * 12 * side,
          heading: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        });
      });
    }
    this.setHelm(this.alive('player')[0]);
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
    const mult = this.demo ? 1 : team === 'enemy' ? this.diff.income : this.diff.playerIncome * this.up.income;
    return (ECONOMY.baseIncome + owned * ECONOMY.outpostIncome) * mult;
  }

  // Fleet size limit for a team.
  maxShips(team) {
    return ECONOMY.maxShips + (team === 'player' ? this.up.cap : 0);
  }

  // Seconds to build one ship of this type.
  buildTime(team, type) {
    const mult = this.demo ? 1 : team === 'enemy' ? this.diff.build : this.diff.playerBuild * this.up.build;
    return UNITS[type].build * mult;
  }

  // Submarines and ships in fog are hidden unless an enemy is close enough to see them, or they recently fired.
  visibleTo(e, team) {
    if (e.team === team || e.kind !== 'ship') return true;
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
    if (!this.deathmatch && h.alive && this.distTo(u, h) < bestD) best = h;
    return best;
  }

  outpostsHeld(team) {
    return this.outposts.filter((o) => o.owner === team).length;
  }

  // In a deathmatch, weapons come online by holding outposts (DEATHMATCH.unlock per slot).
  weaponsOnline(team, slot = 0) {
    if (!this.deathmatch) return true;
    return this.outpostsHeld(team) >= (DEATHMATCH.unlock[slot] ?? 2);
  }

  // The weapon a ship's AI fires: its main loadout weapon, or one made from its class stats.
  weaponFor(u) {
    if (u.weapons) return u.weapons[0];
    const s = u.stats;
    return s.weapon === 'torpedo'
      ? { kind: 'torpedo', range: s.range * 1.6, damage: s.damage, speed: 24, count: 1 }
      : { kind: 'shell', range: s.range, damage: s.damage, velocity: SHELL_VELOCITY, spread: 3, splash: s.splash, subBonus: s.subBonus };
  }

  volumeAt(x, z) {
    if (this.demo) return 0;
    return THREE.MathUtils.clamp(1 - Math.hypot(x - this.listener.x, z - this.listener.z) / 450, 0, 1);
  }

  // ---------- Commands ----------

  queueBuild(team, type) {
    const t = this.teams[team];
    const stats = UNITS[type];
    if (stats.exclusive && (team !== 'player' || !this.up.exclusive.includes(type))) return 'Ship not unlocked';
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

  // ---------- Manual mode ----------

  setHelm(u) {
    for (const s of this.alive('player')) {
      s.selected = false;
      s.aimPoint = null;
    }
    this.helm = u && u.alive ? u : null;
    if (!this.helm) return;
    Object.assign(this.helm, { selected: true, mode: 'idle', target: null, attackTarget: null, engage: null });
  }

  // Take the next ship in the fleet; returns it, or null if there is none.
  cycleHelm() {
    const fleet = this.alive('player');
    if (!fleet.length) return null;
    const i = fleet.indexOf(this.helm);
    this.setHelm(fleet[(i + 1) % fleet.length]);
    return this.helm;
  }

  /**
   * Fire the helm ship's selected weapon. aim: a point on the water ({x, z}), an enemy (fired at
   * where it is now, never led), or null for the nearest enemy in range. locked: the target a
   * missile has locked on to. Returns an error message, or null when the shot went out.
   */
  helmFire(aim, locked = null) {
    const u = this.helm;
    if (!u || !u.alive) return 'No ship at the helm';
    const w = u.weapons[u.weaponIdx];
    if (!this.weaponsOnline('player', u.weaponIdx)) {
      const need = DEATHMATCH.unlock[u.weaponIdx];
      return `Weapon offline: hold ${need} outpost${need > 1 ? 's' : ''} to arm it`;
    }
    if (w.kind === 'aircraft') {
      // First click launches the bomber; after that, clicks send it at the target or point aimed at.
      const order = locked && locked.alive ? { target: locked } : aim ? { point: { x: aim.x, z: aim.z } } : null;
      if (u.plane) { this.directAircraft(u, order); return null; }
      return this.launchAircraft(u, order);
    }
    if (u.wcool[u.weaponIdx] > 0) return 'Reloading';
    if (w.kind === 'missile') {
      if (!locked || !locked.alive) return 'Hold the crosshair on an enemy ship to lock on';
      if (this.distTo(u, locked) > w.range) return 'Target out of missile range';
      this.fire(u, locked, w, true);
    } else if (w.kind === 'depth') {
      this.fire(u, u, w, true);
    } else {
      if (!aim) {
        const t = this.findTarget(u, w.range);
        if (!t) return 'No target in range';
        aim = t;
      }
      if (w.kind === 'shell') {
        // Exactly where aimed, never led: along the crosshair line for a 3D aim point (gravity then
        // pulls the shell down), or at the elevation that reaches a point on the water.
        this.fire(u, aim.y !== undefined ? { x: aim.x, y: aim.y, z: aim.z } : { x: aim.x, z: aim.z }, w, true);
      } else {
        // Torpedoes run out at their range.
        const dx = aim.x - u.x, dz = aim.z - u.z;
        const k = Math.min(1, w.range / (Math.hypot(dx, dz) || 1));
        this.fire(u, { x: u.x + dx * k, z: u.z + dz * k }, w, true);
      }
    }
    u.wcool[u.weaponIdx] = w.reload;
    return null;
  }

  selectWeapon(i) {
    const u = this.helm;
    if (!u || !u.weapons || i < 0 || i >= u.weapons.length) return null;
    u.weaponIdx = i;
    return u.weapons[i];
  }

  // ---------- Aircraft ----------

  // Launch a battleship's scout bomber. order: { target: ship } to bomb, { point } to patrol, or null
  // to hunt on its own. Returns an error message, or null when it took off.
  launchAircraft(ship, order = null) {
    if (ship.type !== 'battleship' || !ship.alive) return 'Only battleships carry aircraft';
    if (ship.plane) return 'Aircraft already airborne';
    if (ship.planeCd > 0) return `Aircraft ready in ${Math.ceil(ship.planeCd)}s`;
    const mesh = makeAircraftModel(ship.team === 'player' ? this.livery : 'enemy');
    this.root.add(mesh);
    const fx = Math.cos(ship.heading), fz = Math.sin(ship.heading);
    const p = {
      team: ship.team, owner: ship, mesh, order, hp: AIRCRAFT.hp, bombs: AIRCRAFT.bombs, life: AIRCRAFT.life,
      x: ship.x - fx * ship.stats.size * 0.4, z: ship.z - fz * ship.stats.size * 0.4, y: 6,
      heading: ship.heading, roll: 0, gunCd: 0, dropCd: 0, alive: true,
    };
    this.aircraft.push(p);
    ship.plane = p;
    ship.planeCd = this.airCooldown(ship);
    sfx.torpedo(this.volumeAt(ship.x, ship.z));
    if (ship.team === 'player' && !this.demo) this.hooks.toast('Scout bomber launched', TEAM_COLORS.player.css);
    return null;
  }

  // The player's fleet battleships launch their bomber by themselves, 20-30 seconds after the last one is back.
  autoLaunches(u) {
    return u.team === 'player' && !this.demo && !this.deathmatch;
  }

  airCooldown(ship) {
    return this.autoLaunches(ship) ? 20 + Math.random() * 10 : AIRCRAFT.cooldown;
  }

  directAircraft(ship, order) {
    if (ship.plane && order) ship.plane.order = order;
  }

  // One line for the HUD: what a battleship's aircraft is doing.
  planeStatus(ship) {
    if (ship.type !== 'battleship') return null;
    if (ship.plane) return ship.plane.bombs ? 'Aircraft airborne' : 'Aircraft returning';
    if (ship.planeCd > 0) return `Aircraft ready in ${Math.ceil(ship.planeCd)}s`;
    return this.autoLaunches(ship) ? 'Aircraft launching' : 'Aircraft ready (L)';
  }

  // Launch cooldowns, and AI battleships launching when there's something to hunt. The player's own
  // battleships launch on command (fleet) or from the weapon slot (helm); AI-run ones launch themselves.
  updateAirOps(dt) {
    for (const u of this.units) {
      if (!u.alive || u.type !== 'battleship') continue;
      if (!u.plane) u.planeCd = Math.max(0, u.planeCd - dt);
      const auto = u !== this.helm && (u.team === 'enemy' || this.demo || this.deathmatch);
      if (this.autoLaunches(u) && !u.plane && u.planeCd <= 0 && !this.over && !this.aiHold) { this.launchAircraft(u, null); continue; }
      if (!auto || u.plane || u.planeCd > 0 || this.over || this.aiHold || !this.weaponsOnline(u.team, 2)) continue;
      const foe = other(u.team);
      const prey = this.units.some((e) => e.alive && e.team === foe && this.visibleTo(e, u.team)
        && Math.hypot(e.x - u.x, e.z - u.z) < AIRCRAFT.launchRange)
        || this.aircraft.some((a) => a.team === foe && Math.hypot(a.x - u.x, a.z - u.z) < AIRCRAFT.dogfightRange * 1.5);
      if (prey) this.launchAircraft(u, null);
    }
  }

  updateAircraft(dt) {
    if (dt <= 0) return;
    const A = AIRCRAFT;
    for (const p of this.aircraft) {
      const foe = other(p.team);
      p.life -= dt;
      p.gunCd -= dt;
      p.dropCd -= dt;
      let goal = null, alt = A.altitude, speed = A.speed;

      // Dogfight any enemy plane close by.
      let bandit = null, bd = A.dogfightRange;
      for (const q of this.aircraft) {
        if (q.team !== foe || !q.alive) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bd) { bandit = q; bd = d; }
      }
      if (bandit && p.life > 0) {
        goal = bandit;
        alt = bandit.y;
        const off = Math.abs(wrapAngle(Math.atan2(bandit.z - p.z, bandit.x - p.x) - p.heading));
        if (bd < A.gunRange && off < 0.35 && p.gunCd <= 0) {
          p.gunCd = A.gunReload;
          bandit.hp -= A.gunDamage;
          for (let k = 0; k < 4; k++) {
            const t = k / 4;
            this.effects.emit(p.x + (bandit.x - p.x) * t, p.y + (bandit.y - p.y) * t, p.z + (bandit.z - p.z) * t, 0, 0, 0,
              { life: 0.15, size0: 0.7, size1: 0.2, alpha: 0.9, color: [1, 0.85, 0.4] });
          }
          sfx.gun(this.volumeAt(p.x, p.z) * 0.35);
        }
      } else if (p.bombs > 0 && p.life > 0) {
        // Bomb run on the ordered target, or the nearest enemy ship it can see.
        let target = p.order && p.order.target && p.order.target.alive ? p.order.target : null;
        if (!target && !(p.order && p.order.point)) {
          let best = Infinity;
          for (const e of this.units) {
            if (!e.alive || e.team !== foe || !this.visibleTo(e, p.team)) continue;
            const d = Math.hypot(e.x - p.x, e.z - p.z);
            if (d < best) { best = d; target = e; }
          }
        }
        if (target) {
          alt = A.runAltitude;
          // Where a bomb dropped now would land, against where the target will be by then.
          const tf = Math.sqrt((2 * Math.max(1, p.y - 2)) / DEATHMATCH.gravity);
          const tx = target.x + Math.cos(target.heading) * target.speed * tf;
          const tz = target.z + Math.sin(target.heading) * target.speed * tf;
          goal = { x: tx, z: tz };
          const ix = p.x + Math.cos(p.heading) * speed * tf, iz = p.z + Math.sin(p.heading) * speed * tf;
          if (p.dropCd <= 0 && Math.abs(p.y - A.runAltitude) < 4 && Math.hypot(ix - tx, iz - tz) < target.stats.size * 0.3 + 3) {
            this.dropBomb(p, speed);
          }
        } else if (p.order && p.order.point) {
          goal = p.order.point; // patrol: circles once it gets there
        } else {
          goal = p.owner.alive ? p.owner : null;
        }
      } else {
        // Out of bombs or fuel: home to the battleship and land.
        goal = p.owner.alive ? p.owner : null;
        alt = 14;
        if (p.owner.alive && Math.hypot(p.owner.x - p.x, p.owner.z - p.z) < 14) {
          this.removeAircraft(p, false);
          continue;
        }
        if (!p.owner.alive || p.life < -40) {
          p.hp = 0; // out of fuel with nowhere to land
        }
      }

      // Fly: bank into turns, climb or dive toward the wanted altitude.
      let turn = 0;
      if (goal) {
        const want = Math.atan2(goal.z - p.z, goal.x - p.x);
        const diff = wrapAngle(want - p.heading);
        // Circle a point it has reached instead of overflying it forever.
        turn = Math.hypot(goal.x - p.x, goal.z - p.z) < 25 ? A.turn : THREE.MathUtils.clamp(diff, -A.turn * dt, A.turn * dt) / dt;
      }
      p.heading += turn * dt;
      p.roll += (THREE.MathUtils.clamp(-turn * 0.6, -0.9, 0.9) - p.roll) * Math.min(1, dt * 3);
      p.x += Math.cos(p.heading) * speed * dt;
      p.z += Math.sin(p.heading) * speed * dt;
      p.y += (alt - p.y) * Math.min(1, dt * 0.9);
      p.x = THREE.MathUtils.clamp(p.x, -MAP.bounds - 60, MAP.bounds + 60);
      p.z = THREE.MathUtils.clamp(p.z, -MAP.bounds - 60, MAP.bounds + 60);

      // Anti-aircraft fire from enemy ships below.
      for (const e of this.units) {
        if (e.alive && e.team === foe && Math.hypot(e.x - p.x, e.z - p.z) < A.aaRange) p.hp -= A.aaDps * dt;
      }
      if (p.hp <= 0) {
        this.explode(p.x, p.y, p.z, 0.9);
        sfx.explosion(this.volumeAt(p.x, p.z));
        if (p.team === 'enemy' && !this.demo) this.hooks.toast('Enemy aircraft shot down', TEAM_COLORS.player.css);
        this.removeAircraft(p, true);
        continue;
      }

      const m = p.mesh;
      m.position.set(p.x, p.y, p.z);
      m.rotation.set(0, -p.heading, 0);
      m.rotateX(p.roll);
      m.userData.prop.rotation.x += dt * 40;
      if (Math.random() < dt * 20) {
        this.effects.emit(p.x - Math.cos(p.heading) * 4, p.y, p.z - Math.sin(p.heading) * 4, 0, 0, 0,
          { life: 1.2, size0: 0.6, size1: 2, alpha: 0.25, color: [0.9, 0.9, 0.9] });
      }
    }
    this.aircraft = this.aircraft.filter((p) => p.alive);
  }

  dropBomb(p, speed) {
    p.bombs--;
    p.dropCd = 0.8;
    const mesh = new THREE.Mesh(chargeGeo, torpMat);
    mesh.visible = false;
    this.root.add(mesh);
    const vel = new THREE.Vector3(Math.cos(p.heading) * speed, -2, Math.sin(p.heading) * speed);
    this.projectiles.push({
      kind: 'direct', team: p.team, pos: new THREE.Vector3(p.x, p.y - 1, p.z), vel, delay: 0, traveled: 0, maxDist: 600,
      damage: AIRCRAFT.bombDamage, splash: AIRCRAFT.bombSplash, subBonus: 1, mesh,
    });
  }

  removeAircraft(p, destroyed) {
    p.alive = false;
    this.root.remove(p.mesh);
    if (p.owner.plane === p) p.owner.plane = null;
    // A plane lost in action takes longer to replace than one that lands.
    if (destroyed) p.owner.planeCd = Math.max(p.owner.planeCd, this.airCooldown(p.owner));
  }

  // ---------- Spawning ----------

  // at: optional { x, z, heading } start position (deathmatch line-up).
  spawn(team, type, initial = false, at = null) {
    let stats = UNITS[type];
    const weapons = this.deathmatch ? LOADOUTS[type] : null;
    if (weapons) {
      // AI ships fight with their main weapon, opening fire from a share of its full range.
      const w = weapons[0];
      stats = { ...stats, range: w.range * DEATHMATCH.aiRange, damage: w.damage, reload: w.reload };
    }
    const h = this.harbors[team];
    const toSea = -Math.sign(h.z);
    const id = this.nextId++;
    const name = team === 'player' ? SHIP_NAMES[this.nameIndex++ % SHIP_NAMES.length] : null;
    // Pennant number painted on the hull, e.g. D 14.
    const hull = stats.base || type; // exclusive ships ride a standard hull, enlarged
    const mesh = makeShipModel(hull, team === 'player' ? this.livery : 'enemy', `${HULL_LETTER[hull]} ${10 + ((id * 37) % 90)}`, stats.base ? type : '');
    if (stats.scale) mesh.scale.setScalar(stats.scale);
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

    const hp = Math.round(stats.hp * (team === 'player' ? this.up.hp : 1));
    const x = at ? at.x : h.spawn.x + (Math.random() - 0.5) * (initial ? 60 : 24);
    const z = at ? at.z : h.z + toSea * (initial ? 80 + Math.random() * 20 : 62);
    const u = {
      kind: 'ship', id, type: hull, stats, team, name, weapons, weaponIdx: 0, wcool: weapons ? weapons.map(() => 0) : null,
      x, z, heading: at ? at.heading : toSea > 0 ? Math.PI / 2 : -Math.PI / 2, speed: initial ? 0 : stats.speed * 0.4,
      hp, maxHp: hp, alive: true, mode: 'idle', target: null, attackTarget: null, engage: null,
      cooldown: Math.random() * stats.reload, scanT: Math.random() * 0.3, spotted: false, revealedUntil: 0,
      mesh, ring, marker, path, bar, selected: false, hovered: false, sinkT: 0, lastHit: -99,
      wakeAcc: 0, sprayAcc: 0, smokeAcc: 0,
      plane: null, planeCd: type === 'battleship' ? (team === 'player' && !this.demo && !this.deathmatch ? 20 + Math.random() * 10 : 15 + Math.random() * 20) : Infinity,
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
      if (!this.deathmatch) {
        for (const team of ['player', 'enemy']) if (!(this.aiHold && team === 'enemy')) this.updateEconomy(team, dt);
      }
      if (!this.aiHold) for (const ai of this.ai) ai.update(dt);
      if (this.manual && (!this.helm || !this.helm.alive)) {
        const next = this.cycleHelm();
        if (next) this.hooks.toast(`You now command HMS ${next.name}`, TEAM_COLORS.player.css);
      }
    }
    this.updateWeather(dt);
    this.updateSpotting();
    for (const u of this.units) this.updateUnit(u, dt);
    if (!this.demo) this.repair(dt);
    this.separate();
    this.units = this.units.filter((u) => u.alive || u.sinkT < 5);
    for (const h of Object.values(this.harbors)) this.updateHarbor(h, dt);
    this.updateOutposts(dt);
    if (this.deathmatch) this.updateDeathmatch();
    this.updateAirOps(dt);
    this.updateAircraft(dt);
    this.updateProjectiles(dt);
    this.updateVisuals(dt, camera);
  }

  // Last fleet afloat wins; the end screen follows once the final ship has gone down.
  updateDeathmatch() {
    // Weapons come online in stages (one per distinct outpost count in DEATHMATCH.unlock).
    const held = this.outpostsHeld('player');
    const level = [...new Set(DEATHMATCH.unlock)].filter((n) => held >= n).length;
    if (level !== this.weaponLevel && !this.over) {
      if (level > this.weaponLevel) {
        this.hooks.toast(level === 1 ? 'Weapons online! Main armament armed' : 'All weapons online', TEAM_COLORS.player.css);
        sfx.built();
      } else if (level === 0) {
        this.hooks.toast('Weapons offline! Retake an outpost', TEAM_COLORS.enemy.css);
        sfx.lost();
      }
      this.weaponLevel = level;
    }
    if (!this.over) {
      for (const team of ['player', 'enemy']) {
        if (!this.alive(team).length) this.over = { winner: other(team), at: this.time };
      }
    } else if (!this.overNotified && this.time - this.over.at > 3) {
      this.overNotified = true;
      this.hooks.onGameOver(this.over.winner);
    }
  }

  updateEconomy(team, dt) {
    const t = this.teams[team];
    t.gold += this.incomeOf(team) * dt;
    if (!t.queue.length) { t.buildT = 0; return; }
    if (this.alive(team).length >= this.maxShips(team)) return;
    t.buildT += dt;
    const type = t.queue[0];
    if (t.buildT >= this.buildTime(team, type)) {
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

  updateWeather(dt) {
    const event = this.weather && this.weather.step(dt);
    if (!event || this.demo || this.over) return;
    if (event === 'front') {
      this.hooks.toast('Fog is rolling in! Enemies could be anywhere…', '#cfe0ec');
      sfx.foghorn();
    } else {
      this.hooks.toast('The fog is lifting', '#cfe0ec');
    }
  }

  // A ship is seen when it is in the open (surface ships), or when an enemy is close enough: subs only
  // show up within detection range, and fog shrinks everyone's sight. Firing gives a ship away.
  updateSpotting() {
    const w = this.weather;
    for (const u of this.units) {
      if (!u.alive) continue;
      const was = u.spotted;
      const sight = w ? w.sightAt(u.x, u.z) : Infinity;
      if ((!u.stats.stealth && sight === Infinity) || this.time < u.revealedUntil) {
        u.spotted = true;
        continue;
      }
      const foe = other(u.team);
      const h = this.harbors[foe];
      const harborReach = Math.min(u.stats.stealth ? HARBOR.detect : Infinity, Math.max(sight, HARBOR.detect * 0.6));
      u.spotted = this.aircraft.some((a) => a.team === foe && Math.hypot(u.x - a.x, u.z - a.z) < AIRCRAFT.spotRange)
        || (h.alive && Math.hypot(u.x - h.x, u.z - h.z) < harborReach)
        || this.units.some((e) => e.alive && e.team === foe
          && Math.hypot(u.x - e.x, u.z - e.z) < Math.min(u.stats.stealth ? e.stats.detect : Infinity, sight));
      // Surprise: an enemy surface ship looming out of the fog right next to the fleet.
      if (u.spotted && !was && u.team === 'enemy' && !u.stats.stealth && !this.demo
        && this.time - this.alerts.fog > 15 && this.time > 2) {
        this.alerts.fog = this.time;
        this.hooks.toast('Enemy ship sighted in the fog!', TEAM_COLORS.enemy.css);
      }
    }
  }

  // Ships patch up their hulls when they have not been hit for a while.
  repair(dt) {
    const rate = this.diff.regen;
    if (!rate) return;
    for (const u of this.units) {
      if (u.alive && u.team === 'player' && (!this.deathmatch || u === this.helm) && u.hp < u.maxHp && this.time - u.lastHit > 6) {
        u.hp = Math.min(u.maxHp, u.hp + rate * dt);
      }
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
    if (u === this.helm) {
      this.updateHelm(u, dt);
      return;
    }
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
    if (fireAt && u.cooldown <= 0 && this.weaponsOnline(u.team, 0)) {
      this.fire(u, fireAt);
      u.cooldown = s.reload * (0.9 + Math.random() * 0.2);
    }
  }

  // The player's own ship: driven by the keys (or sailing to a right-clicked point when they're
  // released), and only fires when told to. The turrets still track the nearest enemy in range.
  updateHelm(u, dt) {
    const s = u.stats;
    const { throttle, rudder } = this.helmInput;
    for (let i = 0; i < u.wcool.length; i++) {
      u.wcool[i] = u.weapons[i].kind === 'aircraft' ? u.planeCd : Math.max(0, u.wcool[i] - dt);
    }
    u.cooldown = u.wcool[u.weaponIdx];
    u.scanT -= dt;
    if (u.scanT <= 0) {
      u.scanT = 0.3;
      u.aimAt = this.findTarget(u, s.range);
    }
    if (throttle || rudder) {
      u.mode = 'idle';
      u.target = null;
      const turn = s.turn * dt * (0.4 + Math.abs(u.speed) / s.speed);
      u.heading += rudder * turn * (u.speed < 0 ? -1 : 1);
      // Rudder alone holds the current speed; reverse is slow.
      const want = throttle ? throttle * s.speed : u.speed;
      u.speed += THREE.MathUtils.clamp(want - u.speed, -3 * dt, 1.5 * dt);
      this.steer(u, null, dt, true);
      return;
    }
    let dest = null;
    if (u.mode === 'move' && u.target) {
      if (Math.hypot(u.target.x - u.x, u.target.z - u.z) < 6 + s.size * 0.2) {
        u.mode = 'idle';
        u.target = null;
      } else {
        dest = u.target;
      }
    }
    this.steer(u, dest, dt);
  }

  steer(u, dest, dt, coast = false) {
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
    } else if (!coast) {
      u.speed = u.speed > 0 ? Math.max(0, u.speed - 2 * dt) : Math.min(0, u.speed + 2 * dt);
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

  /**
   * Fire weapon w (see LOADOUTS; defaults to the ship's main weapon) at target, an entity or a point.
   * precise: the player's shot, which goes exactly where aimed with only a little dispersion; AI
   * shots lead moving targets but scatter with distance and difficulty.
   */
  fire(u, target, w = this.weaponFor(u), precise = false) {
    const s = u.stats;
    u.revealedUntil = this.time + REVEAL_TIME;
    // In a deathmatch both AI fleets shoot equally well, so the player's own aim decides the battle.
    const acc = u.team === 'enemy' || this.demo || this.deathmatch ? this.diff.accuracy : 0.9;
    const vol = this.volumeAt(u.x, u.z);
    u.mesh.updateMatrixWorld();

    if (w.kind === 'torpedo') {
      const lead = precise ? target : this.leadPoint(u, target, w.speed);
      const base = Math.atan2(lead.z - u.z, lead.x - u.x) + (precise ? 0 : (Math.random() - 0.5) * (1 - acc) * 0.6);
      const bow = (u.mesh.userData.bow || new THREE.Vector3(s.size * 0.45, -0.3, 0)).clone().applyMatrix4(u.mesh.matrixWorld);
      const n = w.count || 1;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * (w.fan || 0);
        const mesh = new THREE.Mesh(torpGeo, torpMat);
        mesh.rotation.y = -a;
        this.root.add(mesh);
        this.projectiles.push({
          kind: 'torpedo', team: u.team, x: bow.x, z: bow.z, dx: Math.cos(a), dz: Math.sin(a), speed: w.speed,
          traveled: 0, maxDist: w.range * 1.05, damage: w.damage, mesh, bubbleAcc: 0,
        });
      }
      sfx.torpedo(vol);
      return;
    }

    if (w.kind === 'missile') {
      const mesh = new THREE.Mesh(missileGeo, missileMat);
      this.root.add(mesh);
      this.projectiles.push({
        kind: 'missile', team: u.team, x: u.x, z: u.z, y: 4, heading: u.heading, speed: w.speed, target,
        life: (w.range * 1.3) / w.speed, damage: w.damage, mesh, trailAcc: 0, age: 0,
      });
      sfx.torpedo(vol);
      sfx.gun(vol * 0.6);
      return;
    }

    if (w.kind === 'depth') {
      // A pattern of three charges rolled off the stern; they go off a moment later.
      const fx = Math.cos(u.heading), fz = Math.sin(u.heading);
      for (let i = 0; i < 3; i++) {
        const back = s.size * 0.5 + 4 + i * 7;
        const x = u.x - fx * back + (i - 1) * fz * 5, z = u.z - fz * back - (i - 1) * fx * 5;
        const mesh = new THREE.Mesh(chargeGeo, torpMat);
        mesh.position.set(x, 0, z);
        this.root.add(mesh);
        this.effects.splash(x, z, this.t, 0.4);
        this.projectiles.push({ kind: 'depth', team: u.team, x, z, t: 1.6 + i * 0.35, damage: w.damage, radius: w.radius, mesh });
      }
      sfx.splash(vol);
      return;
    }

    this.fireDirect(u, target, w, precise, acc);
    sfx.gun(vol, w.damage >= 40);
  }

  /**
   * Direct fire: shells leave the muzzle fast and nearly flat, then gravity takes over.
   * A precise shot at a 3D point (the bridge crosshair) goes straight along the line to it. Otherwise
   * (AI, or a point on the water) the guns take the low elevation that reaches the target; the AI
   * also leads moving ships and misjudges bearing and elevation a little.
   */
  fireDirect(u, target, w, precise, acc) {
    const guns = u.mesh.userData.guns.length ? u.mesh.userData.guns : [null];
    const aimed = precise ? target : this.leadPoint(u, target, w.velocity);
    const err = precise ? 0 : 1 - acc;
    guns.forEach((gun, i) => {
      const from = gun
        ? gun.muzzle.clone().applyMatrix4(gun.node.matrixWorld)
        : new THREE.Vector3(u.x + Math.cos(u.heading) * 3, 3, u.z + Math.sin(u.heading) * 3);
      this.launchShell(u.team, from, aimed, w, {
        precise, err, delay: i * 0.06, damage: w.damage / guns.length, subBonus: w.subBonus || u.stats.subBonus || 1,
      });
      if (gun) this.muzzleFlash(from, gun);
    });
  }

  // One direct-fire shell from 'from' toward 'aimed' (see fireDirect).
  launchShell(team, from, aimed, w, { precise = false, err = 0, delay = 0, damage = w.damage, subBonus = 1 } = {}) {
    const g = DEATHMATCH.gravity, v = w.velocity;
    const cone = (w.spread || 2) / 600;
    const d = Math.hypot(aimed.x - from.x, aimed.z - from.z) || 1;
    let yaw = Math.atan2(aimed.z - from.z, aimed.x - from.x);
    let pitch = precise && aimed.y !== undefined
      ? Math.atan2(aimed.y - from.y, d)
      : 0.5 * Math.asin(Math.min(1, (g * d) / (v * v))) + Math.atan2(1.5 - from.y, d);
    yaw += (Math.random() - 0.5) * 2 * (cone + err * 0.06);
    pitch += (Math.random() - 0.5) * 2 * (cone * 0.5 + err * 0.01);
    const vel = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).multiplyScalar(v);
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.position.copy(from);
    mesh.visible = false;
    this.root.add(mesh);
    this.projectiles.push({
      kind: 'direct', team, pos: from, vel, delay, traveled: 0, maxDist: Math.max(w.range * 1.8, w.range + 60),
      damage, splash: w.splash || 0, subBonus, mesh,
    });
  }

  // The enemy hull (as a box: length, beam, height to the top of the superstructure) at a point in the air.
  hullAt(pos, foe) {
    for (const e of this.units) {
      if (!e.alive || e.team !== foe) continue;
      const s = e.stats;
      const dx = pos.x - e.x, dz = pos.z - e.z;
      if (dx * dx + dz * dz > s.size * s.size * 0.3) continue;
      const c = Math.cos(e.heading), sn = Math.sin(e.heading);
      const along = dx * c + dz * sn, across = -dx * sn + dz * c;
      const top = s.stealth ? 2.6 : s.size * 0.3 + 1.5;
      if (Math.abs(along) < s.size * 0.5 && Math.abs(across) < s.size * 0.13 + 0.8 && pos.y < top && pos.y > -1.5) return e;
    }
    return null;
  }

  harborAt(pos, foe) {
    const h = this.harbors[foe];
    if (this.deathmatch || !h.alive || h.dyingT >= 0 || pos.y > 14) return null;
    return Math.hypot(pos.x - h.x, pos.z - h.z) < h.radius ? h : null;
  }

  // Fly a direct-fire shell in small steps so fast shells can't skip through a hull.
  updateDirect(p, dt) {
    if (p.delay > 0) {
      p.delay -= dt;
      return true;
    }
    p.mesh.visible = true;
    const foe = other(p.team);
    const speed = p.vel.length();
    const steps = Math.max(1, Math.ceil((speed * dt) / 3));
    const h = dt / steps;
    const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
    for (let i = 0; i < steps; i++) {
      p.vel.y -= DEATHMATCH.gravity * h;
      p.pos.addScaledVector(p.vel, h);
      p.traveled += speed * h;
      const victim = this.hullAt(p.pos, foe) || this.harborAt(p.pos, foe);
      if (victim) return this.directHit(p, victim);
      // Mean sea level, not each crest: guns sit low enough that crests would swallow every flat shot.
      if (p.pos.y < 0) return this.directHit(p, null);
      if (p.pos.y < 12 && ISLANDS.some((is) => Math.hypot(p.pos.x - is.x, p.pos.z - is.z) < is.r * 0.85)) {
        this.root.remove(p.mesh);
        this.explode(p.pos.x, p.pos.y, p.pos.z, 0.6);
        return false;
      }
      if (p.traveled > p.maxDist) {
        this.root.remove(p.mesh);
        return false;
      }
    }
    p.mesh.position.copy(p.pos);
    // Tracer streak along this frame's path.
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      this.effects.emit(px + (p.pos.x - px) * t, py + (p.pos.y - py) * t, pz + (p.pos.z - pz) * t, 0, 0, 0,
        { life: 0.22, size0: 0.9, size1: 0.3, alpha: 0.9, color: [1, 0.78, 0.4] });
    }
    return true;
  }

  directHit(p, victim) {
    const { x, z } = p.pos;
    const foe = other(p.team);
    const vol = this.volumeAt(x, z);
    this.root.remove(p.mesh);
    if (victim) {
      // Destroyers' anti-submarine gear: their shells hit submarines harder.
      this.damage(victim, p.damage * (victim.kind === 'ship' && victim.stats.stealth ? p.subBonus : 1), p.team);
      this.explode(x, Math.max(p.pos.y, 1), z, p.splash ? 1.2 : 0.7);
      sfx.explosion(vol, !!p.splash);
    } else {
      this.effects.splash(x, z, this.t, p.splash ? 1.3 : 0.8);
      sfx.splash(vol);
    }
    // Heavy shells hurt with near misses too.
    if (p.splash) {
      for (const e of this.units) {
        if (e.alive && e.team === foe && e !== victim && Math.hypot(e.x - x, e.z - z) < p.splash + e.stats.size * 0.3) {
          this.damage(e, p.damage * 0.5, p.team);
        }
      }
    }
    return false;
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
    if (!best && !this.deathmatch && h.alive && Math.hypot(h.x - x, h.z - z) < h.radius + extra) best = h;
    return best;
  }

  updateProjectiles(dt) {
    const fx = this.effects;
    this.projectiles = this.projectiles.filter((p) => {
      if (p.kind === 'direct') return this.updateDirect(p, dt);
      if (p.kind === 'missile') return this.updateMissile(p, dt);
      if (p.kind === 'depth') return this.updateDepthCharge(p, dt);

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

  // Sea-skimming missile: climbs out, then homes on its locked target until it hits or runs dry.
  updateMissile(p, dt) {
    const fx = this.effects;
    p.life -= dt;
    p.age += dt;
    const t = p.target;
    if (t && t.alive) {
      const want = Math.atan2(t.z - p.z, t.x - p.x);
      p.heading += THREE.MathUtils.clamp(wrapAngle(want - p.heading), -2.4 * dt, 2.4 * dt);
    }
    const sp = p.speed * Math.min(1, 0.4 + p.age);
    p.x += Math.cos(p.heading) * sp * dt;
    p.z += Math.sin(p.heading) * sp * dt;
    const h = sampleOcean(p.x, p.z, this.t);
    p.y += ((p.age < 0.8 ? 9 : h + 2.5) - p.y) * Math.min(1, dt * 3);
    p.mesh.position.set(p.x, p.y, p.z);
    p.mesh.rotation.set(0, -p.heading, 0);
    p.trailAcc += dt * 40;
    while (p.trailAcc >= 1) {
      p.trailAcc--;
      fx.emit(p.x - Math.cos(p.heading) * 1.6, p.y, p.z - Math.sin(p.heading) * 1.6, 0, 0.4, 0,
        { life: 1.6, size0: 0.8, size1: 3.5, alpha: 0.5, color: [0.85, 0.85, 0.85] });
      fx.emit(p.x - Math.cos(p.heading) * 1.5, p.y, p.z - Math.sin(p.heading) * 1.5, 0, 0, 0,
        { life: 0.12, size0: 1.4, size1: 0.4, alpha: 1, color: [1, 0.7, 0.3] });
    }
    const victim = this.hitAt(p.x, p.z, other(p.team), 1);
    const aground = ISLANDS.some((is) => Math.hypot(p.x - is.x, p.z - is.z) < is.r);
    if (victim || aground || p.life <= 0) {
      this.root.remove(p.mesh);
      if (victim) this.damage(victim, p.damage, p.team);
      this.explode(p.x, p.y, p.z, victim ? 1.3 : 0.7);
      if (!victim && !aground) fx.splash(p.x, p.z, this.t, 1);
      sfx.explosion(this.volumeAt(p.x, p.z), !!victim);
      return false;
    }
    return true;
  }

  // Depth charge: sinks for a moment, then a column of water. Deadly to submarines, rough on hulls above.
  updateDepthCharge(p, dt) {
    p.t -= dt;
    p.mesh.position.y = sampleOcean(p.x, p.z, this.t) - (1.6 - p.t) * 1.5;
    if (p.t > 0) return true;
    this.root.remove(p.mesh);
    const foe = other(p.team);
    for (const e of this.units) {
      if (!e.alive || e.team !== foe) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z) - e.stats.size * 0.3;
      if (d < p.radius) this.damage(e, p.damage * (e.stats.stealth ? 1 : 0.5) * (1 - Math.max(0, d) / p.radius * 0.5), p.team);
    }
    this.effects.splash(p.x, p.z, this.t, 2.2);
    this.explode(p.x, 0.5, p.z, 0.5);
    sfx.explosion(this.volumeAt(p.x, p.z));
    return false;
  }

  damage(e, amount, byTeam) {
    if (!e.alive) return;
    // The difficulty softens enemy fire; in a deathmatch only on your own ship, so escort fights stay even.
    if (byTeam === 'enemy' && !this.demo && (!this.deathmatch || e === this.helm)) amount *= this.diff.enemyDamage;
    if (e === this.helm) amount *= HELM_ARMOR;
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
      u.mesh.userData.dispose();
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
    // The fortress gun covers the harbor approaches (not in a deathmatch, where harbors are scenery).
    if (this.deathmatch) return;
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
        this.launchShell(h.team, from, this.leadPoint(h, best, HARBOR_GUN.velocity), HARBOR_GUN, { err: 0.15 });
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
      // From the bridge you don't see your own ship's ring and health bar.
      const own = u === this.fpShip;
      u.ring.visible = visible && !own && (u.selected || u.hovered);
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
      u.bar.visible = visible && !own && (u.selected || u.hovered || u.hp < u.maxHp);
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
    // The helm ship's guns follow where the captain is looking (aimPoint); others track their target.
    const tgt = u.aimPoint || (u.aimAt && this.validTarget(u, u.aimAt) ? u.aimAt : null);
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
