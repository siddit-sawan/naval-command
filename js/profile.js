import { UPGRADES, UNITS, rankedReward } from './config.js';

// The player's saved progress: coins, rank, owned liveries, stats and the daily reward streak.
// Stored in localStorage; if storage is blocked the profile simply lasts for this session.

const KEY = 'navalProfile';

export const RANKS = [
  { name: 'Cadet', xp: 0 },
  { name: 'Ensign', xp: 250 },
  { name: 'Lieutenant', xp: 700 },
  { name: 'Lt. Commander', xp: 1500 },
  { name: 'Commander', xp: 3000 },
  { name: 'Captain', xp: 5500 },
  { name: 'Commodore', xp: 9000 },
  { name: 'Rear Admiral', xp: 14000 },
  { name: 'Admiral', xp: 21000 },
  { name: 'Fleet Admiral', xp: 30000 },
];

// Coins per match, by difficulty.
const DIFF_MULT = { easy: 0.75, normal: 1, hard: 1.5 };
const DAILY_BASE = 60;
const DAILY_STEP = 30;
const DAILY_MAX_STREAK = 7;

const fresh = () => ({
  coins: 100, xp: 0, livery: 'dazzle', owned: ['dazzle'], adProgress: {}, upgrades: {}, ships: [],
  stats: { games: 0, wins: 0, sunk: 0, lost: 0, outposts: 0, bestTime: 0, coinsEarned: 0, rankedGames: 0, rankedWins: 0 },
  daily: { last: '', streak: 0 },
  tutorials: {}, // modes whose tutorial has been finished or skipped
});

let data = fresh();
try {
  const saved = JSON.parse(localStorage.getItem(KEY));
  if (saved) data = { ...fresh(), ...saved, stats: { ...fresh().stats, ...saved.stats }, daily: { ...fresh().daily, ...saved.daily } };
} catch { /* storage blocked or corrupt: start fresh */ }

const listeners = new Set();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked */ }
  for (const fn of listeners) fn(data);
}

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

export const profile = {
  get data() { return data; },
  onChange(fn) { listeners.add(fn); },

  addCoins(n) {
    data.coins += Math.round(n);
    save();
  },
  spend(n) {
    if (data.coins < n) return false;
    data.coins -= n;
    save();
    return true;
  },

  rank() {
    let i = 0;
    while (i + 1 < RANKS.length && data.xp >= RANKS[i + 1].xp) i++;
    const cur = RANKS[i], next = RANKS[i + 1];
    return { index: i, name: cur.name, next, progress: next ? (data.xp - cur.xp) / (next.xp - cur.xp) : 1 };
  },

  // ---------- Liveries ----------
  owns(id) { return data.owned.includes(id); },
  unlock(id) {
    if (!data.owned.includes(id)) data.owned.push(id);
    save();
  },
  equip(id) {
    if (!this.owns(id)) return;
    data.livery = id;
    save();
  },
  // Ad-unlocked liveries count watched ads.
  adWatched(id) {
    data.adProgress[id] = (data.adProgress[id] || 0) + 1;
    save();
    return data.adProgress[id];
  },

  // ---------- Exclusive ships ----------
  ownsShip(id) { return data.ships.includes(id); },
  buyShip(id) {
    if (this.ownsShip(id) || !this.spend(UNITS[id].shopPrice)) return false;
    data.ships = [...data.ships, id];
    save();
    return true;
  },

  // ---------- Upgrades ----------
  upgradeLevel(id) { return data.upgrades[id] || 0; },
  // Price of the next level, or null when maxed out.
  upgradeCost(id) { return UPGRADES[id].costs[this.upgradeLevel(id)] ?? null; },
  buyUpgrade(id) {
    const cost = this.upgradeCost(id);
    if (cost === null || !this.spend(cost)) return false;
    data.upgrades = { ...data.upgrades, [id]: this.upgradeLevel(id) + 1 };
    save();
    return true;
  },
  // What the owned upgrade levels add up to, in the form the game consumes.
  upgradeEffects() {
    const lv = (id) => this.upgradeLevel(id);
    return {
      income: 1 + 0.1 * lv('income'),
      gold: 75 * lv('gold'),
      ships: UPGRADES.fleet.ships.slice(0, lv('fleet')),
      build: 1 - 0.08 * lv('yard'),
      hp: 1 + 0.1 * lv('armor'),
      cap: 2 * lv('cap'),
      exclusive: [...data.ships],
    };
  },

  // ---------- Tutorials ----------
  tutorialSeen(mode) { return !!data.tutorials[mode]; },
  markTutorial(mode, seen = true) {
    data.tutorials = { ...data.tutorials, [mode]: seen };
    save();
  },

  // ---------- Daily reward ----------
  dailyAvailable() { return data.daily.last !== today(); },
  // What claiming today would give, and the streak it would make.
  dailyPreview() {
    const streak = data.daily.last === yesterday() ? Math.min(data.daily.streak + 1, DAILY_MAX_STREAK) : 1;
    return { streak, coins: DAILY_BASE + DAILY_STEP * (streak - 1) };
  },
  claimDaily() {
    if (!this.dailyAvailable()) return null;
    const r = this.dailyPreview();
    data.daily = { last: today(), streak: r.streak };
    data.coins += r.coins;
    save();
    return r;
  },

  // ---------- Matches ----------
  /**
   * Record a finished match and pay out. Returns the itemised reward so the end screen can show it.
   * result: { won, difficulty, sunk, lost, outposts, seconds }
   */
  finishMatch(result) {
    const ranked = result.difficulty === 'ranked';
    const m = ranked ? rankedReward(result.rank) : DIFF_MULT[result.difficulty] || 1;
    const lines = [
      ['Service pay', 25],
      ['Enemy ships sunk', result.sunk * 8],
      ['Outposts held', result.outposts * 12],
    ];
    if (result.won) lines.push(['Victory', 120]);
    if (ranked) lines.push([`Ranked War, enemy level ${result.rank} ×${m}`, null]);
    else if (m !== 1) lines.push([`${result.difficulty[0].toUpperCase()}${result.difficulty.slice(1)} difficulty ×${m}`, null]);
    const total = Math.round(lines.reduce((s, [, v]) => s + (v || 0), 0) * m);
    const s = data.stats;
    s.games++;
    if (ranked) { s.rankedGames++; if (result.won) s.rankedWins++; }
    if (result.won) {
      s.wins++;
      if (!s.bestTime || result.seconds < s.bestTime) s.bestTime = Math.round(result.seconds);
    }
    s.sunk += result.sunk;
    s.lost += result.lost;
    s.outposts += result.outposts;
    s.coinsEarned += total;
    const before = this.rank().index;
    data.coins += total;
    data.xp += total;
    save();
    return { lines, total, rankUp: this.rank().index > before ? this.rank().name : null };
  },
  // A watched "double it" ad pays the match reward again (no extra XP, so ranks stay earned in battle).
  bonus(n) {
    data.coins += n;
    data.stats.coinsEarned += n;
    save();
  },
};
