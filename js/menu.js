import { profile, RANKS } from './profile.js';
import { LIVERIES, STORE_ORDER, drawPreview } from './livery.js';
import { showAd } from './platform.js';
import { sfx } from './audio.js';

// Everything around the battles: the profile bar, Livery Store, daily reward, free-coin ads,
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
  $('storeBtn').addEventListener('click', () => { renderStore(); openModal('storeModal'); });
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
    if (!$('storeModal').classList.contains('hidden')) renderStore();
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
