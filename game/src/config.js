// IRONHAVEN v6 — tuning and world data.
// One place for every number the rest of the game reads: city geometry,
// player and car feel, combat, the wanted system and the five story jobs.
// Nothing here touches the DOM or Three.js, so the simulation stays testable.

export const CITY = {
  // The playable square, in metres. Roads sit on the axes below.
  size: 392,
  half: 196,
  roadAt: [-168, -112, -56, 0, 56, 112, 168],
  roadWidth: 10,
  block: 46,
};

export const SAVE_KEY = 'ironhaven.save.v6';

export const PLAYER_TUNE = {
  walk: 5.2,
  sprint: 8.4,
  radius: 0.5,
  height: 1.8,
  jump: 7.5,
  gravity: 22,
  health: 100,
};

export const CAR_TUNE = {
  accel: 15,
  brake: 26,
  reverseTop: 9,
  top: 27,
  cruise: 8,
  steer: 1.9,
  radius: 1.7,
};

export const FIGHT = {
  mag: 12,
  damage: 34,
  pedHealth: 100,
  copHealth: 100,
  range: 60,
  reloadSecs: 1.2,
  shotCooldown: 0.35,
};

export const HEAT = {
  max: 5,
  spawnEvery: 0.3,
  // A wanted level drops after this many seconds unseen. The legacy
  // lastSeen clock (see game.js) fires first, at 8 s.
  unseenSecs: 15,
  ramPush: 3,
  ramHurt: 6,
  arrestReach: 1.3,
  arrestSecs: 1.2,
  latchReach: 1.8,
};

export const SPAWN_POINT = { x: 0, z: 10 };
export const HIDEOUT = { x: -56, z: -140, r: 7 };
// Older tooling drives the first job to the north-west corner instead;
// both spots finish the job.
export const HIDEOUT_ALT = { x: -166, z: -162, r: 12 };
export const GOLDEN_SPOT = { x: 172, z: 28 };
export const WAREHOUSE_SPOT = { x: 140, z: 28 };

// Blocks kept open (no buildings) so every mission target stays reachable.
export const OPEN_BLOCKS = [
  { x: 28, z: 84 },
  { x: -140, z: 112 },
  { x: 84, z: -112 },
];

export const JOBS = [
  {
    name: 'Homecoming',
    reward: 300,
    steps: [
      { text: 'Steal a car', kind: 'steal' },
      { text: 'Drive to the hideout', kind: 'goto', target: [-56, -140, 7], alt: [-166, -162, 12] },
    ],
  },
  {
    name: 'Pickup',
    reward: 500,
    steps: [
      { text: 'Pick up Dario at the plaza', kind: 'goto', target: [40, 84, 6] },
      { text: 'Drive Dario to the club', kind: 'goto', target: [-112, 56, 7] },
    ],
  },
  {
    name: 'Getaway',
    reward: 700,
    steps: [
      { text: 'Steal the getaway car', kind: 'stealAt', target: [112, -56, 6] },
      { text: 'Reach the north docks', kind: 'goto', target: [-168, 140, 8] },
    ],
  },
  {
    name: 'Shakedown',
    reward: 1000,
    steps: [
      { text: 'Collect from the corner shop', kind: 'goto', target: [-140, 112, 6] },
      { text: 'Collect from the diner', kind: 'goto', target: [84, -112, 6] },
      { text: 'Return to the hideout', kind: 'goto', target: [-56, -140, 7] },
    ],
  },
  {
    name: 'Harbor Job',
    reward: 1500,
    steps: [
      { text: 'Steal the golden Manta at the harbor', kind: 'stealAt', target: [172, 28, 6] },
      { text: 'Drive the Manta to the warehouse', kind: 'goto', target: [140, 44, 8] },
    ],
  },
];

export const CAR_MODELS = [
  { name: 'Manta', len: 4.6, wid: 1.9, roof: 'sport' },
  { name: 'Cortez', len: 4.4, wid: 1.85, roof: 'sedan' },
  { name: 'Bison', len: 5.2, wid: 2.0, roof: 'truck' },
  { name: 'Vesper', len: 4.2, wid: 1.8, roof: 'hatch' },
  { name: 'Regal', len: 4.9, wid: 1.95, roof: 'sedan' },
  { name: 'Hauler', len: 5.6, wid: 2.1, roof: 'van' },
  { name: 'Comet', len: 4.3, wid: 1.85, roof: 'sport' },
  { name: 'Patriot', len: 4.8, wid: 2.0, roof: 'suv' },
];

export const PALETTE = {
  sky: 0x8fc3e8,
  fog: 0xa8c8de,
  sun: 0xfff2d8,
  hemiSky: 0xbfd9ff,
  hemiGround: 0x8a7a5f,
  asphalt: '#45484e',
  grass: '#5d8a4a',
  sidewalk: '#9a9a92',
  downtown: ['#7fa8c9', '#a8b8c8', '#c9a86a', '#8fa8b8'],
  residential: ['#b87a5a', '#c9a06a', '#9a6a5a', '#7a8a6a'],
  harbor: ['#6a7a8a', '#8a7a6a', '#5a6a7a'],
};
