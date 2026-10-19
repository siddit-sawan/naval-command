import { UNITS, ECONOMY } from './config.js';

const other = (team) => (team === 'player' ? 'enemy' : 'player');

// Rough shopping list: what share of the fleet each class should make up.
const MIX = { corvette: 0.3, destroyer: 0.35, submarine: 0.15, battleship: 0.2 };

export class EnemyAI {
  constructor(game, team, cfg) {
    this.game = game;
    this.team = team;
    this.cfg = cfg;
    this.thinkT = 1 + Math.random();
    this.waves = 0;
    this.saveFor = null;
    this.attacking = new Set();
  }

  update(dt) {
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = this.cfg.think * (0.8 + Math.random() * 0.4);
    this.build();
    this.command();
  }

  build() {
    const g = this.game;
    const t = g.teams[this.team];
    if (t.queue.length >= 2) return;
    const fleet = g.alive(this.team);
    if (fleet.length + t.queue.length >= ECONOMY.maxShips) return;

    let choice = this.saveFor;
    if (!choice) {
      // Build whatever class is furthest below its share; counter enemy subs with destroyers.
      const counts = {};
      for (const u of fleet) counts[u.type] = (counts[u.type] || 0) + 1;
      for (const q of t.queue) counts[q] = (counts[q] || 0) + 1;
      const total = fleet.length + t.queue.length || 1;
      const foeSubs = g.alive(other(this.team)).filter((u) => u.stats.stealth && u.spotted).length;
      let bestGap = -Infinity;
      for (const [type, share] of Object.entries(MIX)) {
        let gap = share - (counts[type] || 0) / total + Math.random() * 0.15;
        if (type === 'destroyer') gap += foeSubs * 0.1;
        if (g.time < 60 && type === 'battleship') gap -= 0.3;
        if (gap > bestGap) { bestGap = gap; choice = type; }
      }
    }
    if (t.gold >= UNITS[choice].cost) {
      g.queueBuild(this.team, choice);
      this.saveFor = null;
    } else if (UNITS[choice].cost > 150 && Math.random() < 0.6) {
      this.saveFor = choice; // save up for the big ship
    } else if (t.gold >= UNITS.corvette.cost && fleet.length < 4) {
      g.queueBuild(this.team, 'corvette');
      this.saveFor = null;
    }
  }

  command() {
    const g = this.game;
    const foe = other(this.team);
    const mine = g.alive(this.team);
    const home = g.harbors[this.team];
    const enemyHarbor = g.harbors[foe];
    for (const id of this.attacking) if (!mine.some((u) => u.id === id)) this.attacking.delete(id);

    // Defend the harbor first.
    const threats = g.alive(foe).filter((e) => g.visibleTo(e, this.team) && Math.hypot(e.x - home.x, e.z - home.z) < 170);
    if (threats.length) {
      const tx = threats.reduce((s, e) => s + e.x, 0) / threats.length;
      const tz = threats.reduce((s, e) => s + e.z, 0) / threats.length;
      const defenders = mine
        .filter((u) => !this.attacking.has(u.id))
        .sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz))
        .slice(0, Math.max(2, threats.length + 1));
      g.order(defenders, { type: 'attackmove', x: tx, z: tz });
    }

    // Launch an attack wave once the fleet is big enough; each wave needs a bit more.
    const idle = mine.filter((u) => !this.attacking.has(u.id));
    const needed = this.cfg.attackArmy + this.waves;
    if (idle.length >= needed || (g.time > 420 && idle.length >= 3)) {
      const wave = idle.filter((u) => u.mode === 'idle' || u.mode === 'attackmove');
      if (wave.length >= Math.min(needed, 3)) {
        this.waves++;
        for (const u of wave) this.attacking.add(u.id);
        g.order(wave, { type: 'attackmove', x: enemyHarbor.x, z: enemyHarbor.z });
        return;
      }
    }

    // Re-send attackers that stalled (e.g. after a fight).
    const stalled = mine.filter((u) => this.attacking.has(u.id) && u.mode === 'idle');
    if (stalled.length) g.order(stalled, { type: 'attackmove', x: enemyHarbor.x, z: enemyHarbor.z });

    // Everyone else grabs outposts in pairs, nearest first.
    const free = mine.filter((u) => u.mode === 'idle' && !this.attacking.has(u.id));
    if (!free.length) return;
    const targets = g.outposts
      .filter((o) => o.owner !== this.team || o.progress * (this.team === 'player' ? 1 : -1) < 0.9)
      .sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z));
    if (!targets.length) {
      // Hold the outpost nearest the enemy.
      const front = [...g.outposts].sort((a, b) =>
        Math.hypot(a.x - enemyHarbor.x, a.z - enemyHarbor.z) - Math.hypot(b.x - enemyHarbor.x, b.z - enemyHarbor.z))[0];
      g.order(free, { type: 'attackmove', x: front.x, z: front.z });
      return;
    }
    const assigned = new Map();
    while (free.length) {
      const group = free.splice(0, 2);
      const lead = group[0];
      let best = targets[0], bestScore = Infinity;
      for (const o of targets) {
        const score = Math.hypot(o.x - lead.x, o.z - lead.z) + (assigned.get(o) || 0) * 250;
        if (score < bestScore) { best = o; bestScore = score; }
      }
      assigned.set(best, (assigned.get(best) || 0) + 1);
      g.order(group, { type: 'attackmove', x: best.x, z: best.z });
    }
  }
}
