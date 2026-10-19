// Gameplay tuning and map layout. Distances are world units (a destroyer is ~24 long), times are seconds.

export const UNITS = {
  corvette: {
    label: 'Corvette', cost: 60, build: 5, hp: 140, speed: 12, turn: 1.1, size: 14,
    weapon: 'gun', range: 45, damage: 9, reload: 0.9, detect: 40,
  },
  destroyer: {
    label: 'Destroyer', cost: 120, build: 8, hp: 300, speed: 9, turn: 0.7, size: 24,
    weapon: 'gun', range: 60, damage: 20, reload: 1.4, detect: 75, subBonus: 2,
  },
  submarine: {
    label: 'Submarine', cost: 150, build: 10, hp: 200, speed: 7, turn: 0.6, size: 18,
    weapon: 'torpedo', range: 65, damage: 75, reload: 4, detect: 35, stealth: true,
  },
  battleship: {
    label: 'Battleship', cost: 280, build: 14, hp: 750, speed: 5.5, turn: 0.4, size: 34,
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

export const DIFFICULTY = {
  easy: { income: 0.75, think: 3.5, attackArmy: 7, accuracy: 0.75 },
  normal: { income: 1, think: 2.5, attackArmy: 5, accuracy: 0.85 },
  hard: { income: 1.35, think: 1.5, attackArmy: 4, accuracy: 0.95 },
};

export const MAP = {
  bounds: 470,
  harbors: {
    player: { x: 0, z: 390, spawn: { x: 0, z: 320 } },
    enemy: { x: 0, z: -390, spawn: { x: 0, z: -320 } },
  },
  // Mirrored through the center so neither side has an advantage.
  outposts: [
    { x: 0, z: 0 },
    { x: -280, z: 0 },
    { x: 280, z: 0 },
    { x: -150, z: 170 },
    { x: 150, z: -170 },
  ],
  islands: [
    { x: -200, z: 105, r: 28, h: 12, seed: 11, palms: 4 },
    { x: 200, z: -105, r: 28, h: 12, seed: 23, palms: 4 },
    { x: -175, z: -235, r: 30, h: 16, seed: 37, palms: 5, lighthouse: true },
    { x: 175, z: 235, r: 30, h: 16, seed: 41, palms: 5 },
  ],
};

export const TEAM_COLORS = {
  player: { hull: 0x3d5a78, accent: 0x3fa2ff, css: '#3fa2ff' },
  enemy: { hull: 0x6e3b3b, accent: 0xff5a4f, css: '#ff5a4f' },
};
