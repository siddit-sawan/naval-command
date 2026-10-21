import { t } from './i18n.js';

// Gameplay tuning and map layout. Distances are world units (a destroyer is ~24 long), times are seconds.

export const UNITS = {
  corvette: {
    label: t('Corvette'), cost: 60, build: 5, hp: 140, speed: 16, turn: 1.1, size: 14,
    weapon: 'gun', range: 45, damage: 9, reload: 0.9, detect: 40,
  },
  destroyer: {
    label: t('Destroyer'), cost: 120, build: 8, hp: 300, speed: 12, turn: 0.7, size: 24,
    weapon: 'gun', range: 60, damage: 20, reload: 1.4, detect: 75, subBonus: 2,
  },
  submarine: {
    label: t('Submarine'), cost: 150, build: 10, hp: 200, speed: 9, turn: 0.6, size: 18,
    weapon: 'torpedo', range: 65, damage: 75, reload: 4, detect: 35, stealth: true,
  },
  battleship: {
    label: t('Battleship'), cost: 280, build: 14, hp: 750, speed: 7, turn: 0.4, size: 34,
    weapon: 'gun', range: 95, damage: 50, reload: 3.2, detect: 45, splash: 10,
  },
};
export const UNIT_ORDER = ['corvette', 'destroyer', 'submarine', 'battleship'];

// Exclusive ships: bought once with coins in the Shop (shopPrice), then buildable in fleet battles, where they
// cost far more gold than the standard hull they are built on. They use that hull's model (`base`), enlarged by
// `scale`, and its livery. Only the player can field them.
export const EXCLUSIVES = {
  raider: {
    label: t('Raider'), exclusive: true, base: 'corvette', scale: 1.15, shopPrice: 500, blurb: t('Fast gunboat that runs rings around anything.'),
    cost: 140, build: 6, hp: 260, speed: 22, turn: 1.4, size: 16,
    weapon: 'gun', range: 55, damage: 14, reload: 0.6, detect: 50,
  },
  cruiser: {
    label: t('Cruiser'), exclusive: true, base: 'destroyer', scale: 1.3, shopPrice: 800, blurb: t('Armoured, long-ranged and hard-hitting. Also hunts subs.'),
    cost: 230, build: 11, hp: 520, speed: 12, turn: 0.6, size: 31,
    weapon: 'gun', range: 76, damage: 30, reload: 1.2, detect: 85, subBonus: 2,
  },
  phantom: {
    label: t('Phantom'), exclusive: true, base: 'submarine', scale: 1.25, shopPrice: 1200, blurb: t('Silent, quick, and its torpedoes hit like a freight train.'),
    cost: 330, build: 12, hp: 280, speed: 12, turn: 0.7, size: 22,
    weapon: 'torpedo', range: 82, damage: 120, reload: 3, detect: 45, stealth: true,
  },
  dreadnought: {
    label: t('Dreadnought'), exclusive: true, base: 'battleship', scale: 1.35, shopPrice: 2500, blurb: t('The ultimate capital ship. Also launches a scout bomber.'),
    cost: 600, build: 20, hp: 1500, speed: 6.5, turn: 0.35, size: 46,
    weapon: 'gun', range: 115, damage: 85, reload: 3.2, detect: 55, splash: 14,
  },
};
export const EXCLUSIVE_ORDER = ['raider', 'cruiser', 'phantom', 'dreadnought'];
Object.assign(UNITS, EXCLUSIVES);

export const HARBOR = { hp: 3000, radius: 40, range: 85, damage: 25, reload: 1.6, detect: 90 };

export const ECONOMY = {
  startGold: 250,
  baseIncome: 4,
  outpostIncome: 3,
  maxQueue: 5,
  maxShips: 20,
};

// Permanent upgrades bought with coins in the shop's Upgrades tab. Each level costs the next entry in `costs`;
// `per` is the bonus gained per level (see profile.upgradeEffects). They only apply to the player in real matches.
export const UPGRADES = {
  income: { name: t('Treasury'), icon: '⛃', desc: t('Every outpost and harbor pays more gold.'), per: t('+10% income'), costs: [150, 300, 500, 800, 1200] },
  gold: { name: t('War Chest'), icon: '💰', desc: t('Start every match with extra gold.'), per: t('+75 starting gold'), costs: [120, 250, 450, 700] },
  fleet: { name: t('Reinforcements'), icon: '⚓', desc: t('Extra ships sail out with your fleet at the start of a fleet battle.'), per: t('+1 ship'), costs: [200, 400, 700, 1100], ships: ['corvette', 'destroyer', 'submarine', 'battleship'] },
  yard: { name: t('Shipwrights'), icon: '🔧', desc: t('Ships finish building sooner.'), per: t('-8% build time'), costs: [150, 300, 550, 900] },
  armor: { name: t('Hull Plating'), icon: '🛡', desc: t('Every ship you field is tougher.'), per: t('+10% hull'), costs: [200, 400, 700, 1100] },
  cap: { name: t('Fleet Command'), icon: '🚩', desc: t('Raise the maximum size of your fleet.'), per: t('+2 max ships'), costs: [250, 500, 900] },
};
export const UPGRADE_ORDER = ['income', 'gold', 'fleet', 'yard', 'armor', 'cap'];

export const CAPTURE = { radius: 40, rate: 0.12 };

// Submarines stay hidden for this long after they fire.
export const REVEAL_TIME = 3;

// Enemy handicaps: income and build-time multipliers, a fleet cap, how hard its ships and harbor hit,
// its harbor's strength, and how long before the first attack wave.
// Player boosts: starting gold, income and build speed, and hull repair per second when out of combat.
export const DIFFICULTY = {
  easy: {
    income: 0.55, build: 1.7, maxShips: 8, firstWave: 240, think: 4, attackArmy: 8, accuracy: 0.65,
    enemyDamage: 0.6, enemyHarborHp: 1700,
    playerGold: 500, playerIncome: 1.45, playerBuild: 0.7, regen: 4,
  },
  normal: {
    income: 0.75, build: 1.35, maxShips: 12, firstWave: 160, think: 3, attackArmy: 6, accuracy: 0.75,
    enemyDamage: 0.85, enemyHarborHp: 2400,
    playerGold: 380, playerIncome: 1.15, playerBuild: 0.9, regen: 2,
  },
  hard: {
    income: 1.15, build: 1, maxShips: 18, firstWave: 75, think: 2, attackArmy: 5, accuracy: 0.88,
    enemyDamage: 1, enemyHarborHp: 3000,
    playerGold: 250, playerIncome: 1, playerBuild: 1, regen: 0.5,
  },
};

// Ranked War: a fleet battle whose difficulty follows the player's rank (0 = Cadet ... 9 = Fleet Admiral).
// The settings slide from the 'low' column at the lowest rank to the 'high' column at the top, far beyond Hard:
// the enemy earns more, builds faster, hits harder and attacks sooner while the player's help is stripped away.
export const RANKED_TOP = 9;
const RANKED_LOW = {
  income: 0.8, build: 1.3, maxShips: 12, firstWave: 150, think: 3, attackArmy: 6, accuracy: 0.78,
  enemyDamage: 0.9, enemyHarborHp: 2500, playerGold: 350, playerIncome: 1.1, playerBuild: 0.95, regen: 1.5,
};
const RANKED_HIGH = {
  income: 1.7, build: 0.7, maxShips: 24, firstWave: 35, think: 1.2, attackArmy: 4, accuracy: 0.97,
  enemyDamage: 1.35, enemyHarborHp: 4800, playerGold: 150, playerIncome: 0.9, playerBuild: 1.1, regen: 0,
};
const RANKED_WHOLE = new Set(['maxShips', 'attackArmy', 'enemyHarborHp', 'playerGold']);
export function rankedDifficulty(level) {
  const t = Math.min(Math.max(level, 0), RANKED_TOP) / RANKED_TOP;
  const out = {};
  for (const k of Object.keys(RANKED_LOW)) {
    const v = RANKED_LOW[k] + (RANKED_HIGH[k] - RANKED_LOW[k]) * t;
    out[k] = RANKED_WHOLE.has(k) ? Math.round(v) : Math.round(v * 100) / 100;
  }
  return out;
}
// Coin and XP multiplier for a ranked win or loss: the higher the rank, the bigger the payout.
export const rankedReward = (level) => Math.round((1.2 + 0.15 * level) * 100) / 100;

// Manual mode: the ship you command has a reinforced hull that takes only this share of incoming damage.
export const HELM_ARMOR = 0.65;

// Manual mode is a team deathmatch: both sides get the player's chosen flagship plus these escorts,
// lined up facing each other, and the last fleet afloat wins. No outposts, gold or building.
export const DEATHMATCH = {
  escorts: ['destroyer', 'corvette', 'battleship', 'submarine'],
  startZ: 300,
  spacing: 50,
  aiRange: 0.6, // AI ships open fire at this share of their main weapon's range
  aiSpread: 0.035, // extra AI dispersion per unit of range, so long shots aren't laser-accurate
  escortLeash: 350, // escorts only chase enemies this close to your flagship
  gravity: 10, // shells fly flat and fast, dropping under this gravity (world units/s²)
  // Weapons come online by holding outposts: outposts needed for weapon slot 1, 2, 3.
  unlock: [1, 2, 2],
};

// Battleships' scout bombers: launched every `cooldown` seconds, they bomb ships, dogfight enemy planes,
// spot ships hidden in fog and take anti-aircraft fire from ships they fly over.
export const AIRCRAFT = {
  cooldown: 45, life: 70, speed: 46, turn: 1.4, hp: 40, scale: 1.7,
  altitude: 34, runAltitude: 16, bombs: 2, bombDamage: 70, bombSplash: 8,
  gunRange: 70, gunDamage: 5, gunReload: 0.22, dogfightRange: 150,
  aaRange: 60, aaDps: 3, spotRange: 110, launchRange: 550,
};

/**
 * Ship weapons in manual mode, switched with 1-3. The player's shots land exactly where aimed (no
 * automatic lead), so long-range hits take skill. kind: 'shell' | 'torpedo' | 'missile' | 'depth'.
 * Shells are direct fire: velocity is the muzzle speed of a flat, gravity-affected trajectory, and range
 * is the effective (aimed) range. speed: torpedo/missile speed; spread: shell dispersion (world units
 * at 600 range); lock: seconds the crosshair must stay on a target.
 */
export const LOADOUTS = {
  corvette: [
    { name: t('Autocannon'), kind: 'shell', range: 220, damage: 6, reload: 0.3, velocity: 330, spread: 2 },
    { name: t('Anti-ship missile'), kind: 'missile', range: 480, damage: 65, reload: 8, speed: 75, lock: 1.2 },
  ],
  destroyer: [
    { name: t('5-inch gun'), kind: 'shell', range: 340, damage: 24, reload: 1.6, velocity: 300, spread: 3 },
    { name: t('Torpedo spread'), kind: 'torpedo', range: 320, damage: 80, reload: 10, speed: 30, count: 3, fan: 0.1 },
    { name: t('Depth charges'), kind: 'depth', range: 0, damage: 90, reload: 7, radius: 24 },
  ],
  battleship: [
    { name: t('16-inch main battery'), kind: 'shell', range: 560, damage: 84, reload: 6, velocity: 320, spread: 7, splash: 12 },
    { name: t('Secondary guns'), kind: 'shell', range: 240, damage: 14, reload: 1.1, velocity: 290, spread: 3 },
    { name: t('Scout bomber'), kind: 'aircraft', range: 600, damage: 70, reload: 45 },
  ],
  submarine: [
    { name: t('Heavy torpedo'), kind: 'torpedo', range: 460, damage: 120, reload: 7, speed: 34, count: 1 },
    { name: t('Deck gun'), kind: 'shell', range: 160, damage: 9, reload: 1.3, velocity: 250, spread: 2.5 },
  ],
};

// Sea fog. Ships inside a fog bank can only be seen from `bankSight` away; during a fog front
// (which rolls in every so often) nothing further than `frontSight` is visible anywhere.
export const FOG = {
  banks: 7,
  bankRadius: [70, 120],
  bankSight: 45,
  frontSight: 130,
  drift: 4,
  firstFront: [70, 100],
  frontEvery: [110, 170],
  frontLength: [35, 50],
};

export const MAP = {
  bounds: 700,
  harbors: {
    player: { x: 0, z: 585, spawn: { x: 0, z: 485 } },
    enemy: { x: 0, z: -585, spawn: { x: 0, z: -485 } },
  },
  // Mirrored through the center so neither side has an advantage.
  outposts: [
    { x: 0, z: 0 },
    { x: -430, z: 0 },
    { x: 430, z: 0 },
    { x: -230, z: 265 },
    { x: 230, z: -265 },
  ],
  islands: [
    { x: -310, z: 160, r: 34, h: 13, seed: 11, palms: 5 },
    { x: 310, z: -160, r: 34, h: 13, seed: 23, palms: 5 },
    { x: -270, z: -360, r: 36, h: 17, seed: 37, palms: 6, lighthouse: true },
    { x: 270, z: 360, r: 36, h: 17, seed: 41, palms: 6 },
    { x: -560, z: 380, r: 24, h: 10, seed: 53, palms: 3 },
    { x: 560, z: -380, r: 24, h: 10, seed: 67, palms: 3, lighthouse: true },
  ],
};

export const TEAM_COLORS = {
  player: { hull: 0x3d5a78, accent: 0x3fa2ff, css: '#3fa2ff' },
  enemy: { hull: 0x6e3b3b, accent: 0xff5a4f, css: '#ff5a4f' },
};
