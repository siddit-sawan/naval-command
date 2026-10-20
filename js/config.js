// Gameplay tuning and map layout. Distances are world units (a destroyer is ~24 long), times are seconds.

export const UNITS = {
  corvette: {
    label: 'Corvette', cost: 60, build: 5, hp: 140, speed: 16, turn: 1.1, size: 14,
    weapon: 'gun', range: 45, damage: 9, reload: 0.9, detect: 40,
  },
  destroyer: {
    label: 'Destroyer', cost: 120, build: 8, hp: 300, speed: 12, turn: 0.7, size: 24,
    weapon: 'gun', range: 60, damage: 20, reload: 1.4, detect: 75, subBonus: 2,
  },
  submarine: {
    label: 'Submarine', cost: 150, build: 10, hp: 200, speed: 9, turn: 0.6, size: 18,
    weapon: 'torpedo', range: 65, damage: 75, reload: 4, detect: 35, stealth: true,
  },
  battleship: {
    label: 'Battleship', cost: 280, build: 14, hp: 750, speed: 7, turn: 0.4, size: 34,
    weapon: 'gun', range: 95, damage: 50, reload: 3.2, detect: 45, splash: 10,
  },
};
export const UNIT_ORDER = ['corvette', 'destroyer', 'submarine', 'battleship'];

export const HARBOR = { hp: 3000, radius: 40, range: 85, damage: 25, reload: 1.6, detect: 90 };

export const ECONOMY = {
  startGold: 250,
  baseIncome: 4,
  outpostIncome: 3,
  maxQueue: 5,
  maxShips: 20,
};

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
    { name: 'Autocannon', kind: 'shell', range: 220, damage: 6, reload: 0.3, velocity: 330, spread: 2 },
    { name: 'Anti-ship missile', kind: 'missile', range: 480, damage: 65, reload: 8, speed: 75, lock: 1.2 },
  ],
  destroyer: [
    { name: '5-inch gun', kind: 'shell', range: 340, damage: 24, reload: 1.6, velocity: 300, spread: 3 },
    { name: 'Torpedo spread', kind: 'torpedo', range: 320, damage: 80, reload: 10, speed: 30, count: 3, fan: 0.1 },
    { name: 'Depth charges', kind: 'depth', range: 0, damage: 90, reload: 7, radius: 24 },
  ],
  battleship: [
    { name: '16-inch main battery', kind: 'shell', range: 560, damage: 84, reload: 6, velocity: 320, spread: 7, splash: 12 },
    { name: 'Secondary guns', kind: 'shell', range: 240, damage: 14, reload: 1.1, velocity: 290, spread: 3 },
  ],
  submarine: [
    { name: 'Heavy torpedo', kind: 'torpedo', range: 460, damage: 120, reload: 7, speed: 34, count: 1 },
    { name: 'Deck gun', kind: 'shell', range: 160, damage: 9, reload: 1.3, velocity: 250, spread: 2.5 },
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
