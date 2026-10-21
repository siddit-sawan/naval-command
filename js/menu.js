import { profile, RANKS } from './profile.js';
import { LIVERIES, STORE_ORDER, drawPreview } from './livery.js';
import { showAd } from './platform.js';
import { UPGRADES, UPGRADE_ORDER, UNITS, EXCLUSIVE_ORDER } from './config.js';
import { sfx } from './audio.js';
import { createShowroom } from './showroom.js';

// Everything around the battles: the profile bar, Shop, daily reward, free-coin ads,
// Service Record, how-to-play, and the coin rewards on the end screen.

const $ = (id) => document.getElementById(id);
const FREE_COINS = 75;
const FREE_COINS_COOLDOWN = 3 * 60 * 1000;

const coin = '<span class="coin"></span>';
const fmt = (n) => Math.round(n).toLocaleString();

/**
 * adHooks: { onStart, onEnd } to pause and mute the game around an ad.
 * onLiveryChange(id): the equipped livery changed (e.g. repaint the menu's backdrop fleet).
 */
export function createMenus({ adHooks, onLiveryChange }) {
  let freeCoinsAt = 0;
  let noticeTimer = 0;

  function notify(text, color = '#f0b429') {
    const n = $('notice');
    n.innerHTML = text;
    n.style.color = color;
    n.classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => n.classList.remove('show'), 2800);
  }

  function openModal(id) {
    sfx.click();
    for (const m of document.querySelectorAll('.modal')) m.classList.toggle('hidden', m.id !== id);
  }
  function closeModals() {
    for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden');
  }
  for (const btn of document.querySelectorAll('.modal .close')) btn.addEventListener('click', () => { sfx.click(); closeModals(); });
  for (const m of document.querySelectorAll('.modal')) m.addEventListener('click', (e) => { if (e.target === m) closeModals(); });

  // ---------- Profile bar ----------
  function renderProfile() {
    const d = profile.data;
    const r = profile.rank();
    for (const id of ['coinCount', 'storeCoins']) $(id).textContent = fmt(d.coins);
    $('rankName').textContent = r.name;
    $('rankBadge').textContent = '★'.repeat(Math.min(5, 1 + Math.floor(r.index / 2)));
    $('xpFill').style.width = `${Math.round(r.progress * 100)}%`;
    $('xpText').textContent = r.next ? `${fmt(d.xp)} / ${fmt(r.next.xp)} XP` : `${fmt(d.xp)} XP · top rank`;
    $('dailyDot').classList.toggle('hidden', !profile.dailyAvailable());
  }
  profile.onChange(renderProfile);
  renderProfile();

  // ---------- Livery Store ----------
  function renderStore() {
    const grid = $('storeGrid');
    grid.innerHTML = '';
    for (const id of STORE_ORDER) {
      const lv = LIVERIES[id];
      const owned = profile.owns(id);
      const equipped = profile.data.livery === id;
      const card = document.createElement('div');
      card.className = `livery-card${equipped ? ' equipped' : ''}`;
      const cv = document.createElement('canvas');
      cv.width = 320;
      cv.height = 120;
      drawPreview(cv, id);
      card.appendChild(cv);
      const info = document.createElement('div');
      info.className = 'livery-info';
      info.innerHTML = `<div class="livery-name" style="--acc:${lv.accent}">${lv.name}</div><div class="livery-desc">${lv.desc}</div>`;
      card.appendChild(info);
      const btn = document.createElement('button');
      btn.className = 'btn small';
      if (equipped) {
        btn.textContent = 'Equipped';
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = 'Equip';
        btn.onclick = () => {
          profile.equip(id);
          sfx.click();
          notify(`${lv.name} equipped`, lv.accent);
          onLiveryChange(id);
          renderStore();
        };
      } else if (lv.ads) {
        const seen = profile.data.adProgress[id] || 0;
        btn.innerHTML = `📺 Watch ad (${seen}/${lv.ads})`;
        btn.classList.add('ad');
        btn.onclick = async () => {
          if (!(await showAd('rewarded', adHooks))) { notify('Ad closed early, no progress', '#ff5a4f'); return; }
          if (profile.adWatched(id) >= lv.ads) {
            profile.unlock(id);
            sfx.captured();
            notify(`${lv.name} unlocked!`, lv.accent);
          }
          renderStore();
        };
      } else {
        btn.innerHTML = `${coin} ${fmt(lv.price)}`;
        btn.classList.add('buy');
        btn.disabled = profile.data.coins < lv.price;
        btn.onclick = () => {
          if (!profile.spend(lv.price)) { sfx.denied(); return; }
          profile.unlock(id);
          profile.equip(id);
          sfx.built();
          notify(`${lv.name} purchased and equipped!`, lv.accent);
          onLiveryChange(id);
          renderStore();
        };
      }
      card.appendChild(btn);
      grid.appendChild(card);
    }
  }
  // ---------- Showroom ----------
  let showroom = null;
  $('showroomBtn').addEventListener('click', () => {
    openModal('showroomModal');
    showroom ||= createShowroom({
      canvas: $('showroomCanvas'), shipBar: $('showroomShips'), liveryBar: $('showroomLiveries'), label: $('showroomLabel'),
      equippedId: () => profile.data.livery, owns: (id) => profile.owns(id), ownsShip: (id) => profile.ownsShip(id),
    });
    showroom.open();
  });
  $('showroomBack').addEventListener('click', () => { showTab(storeTab); openModal('storeModal'); });

  // ---------- Upgrades tab ----------
  let storeTab = 'liveries';
  function renderUpgrades() {
    const grid = $('upgradeGrid');
    grid.innerHTML = '';
    for (const id of UPGRADE_ORDER) {
      const up = UPGRADES[id];
      const level = profile.upgradeLevel(id);
      const max = up.costs.length;
      const cost = profile.upgradeCost(id);
      const card = document.createElement('div');
      card.className = `upgrade-card${cost === null ? ' maxed' : ''}`;
      const pips = up.costs.map((_, i) => `<div class="pip${i < level ? ' on' : ''}"></div>`).join('');
      card.innerHTML = `<div class="upgrade-head"><span class="ico">${up.icon}</span><div>${up.name}<div class="livery-desc" style="min-height:0;font-weight:400">Level ${level} / ${max}</div></div></div>
        <div class="livery-desc">${up.desc}</div><div class="upgrade-per">Each level: ${up.per}</div><div class="pips">${pips}</div>`;
      const btn = document.createElement('button');
      btn.className = 'btn small';
      if (cost === null) {
        btn.textContent = 'Maxed out';
        btn.disabled = true;
      } else {
        btn.innerHTML = `Upgrade ${coin} ${fmt(cost)}`;
        btn.classList.add('buy');
        btn.disabled = profile.data.coins < cost;
        btn.onclick = () => {
          if (!profile.buyUpgrade(id)) { sfx.denied(); return; }
          sfx.built();
          notify(`${up.name} upgraded to level ${level + 1}!`);
          renderUpgrades();
        };
      }
      card.appendChild(btn);
      grid.appendChild(card);
    }
  }
  // ---------- Exclusive ships tab ----------
  function openShowroom(shipId) {
    openModal('showroomModal');
    showroom ||= createShowroom({
      canvas: $('showroomCanvas'), shipBar: $('showroomShips'), liveryBar: $('showroomLiveries'), label: $('showroomLabel'),
      equippedId: () => profile.data.livery, owns: (id) => profile.owns(id), ownsShip: (id) => profile.ownsShip(id),
    });
    showroom.open(shipId);
  }
  function renderShips() {
    const grid = $('shipGrid');
    grid.innerHTML = '';
    for (const id of EXCLUSIVE_ORDER) {
      const u = UNITS[id];
      const base = UNITS[u.base];
      const owned = profile.ownsShip(id);
      const card = document.createElement('div');
      card.className = `upgrade-card${owned ? ' maxed' : ''}`;
      card.innerHTML = `<div class="upgrade-head"><div>${u.label}<div class="livery-desc" style="min-height:0;font-weight:400">Based on the ${base.label}</div></div></div>
        <div class="livery-desc">${u.blurb}</div>
        <div class="ship-stats"><span>Hull</span><b>${u.hp}</b><span>Speed</span><b>${u.speed}</b><span>Range</span><b>${u.range}</b><span>Damage</span><b>${u.damage}</b></div>
        <div class="upgrade-per" style="color:var(--accent)">In battle: ${coin} ${u.cost} gold per ship (${base.label}: ${base.cost})</div>`;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px';
      const view = document.createElement('button');
      view.className = 'btn small view';
      view.textContent = '👁';
      view.title = 'View in showroom';
      view.onclick = () => openShowroom(id);
      row.appendChild(view);
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.style.flex = '1';
      if (owned) {
        btn.textContent = 'Owned · build in battle';
        btn.disabled = true;
      } else {
        btn.innerHTML = `Buy ${coin} ${fmt(u.shopPrice)}`;
        btn.classList.add('buy');
        btn.disabled = profile.data.coins < u.shopPrice;
        btn.onclick = () => {
          if (!profile.buyShip(id)) { sfx.denied(); return; }
          sfx.captured();
          notify(`${u.label} unlocked! Build it in fleet battles.`);
          renderShips();
        };
      }
      row.appendChild(btn);
      card.appendChild(row);
      grid.appendChild(card);
    }
  }
  function showTab(tab) {
    storeTab = tab;
    for (const b of document.querySelectorAll('#storeTabs .tab')) b.classList.toggle('active', b.dataset.tab === tab);
    $('storeGrid').classList.toggle('hidden', tab !== 'liveries');
    $('upgradeGrid').classList.toggle('hidden', tab !== 'upgrades');
    $('shipGrid').classList.toggle('hidden', tab !== 'ships');
    $('storeSub').textContent = tab === 'liveries'
      ? 'Paint your whole fleet. Liveries show on every ship you build.'
      : tab === 'upgrades' ? 'Permanent upgrades that carry into every battle you fight.'
        : 'Buy an exclusive ship once, then build it in fleet battles for extra gold.';
    if (tab === 'liveries') renderStore(); else if (tab === 'upgrades') renderUpgrades(); else renderShips();
  }
  for (const b of document.querySelectorAll('#storeTabs .tab')) b.addEventListener('click', () => { sfx.click(); showTab(b.dataset.tab); });
  $('storeBtn').addEventListener('click', () => { showTab(storeTab); openModal('storeModal'); });
  $('storeFreeBtn').addEventListener('click', freeCoins);

  // ---------- Free coins (rewarded ad, with a cooldown) ----------
  async function freeCoins() {
    const wait = freeCoinsAt - Date.now();
    if (wait > 0) {
      notify(`More free coins in ${Math.ceil(wait / 1000)}s`);
      return;
    }
    if (!(await showAd('rewarded', adHooks))) { notify('Ad closed early, no reward', '#ff5a4f'); return; }
    freeCoinsAt = Date.now() + FREE_COINS_COOLDOWN;
    profile.addCoins(FREE_COINS);
    sfx.built();
    notify(`+${FREE_COINS} ${coin}`);
    if (!$('storeModal').classList.contains('hidden')) ({ liveries: renderStore, upgrades: renderUpgrades, ships: renderShips })[storeTab]();
  }
  $('freeCoinsBtn').addEventListener('click', freeCoins);
  setInterval(() => {
    const wait = freeCoinsAt - Date.now();
    const label = wait > 0 ? `📺 Free coins in ${Math.ceil(wait / 1000)}s` : `📺 +${FREE_COINS} Free Coins`;
    $('freeCoinsBtn').textContent = label;
    $('storeFreeBtn').textContent = label;
  }, 1000);

  // ---------- Daily reward ----------
  function renderDaily() {
    const d = profile.data;
    const avail = profile.dailyAvailable();
    const preview = profile.dailyPreview();
    const streak = avail ? preview.streak : d.daily.streak;
    $('dailyDays').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const day = i + 1;
      const coins = 60 + 30 * i;
      const state = day < streak || (!avail && day === streak) ? 'done' : day === streak ? 'today' : '';
      return `<div class="day ${state}"><div>Day ${day}</div><b>${coin}${coins}</b></div>`;
    }).join('');
    $('dailyClaim').classList.toggle('hidden', !avail);
    $('dailyClaim').innerHTML = `Claim ${coin} ${preview.coins}`;
    $('dailyDone').classList.toggle('hidden', avail);
  }
  $('dailyBtn').addEventListener('click', () => { renderDaily(); openModal('dailyModal'); });
  $('dailyClaim').addEventListener('click', () => {
    const r = profile.claimDaily();
    if (!r) return;
    sfx.captured();
    notify(`Day ${r.streak} reward: +${r.coins} ${coin}`);
    renderDaily();
    const dbl = $('dailyDouble');
    dbl.classList.remove('hidden');
    dbl.disabled = false;
    dbl.innerHTML = `📺 Watch an ad to double (+${r.coins})`;
    dbl.onclick = async () => {
      dbl.disabled = true;
      if (!(await showAd('rewarded', adHooks))) { dbl.disabled = false; notify('Ad closed early, no bonus', '#ff5a4f'); return; }
      profile.addCoins(r.coins);
      sfx.built();
      notify(`Doubled! +${r.coins} ${coin}`);
      dbl.classList.add('hidden');
    };
  });

  // ---------- Service record ----------
  function renderRecord() {
    const s = profile.data.stats;
    const r = profile.rank();
    const mins = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    $('recordStats').innerHTML = [
      ['Battles fought', s.games],
      ['Victories', s.wins],
      ['Ranked War wins', `${s.rankedWins} / ${s.rankedGames}`],
      ['Win rate', s.games ? `${Math.round((s.wins / s.games) * 100)}%` : '–'],
      ['Enemy ships sunk', s.sunk],
      ['Ships lost', s.lost],
      ['Outposts held at the end', s.outposts],
      ['Fastest victory', s.bestTime ? mins(s.bestTime) : '–'],
      ['Coins earned', fmt(s.coinsEarned)],
      ['Liveries collected', `${profile.data.owned.length} / ${STORE_ORDER.length}`],
    ].map(([k, v]) => `<div>${k}</div><b>${v}</b>`).join('');
    $('rankLadder').innerHTML = RANKS.map((rk, i) =>
      `<div class="rung ${i < r.index ? 'past' : i === r.index ? 'current' : ''}"><span>${rk.name}</span><span>${fmt(rk.xp)} XP</span></div>`).join('');
  }
  $('recordBtn').addEventListener('click', () => { renderRecord(); openModal('recordModal'); });
  $('helpBtn').addEventListener('click', () => openModal('helpModal'));

  // ---------- End of a match ----------
  function showMatchReward(game, winner) {
    const p = game.teams.player;
    const reward = profile.finishMatch({
      won: winner === 'player',
      difficulty: game.difficulty,
      rank: game.rankLevel,
      sunk: p.kills,
      lost: p.lost,
      outposts: game.outposts.filter((o) => o.owner === 'player').length,
      seconds: game.time,
    });
    $('rewardLines').innerHTML = reward.lines
      .map(([k, v]) => `<div>${k}</div><b>${v === null ? '' : `+${v}`}</b>`).join('');
    $('rewardTotal').innerHTML = `+${fmt(reward.total)} ${coin}`;
    $('rankUp').classList.toggle('hidden', !reward.rankUp);
    $('rankUp').textContent = reward.rankUp ? `Promoted to ${reward.rankUp}!` : '';
    const dbl = $('rewardDouble');
    dbl.disabled = false;
    dbl.classList.remove('hidden');
    dbl.innerHTML = `📺 Watch an ad to double (+${fmt(reward.total)})`;
    dbl.onclick = async () => {
      dbl.disabled = true;
      if (!(await showAd('rewarded', adHooks))) { dbl.disabled = false; notify('Ad closed early, no bonus', '#ff5a4f'); return; }
      profile.bonus(reward.total);
      sfx.built();
      $('rewardTotal').innerHTML = `+${fmt(reward.total * 2)} ${coin} <span class="doubled">doubled!</span>`;
      dbl.classList.add('hidden');
    };
  }

  return { notify, closeModals, showMatchReward };
}
