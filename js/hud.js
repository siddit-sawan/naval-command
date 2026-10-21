import { UNITS, UNIT_ORDER, ECONOMY, MAP, TEAM_COLORS, CAPTURE } from './config.js';

const $ = (id) => document.getElementById(id);
const STATUS = { idle: 'Holding position', move: 'Under way', attack: 'Attacking', attackmove: 'Attack-moving' };
const MINI = MAP.bounds + 30;

export class Hud {
  constructor({ onBuild, onMinimapJump, onMinimapOrder, onMute, onPause }) {
    this.el = {
      gold: $('gold'), income: $('income'), mine: $('myOutposts'), foe: $('foeOutposts'), timer: $('timer'),
      queue: $('queue'), toast: $('toast'), selTitle: $('selTitle'), selBody: $('selBody'), mute: $('muteBtn'),
    };
    this.buttons = {};
    this.onBuild = onBuild;
    for (const btn of document.querySelectorAll('#build .unit-btn')) {
      const type = btn.dataset.unit;
      this.buttons[type] = { btn, prog: btn.querySelector('.prog') };
      btn.addEventListener('click', () => onBuild(type));
    }
    $('muteBtn').addEventListener('click', onMute);
    $('pauseBtn').addEventListener('click', onPause);

    this.canvas = $('minimapCanvas');
    this.ctx = this.canvas.getContext('2d');
    const toWorld = (e) => {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - r.left) / r.width) * 2 * MINI - MINI,
        z: ((e.clientY - r.top) / r.height) * 2 * MINI - MINI,
      };
    };
    let dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      const p = toWorld(e);
      if (e.button === 2) { onMinimapOrder(p.x, p.z); return; }
      dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      onMinimapJump(p.x, p.z);
    });
    this.canvas.addEventListener('pointermove', (e) => { if (dragging) { const p = toWorld(e); onMinimapJump(p.x, p.z); } });
    this.canvas.addEventListener('pointerup', () => { dragging = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.toastTimer = 0;
  }

  // Build buttons for the exclusive ships the player owns, keyed 5, 6, ... after the standard four.
  setExclusives(types) {
    for (const type of Object.keys(this.buttons)) {
      if (!UNITS[type].exclusive) continue;
      this.buttons[type].btn.remove();
      delete this.buttons[type];
    }
    types.forEach((type, i) => {
      const u = UNITS[type];
      const btn = document.createElement('button');
      btn.className = 'unit-btn exclusive';
      btn.dataset.unit = type;
      btn.innerHTML = `<span class="key">${UNIT_ORDER.length + 1 + i}</span><span class="name">${u.label}</span><span class="cost">⛃ ${u.cost}</span><span class="desc">Exclusive</span><div class="prog"></div>`;
      btn.addEventListener('click', () => this.onBuild(type));
      $('build').appendChild(btn);
      this.buttons[type] = { btn, prog: btn.querySelector('.prog') };
    });
  }

  setMuted(m) {
    this.el.mute.textContent = m ? '🔇' : '🔊';
  }

  toast(text, color = '#f0b429') {
    const t = this.el.toast;
    t.textContent = text;
    t.style.color = color;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  update(game, selected) {
    const team = game.teams.player;
    this.el.gold.textContent = Math.floor(team.gold);
    this.el.income.textContent = game.incomeOf('player').toFixed(0);
    this.el.mine.textContent = game.outposts.filter((o) => o.owner === 'player').length;
    this.el.foe.textContent = game.outposts.filter((o) => o.owner === 'enemy').length;
    const secs = Math.floor(game.time);
    this.el.timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

    const full = team.queue.length >= ECONOMY.maxQueue;
    const current = team.queue[0];
    for (const [type, { btn, prog }] of Object.entries(this.buttons)) {
      btn.disabled = full || team.gold < UNITS[type].cost;
      const queued = team.queue.filter((q) => q === type).length;
      btn.title = queued ? `${queued} queued` : '';
      prog.style.width = type === current ? `${(team.buildT / game.buildTime('player', type)) * 100}%` : '0';
    }
    if (team.queue.length) {
      const capped = game.alive('player').length >= game.maxShips('player');
      this.el.queue.textContent = capped
        ? `Fleet at maximum size (${game.maxShips('player')})`
        : `Building ${UNITS[current].label}${team.queue.length > 1 ? ` · ${team.queue.length - 1} more queued` : ''}`;
      this.el.queue.classList.remove('hidden');
    } else {
      this.el.queue.classList.add('hidden');
    }

    this.renderSelection(game, selected);
  }

  // Rewriting innerHTML forces layout, so only touch the DOM when the content actually changed.
  setPanel(title, cls, html) {
    if (this.panelKey === title + cls + html) return;
    this.panelKey = title + cls + html;
    this.el.selTitle.textContent = title;
    this.el.selBody.className = cls;
    this.el.selBody.innerHTML = html;
  }

  renderSelection(game, sel) {
    if (!sel.length) {
      this.setPanel('No selection', 'muted', game.manual
        ? 'No ships left. Build one to take the helm.'
        : 'Click a ship, or drag to select a group.<br>Right-click water to move, an enemy to attack.');
      return;
    }
    if (sel.length === 1) {
      const u = sel[0];
      const s = u.stats;
      const engaged = u.engage && game.distTo(u, u.engage) <= s.range;
      let status = engaged && u.mode !== 'attack' ? 'Engaging' : STATUS[u.mode];
      if (u === game.helm) {
        const weapon = u.weapons ? u.weapons[u.weaponIdx].name : s.weapon === 'torpedo' ? 'Torpedoes' : 'Guns';
        status = `At the helm · ${u.cooldown > 0 ? 'Reloading…' : `<span style="color:var(--green)">${weapon} ready</span>`}`;
      }
      const plane = game.planeStatus(u);
      this.setPanel(`HMS ${u.name}`, '', `<div class="muted">${s.label} · ${status}</div>${plane ? `<div class="muted">✈ ${plane}</div>` : ''}
        <div class="hpbar"><div style="width:${Math.round((u.hp / u.maxHp) * 100)}%"></div></div>
        Hull ${Math.ceil(u.hp)}/${u.maxHp} · ${(u.speed * 2).toFixed(0)} kn<br>
        <span class="muted">Range ${s.range} · ${s.weapon === 'torpedo' ? 'Torpedoes' : 'Guns'} ${s.damage}${s.stealth ? '<br>Hidden unless enemies are close' : ''}${s.subBonus ? '<br>Hunts submarines' : ''}</span>`);
      return;
    }
    const counts = {};
    for (const u of sel) counts[u.stats.label] = (counts[u.stats.label] || 0) + 1;
    const hp = sel.reduce((s, u) => s + u.hp, 0) / sel.reduce((s, u) => s + u.maxHp, 0);
    this.setPanel(`${sel.length} ships selected`, '', `<div class="muted">${Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}</div>
      <div class="hpbar"><div style="width:${Math.round(hp * 100)}%"></div></div>`);
  }

  drawMinimap(game, viewCorners) {
    const c = this.ctx;
    const W = this.canvas.width;
    const k = W / (2 * MINI);
    const mx = (x) => (x + MINI) * k;
    const my = (z) => (z + MINI) * k;

    c.fillStyle = '#0b2e47';
    c.fillRect(0, 0, W, W);

    c.fillStyle = '#c9b27a';
    for (const is of MAP.islands) {
      c.beginPath();
      c.arc(mx(is.x), my(is.z), is.r * k, 0, Math.PI * 2);
      c.fill();
    }

    for (const h of Object.values(game.harbors)) {
      const s = h.radius * k;
      c.fillStyle = h.alive ? TEAM_COLORS[h.team].css : '#555';
      c.fillRect(mx(h.x) - s, my(h.z) - s * 0.6, s * 2, s * 1.2);
    }

    for (const o of game.outposts) {
      const x = mx(o.x), y = my(o.z);
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y, CAPTURE.radius * k, 0, Math.PI * 2);
      c.stroke();
      if (o.progress) {
        c.strokeStyle = TEAM_COLORS[o.progress > 0 ? 'player' : 'enemy'].css;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x, y, CAPTURE.radius * k, -Math.PI / 2, -Math.PI / 2 + Math.abs(o.progress) * Math.PI * 2);
        c.stroke();
      }
      c.fillStyle = o.owner ? TEAM_COLORS[o.owner].css : '#e6f2fa';
      c.beginPath();
      c.moveTo(x, y - 5); c.lineTo(x + 5, y); c.lineTo(x, y + 5); c.lineTo(x - 5, y);
      c.fill();
    }

    for (const u of game.units) {
      if (!u.alive || !game.visibleTo(u, 'player')) continue;
      const r = 2 + u.stats.size / 14;
      c.fillStyle = TEAM_COLORS[u.team].css;
      c.beginPath();
      c.arc(mx(u.x), my(u.z), r, 0, Math.PI * 2);
      c.fill();
      if (u.selected) {
        c.strokeStyle = '#fff';
        c.lineWidth = 1;
        c.stroke();
      }
    }

    for (const p of game.aircraft) {
      const x = mx(p.x), y = my(p.z);
      c.strokeStyle = TEAM_COLORS[p.team].css;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.moveTo(x, y - 3); c.lineTo(x, y + 3);
      c.stroke();
    }

    if (viewCorners) {
      c.strokeStyle = 'rgba(255,255,255,0.8)';
      c.lineWidth = 1;
      c.beginPath();
      viewCorners.forEach((p, i) => (i ? c.lineTo(mx(p.x), my(p.z)) : c.moveTo(mx(p.x), my(p.z))));
      c.closePath();
      c.stroke();
    }
  }

  showGameOver(game, winner) {
    const won = winner === 'player';
    const text = $('resultText');
    text.textContent = won ? 'Victory' : 'Defeat';
    text.className = `result ${won ? 'win' : 'lose'}`;
    const p = game.teams.player;
    const secs = Math.floor(game.time);
    $('resultStats').innerHTML = [
      `Battle time: ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      `Ships built: ${p.built}`,
      `Enemy ships sunk: ${p.kills}`,
      `Ships lost: ${p.lost}`,
      `Outposts held: ${game.outposts.filter((o) => o.owner === 'player').length} / ${game.outposts.length}`,
    ].join('<br>');
  }
}
