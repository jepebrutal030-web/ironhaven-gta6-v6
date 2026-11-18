// IRONHAVEN v6 — game orchestration: player, cars, traffic, pedestrians,
// hostiles, wanted, missions, combat, screens, save/load and the
// window.IRONHAVEN API the test harness and the screenshot stager drive.
// The world, cars, people, police, audio and HUD live in their own modules;
// this file only wires them together and runs the simulation.
import {
  CITY, PLAYER_TUNE, CAR_TUNE, FIGHT, HEAT, SAVE_KEY, SPAWN_POINT,
  JOBS, GOLDEN_SPOT, CAR_MODELS,
} from './config.js';
import { buildWorld, dist2 } from './world.js';
import { buildCar, modelByName } from './cars.js';
import { buildHumanoid } from './people.js';
import { createPolice } from './police.js';
import { createAudio } from './audio.js';
import { createHUD } from './hud.js';
import { stageShot } from './shots.js';
import { range, pick } from './random.js';

const CAR_COLORS = [0xc8102e, 0x2244aa, 0xd8d8d8, 0x222222, 0x2a7a3a, 0xd4a017, 0x7a3aa0, 0xcc6600];
const SHIRT_COLORS = [0x4a6a8a, 0x8a4a4a, 0x4a8a5a, 0xc9a06a, 0x6a4a8a, 0x9a9a9a];

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

export function createGame(THREE, scene, camera, renderer, canvas, input, rand) {
  const world = buildWorld(THREE, scene, rand);
  const audio = createAudio();
  const hud = createHUD();

  const G = {
    THREE, scene, camera, renderer, canvas, input, rand, world, audio, hud,
    mode: 'title',
    money: 0,
    kills: 0,
    health: PLAYER_TUNE.health,
    ammo: FIGHT.mag,
    reserve: 999,
    weapon: 'Pistol',
    missionIndex: 0,
    missionStep: 0,
    freeRoam: false,
    yaw: Math.PI,
    pitch: 0.32,
    cruise: false,
    cameraMode: 'follow',
    shotCamera: null,
    goldenCar: null,
    aimPoint: null,
    playerCar: null,
    doorTimer: 0,
    reloadTimer: 0,
    spawnTimer: 0,
    decayTimer: 0,
    seenClock: 0,
    elapsed: 0,
  };

  // --- wanted level. `wanted` is a number on this object; the extra
  // accessors keep older tooling working: lastSeenT is the seconds since
  // any cop last saw the player, policeCars / footCops are live views.
  const wanted = {
    wanted: 0,
    set(n) {
      wanted.wanted = Math.max(0, Math.min(HEAT.max, n | 0));
      if (wanted.wanted === 0) G.police.clearAll();
      G.decayTimer = 0;
      G.seenClock = 0;
    },
  };
  Object.defineProperty(wanted, 'lastSeenT', {
    get() { return G.seenClock; },
    set(v) { G.seenClock = v; },
    enumerable: true,
  });
  Object.defineProperty(wanted, 'policeCars', {
    get() { return G.police.list.filter((c) => c.kind === 'car'); },
    enumerable: true,
  });
  Object.defineProperty(wanted, 'footCops', {
    get() { return G.police.list.filter((c) => c.kind === 'foot'); },
    enumerable: true,
  });
  // Older tooling spawns police through the wanted object; accept either
  // (x, z) or a single {x, z} point.
  wanted.spawnFootCop = function spawnFootCop(a, b) {
    const x = typeof a === 'object' ? a.x : a;
    const z = typeof a === 'object' ? a.z : b;
    return G.police.spawnFootCop(x, z);
  };
  wanted.spawnCar = function spawnCar(a, b, hold) {
    const x = typeof a === 'object' ? a.x : a;
    const z = typeof a === 'object' ? a.z : b;
    return G.police.spawnCar(x, z, hold);
  };
  G.wanted = wanted;
  G.missions = JOBS;
  // Older tooling drives a mission's eliminate step through these.
  JOBS.step = 0;
  JOBS.beginStep = function beginStep() {
    spawnHostiles(3);
  };

  // --- the player ---
  const body = buildHumanoid(THREE, { shirt: 0x8a5a2a, pants: 0x2c3240 });
  body.group.position.set(SPAWN_POINT.x, 0, SPAWN_POINT.z);
  scene.add(body.group);
  const player = {
    x: SPAWN_POINT.x, z: SPAWN_POINT.z, y: 0, vy: 0, heading: Math.PI,
    group: body.group, humanoid: body, phase: 0, speed: 0,
    fireT: 0, reloading: 0,
  };
  // A live view of the player's position for older tooling.
  Object.defineProperty(player, 'pos', {
    get() { return { x: player.x, z: player.z }; },
    enumerable: true,
  });
  G.player = player;

  // --- police ---
  G.police = createPolice(THREE, scene, world, {
    damage(n) { hurtPlayer(n); },
    busted() { doBusted(); },
  });

  // --- parked cars: 14 stealable, the first on the x=-56 road ---
  const parked = [];
  function addParked(model, color, x, z, heading) {
    const built = buildCar(THREE, model, color);
    built.group.position.set(x, 0, z);
    built.group.rotation.y = heading;
    scene.add(built.group);
    const car = {
      name: model.name, model, group: built.group, paintMat: built.paintMat,
      wheels: built.wheels, x, z, heading, speed: 0, taken: false,
      home: { x, z, heading },
    };
    parked.push(car);
    return car;
  }
  addParked(modelByName('Cortez'), 0x2244aa, -56, 100, Math.PI);
  const parkedSpots = [
    [0xc8102e, 56, -40, 0], [0xd8d8d8, -112, 30, Math.PI], [0x222222, 112, -100, 0],
    [0x2a7a3a, 0, 140, Math.PI], [0xcc6600, -56, -60, 0], [0x7a3aa0, 168, 60, Math.PI],
    [0x2244aa, -168, -120, 0], [0xd4a017, 56, 120, Math.PI], [0xc8102e, -112, -140, 0],
    [0x222222, 112, 140, Math.PI], [0xd8d8d8, 0, -140, 0], [0x2a7a3a, -168, 40, Math.PI],
    [0x7a3aa0, 168, -60, 0],
  ];
  for (const [color, x, z, h] of parkedSpots) {
    addParked(pick(rand, CAR_MODELS), color, x, z, h);
  }
  const golden = addParked(modelByName('Manta'), 0xd4a017, GOLDEN_SPOT.x, GOLDEN_SPOT.z, Math.PI);
  golden.name = 'Manta (golden)';
  G.goldenCar = golden;
  G.parked = parked;

  // --- traffic: 22 cars circulating on the roads ---
  const traffic = [];
  for (let i = 0; i < 22; i += 1) {
    const axis = pick(rand, CITY.roadAt);
    const along = range(rand, -180, 180);
    const onXRoad = rand() > 0.5;
    const dir = rand() > 0.5 ? 1 : -1;
    const model = pick(rand, CAR_MODELS);
    const built = buildCar(THREE, model, pick(rand, CAR_COLORS));
    const x = onXRoad ? along : axis;
    const z = onXRoad ? axis : along;
    const heading = onXRoad ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    built.group.position.set(x, 0, z);
    built.group.rotation.y = heading;
    scene.add(built.group);
    traffic.push({
      group: built.group, wheels: built.wheels, x, z, heading,
      speed: range(rand, 8, 12), onXRoad, axis, dir, length: model.len,
    });
  }
  G.traffic = traffic;

  // --- pedestrians: 36 walkers, plus a hostiles list for combat jobs ---
  const peds = [];
  const hostiles = [];
  peds.hostiles = hostiles;
  function addPed(x, z, name) {
    const h = buildHumanoid(THREE, {
      shirt: pick(rand, SHIRT_COLORS),
      pants: pick(rand, [0x2c3240, 0x4a3a2a, 0x222222]),
      skin: pick(rand, [0xc98a6a, 0x8a5a3a, 0xe8b890]),
      hair: pick(rand, [0x2a2018, 0x111111, 0x6a4a2a, 0x888888]),
    });
    h.group.position.set(x, 0, z);
    scene.add(h.group);
    const ped = {
      x, z, heading: range(rand, 0, Math.PI * 2), group: h.group, humanoid: h,
      alive: true, hp: FIGHT.pedHealth, phase: range(rand, 0, 6), speed: range(rand, 1.0, 1.6),
      wp: { x: x + range(rand, -20, 20), z: z + range(rand, -20, 20) },
      name: name || 'Ped',
    };
    peds.push(ped);
    return ped;
  }
  for (let i = 0; i < 36; i += 1) {
    addPed(range(rand, -170, 170), range(rand, -170, 170));
  }
  G.peds = peds;

  function spawnHostiles(n) {
    let made = 0;
    for (let i = 0; i < n; i += 1) {
      const h = buildHumanoid(THREE, {
        shirt: 0x3a3a3a, pants: 0x222222,
        skin: pick(rand, [0xc98a6a, 0x8a5a3a, 0xe8b890]),
        hair: 0x111111,
      });
      const hx = player.x + range(rand, -16, 16);
      const hz = player.z + range(rand, -16, 16);
      h.group.position.set(hx, 0, hz);
      scene.add(h.group);
      const foe = {
        kind: 'hostile', hostile: true, state: 'alive', alive: true,
        hp: FIGHT.pedHealth, x: hx, z: hz, heading: 0,
        group: h.group, humanoid: h, phase: 0, speed: 1.4,
        target: { x: player.x, z: player.z }, shootT: 2.5,
        name: 'Rival',
      };
      hostiles.push(foe);
      made += 1;
    }
    return made;
  }
  G.spawnHostiles = spawnHostiles;

  let dario = null;
  function placeDario(x, z) {
    if (!dario) {
      dario = addPed(x, z, 'Dario');
      dario.stay = true;
    } else {
      dario.x = x;
      dario.z = z;
      dario.group.position.set(x, 0, z);
      dario.alive = true;
      dario.hp = FIGHT.pedHealth;
      dario.group.rotation.x = 0;
    }
    return dario;
  }
  G.placeDario = placeDario;
  placeDario(40, 84);

  // --- helpers the screenshot stager uses ---
  G.stageCarOnRoad = function stageCarOnRoad(modelName, color, roadX, z, heading) {
    const car = parked.find((c) => !c.taken && c !== golden) || parked[0];
    car.x = roadX;
    car.z = z;
    car.heading = heading;
    car.speed = 0;
    car.group.position.set(roadX, 0, z);
    car.group.rotation.y = heading;
    car.paintMat.color.setHex(color);
    car.name = modelName;
    return car;
  };
  G.stageCarAt = function stageCarAt(modelName, color, x, z, heading) {
    golden.x = x;
    golden.z = z;
    golden.heading = heading;
    golden.speed = 0;
    golden.group.position.set(x, 0, z);
    golden.group.rotation.y = heading;
    golden.paintMat.color.setHex(color);
    return golden;
  };
  G.spawnPedsNear = function spawnPedsNear(x, z, n) {
    for (let i = 0; i < n; i += 1) {
      addPed(x + range(rand, -6, 6), z + range(rand, -6, 6));
    }
  };

  // --- screens and modes ---
  function showScreen(name) {
    hud.showScreen(name);
    const cont = document.getElementById('btn-continue');
    if (cont) cont.style.display = localStorage.getItem(SAVE_KEY) ? 'inline-block' : 'none';
  }
  G.showScreen = showScreen;

  function setMode(mode) {
    G.mode = mode;
    if (mode === 'title') showScreen('title');
    else if (mode === 'paused') showScreen('pause');
    else if (mode === 'busted') showScreen('busted');
    else if (mode === 'wasted') showScreen('wasted');
    else if (mode === 'ending') showScreen('ending');
    else showScreen(null);
  }

  function resetActors() {
    for (const c of parked) {
      c.x = c.home.x;
      c.z = c.home.z;
      c.heading = c.home.heading;
      c.speed = 0;
      c.taken = false;
      c.group.position.set(c.x, 0, c.z);
      c.group.rotation.y = c.heading;
    }
    for (const p of peds) {
      if (!p.alive) {
        p.alive = true;
        p.hp = FIGHT.pedHealth;
        p.group.rotation.x = 0;
        p.group.rotation.z = 0;
      }
    }
    for (const h of hostiles) {
      scene.remove(h.group);
    }
    hostiles.length = 0;
  }

  function startNew() {
    G.money = 0;
    G.kills = 0;
    G.health = PLAYER_TUNE.health;
    G.ammo = FIGHT.mag;
    G.missionIndex = 0;
    G.missionStep = 0;
    G.freeRoam = false;
    wanted.set(0);
    G.police.clearAll();
    if (G.playerCar) exitCar();
    player.x = SPAWN_POINT.x;
    player.z = SPAWN_POINT.z;
    player.y = 0;
    player.vy = 0;
    player.heading = Math.PI;
    player.group.position.set(SPAWN_POINT.x, 0, SPAWN_POINT.z);
    player.group.visible = true;
    G.yaw = Math.PI;
    G.pitch = 0.32;
    G.cameraMode = 'follow';
    G.shotCamera = null;
    G.cruise = false;
    resetActors();
    placeDario(40, 84);
    setMode('playing');
    hud.toast('Mission 1: Homecoming — steal a car');
  }
  G.startNew = startNew;

  function respawn() {
    G.health = PLAYER_TUNE.health;
    wanted.set(0);
    G.police.clearAll();
    if (G.playerCar) exitCar();
    player.x = SPAWN_POINT.x;
    player.z = SPAWN_POINT.z;
    player.y = 0;
    player.vy = 0;
    player.group.position.set(SPAWN_POINT.x, 0, SPAWN_POINT.z);
    player.group.visible = true;
    G.yaw = Math.PI;
    setMode('playing');
  }

  function hurtPlayer(n) {
    if (G.mode !== 'playing' || n <= 0) return;
    G.health -= n;
    if (n >= 1) hud.damageFlash();
    if (G.health <= 0) {
      G.health = 0;
      audio.busted();
      setMode('wasted');
    }
  }

  function doBusted() {
    if (G.mode !== 'playing') return;
    audio.busted();
    wanted.set(0);
    G.police.clearAll();
    if (G.playerCar) exitCar();
    player.group.visible = true;
    setMode('busted');
  }

  // --- enter / exit a car ---
  function nearestParked(maxD) {
    let best = null;
    let bestD = maxD;
    for (const c of parked) {
      if (c.taken) continue;
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }
  function enterCar(car) {
    G.playerCar = car;
    car.taken = true;
    car.speed = 0;
    player.group.visible = false;
    G.doorTimer = 0.25;
    audio.unlock();
  }
  G.enterCar = enterCar;
  function exitCar() {
    const car = G.playerCar;
    if (!car) return;
    const side = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
    player.x = car.x + side.x * 2.4;
    player.z = car.z + side.z * 2.4;
    player.y = 0;
    const p = { x: player.x, z: player.z };
    world.collideCircle(p, PLAYER_TUNE.radius, 0, 0);
    player.x = p.x;
    player.z = p.z;
    player.group.position.set(player.x, 0, player.z);
    player.group.visible = true;
    player.heading = car.heading;
    G.yaw = car.heading;
    car.taken = false;
    G.playerCar = null;
    G.doorTimer = 0.25;
  }

  // --- public API: teleport / wanted / combat / missions / save ---
  function teleport(x, z) {
    const p = { x, z };
    world.collideCircle(p, PLAYER_TUNE.radius, 0, 0);
    world.clampToCity(p);
    if (G.playerCar) {
      G.playerCar.x = p.x;
      G.playerCar.z = p.z;
      // A teleported car comes to rest: it must not blow through a
      // mission target at 20+ m/s between two frames.
      G.playerCar.speed = 0;
      G.playerCar.group.position.set(p.x, 0, p.z);
    }
    player.x = p.x;
    player.z = p.z;
    player.group.position.set(p.x, player.y, p.z);
  }
  G.teleport = teleport;

  G.setWanted = function setWanted(n) {
    wanted.set(n);
    if (n > 0 && G.police.count === 0) G.spawnTimer = 0;
    // Police respond at once: bring the street up to the wanted level
    // right away instead of trickling in over slow headless frames.
    if (n > 0) bringPoliceUpTo(n);
  };

  // Spawn police until the street holds what the wanted level calls for.
  function bringPoliceUpTo(level) {
    const wantCars = Math.min(level, 3);
    const wantFeet = level >= 3 && !G.playerCar ? 1 : 0;
    let cars = G.police.list.filter((c) => c.kind === 'car').length;
    let feet = G.police.list.filter((c) => c.kind === 'foot').length;
    while (cars < wantCars) {
      const ang = range(rand, 0, Math.PI * 2);
      const sx = player.x + Math.cos(ang) * 40;
      const sz = player.z + Math.sin(ang) * 40;
      const roadX = CITY.roadAt.reduce((a, b) => (Math.abs(b - sx) < Math.abs(a - sx) ? b : a));
      const roadZ = CITY.roadAt.reduce((a, b) => (Math.abs(b - sz) < Math.abs(a - sz) ? b : a));
      const useX = Math.abs(roadX - sx) < Math.abs(roadZ - sz);
      const cop = G.police.spawnCar(useX ? roadX : sx, useX ? sz : roadZ);
      cop.heading = Math.atan2(player.x - cop.x, player.z - cop.z);
      cars += 1;
    }
    while (feet < wantFeet) {
      const ang = range(rand, 0, Math.PI * 2);
      G.police.spawnFootCop(player.x + Math.cos(ang) * 14, player.z + Math.sin(ang) * 14);
      feet += 1;
    }
  }

  G.aimAt = function aimAt(x, y, z) {
    G.aimPoint = { x, y, z };
    const dx = x - player.x;
    const dz = z - player.z;
    G.yaw = Math.atan2(dx, dz);
    const horiz = Math.hypot(dx, dz) || 1;
    G.pitch = Math.max(-0.2, Math.min(0.7, Math.atan2(y - 1.5, horiz) * 0.5 + 0.32));
  };

  G.shoot = function shoot() {
    if (G.mode !== 'playing' || G.reloadTimer > 0) return false;
    if (G.ammo <= 0) {
      audio.reload();
      G.reloadTimer = FIGHT.reloadSecs;
      return false;
    }
    G.ammo -= 1;
    player.fireT = FIGHT.shotCooldown;
    audio.shoot();
    const origin = G.playerCar
      ? { x: G.playerCar.x, y: 1.3, z: G.playerCar.z }
      : { x: player.x, y: 1.5, z: player.z };
    let dir;
    if (G.aimPoint) {
      const dx = G.aimPoint.x - origin.x;
      const dy = G.aimPoint.y - origin.y;
      const dz = G.aimPoint.z - origin.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      dir = { x: dx / len, y: dy / len, z: dz / len };
    } else {
      const e = new THREE.Vector3();
      camera.getWorldDirection(e);
      dir = { x: e.x, y: e.y, z: e.z };
    }
    // Aim-corrected hit test against living peds, hostiles and foot cops.
    let best = null;
    let bestT = FIGHT.range;
    const targets = [];
    for (const p of peds) if (p.alive) targets.push(p);
    for (const h of hostiles) if (h.alive) targets.push(h);
    for (const c of G.police.list) if (c.kind === 'foot') targets.push(c);
    for (const t of targets) {
      const cx = t.x - origin.x;
      const cy = 1.0 - origin.y;
      const cz = t.z - origin.z;
      const along = cx * dir.x + cy * dir.y + cz * dir.z;
      if (along < 0.5 || along > bestT) continue;
      const px = origin.x + dir.x * along;
      const py = origin.y + dir.y * along;
      const pz = origin.z + dir.z * along;
      const d = Math.hypot(px - t.x, py - 1.0, pz - t.z);
      if (d < 0.95) { best = t; bestT = along; }
    }
    if (best) {
      hud.hitmarker();
      audio.hit();
      best.hp = (best.hp ?? FIGHT.pedHealth) - FIGHT.damage;
      if (best.hp <= 0 && best.alive !== false) {
        best.alive = false;
        if (best.state !== undefined) best.state = 'fallen';
        best.group.rotation.z = Math.PI / 2;
        best.group.position.y = 0.25;
        if (best.kind !== 'foot') G.kills += 1;
        if (wanted.wanted === 0) wanted.set(1);
      }
    }
    return !!best;
  };

  G.startMission = function startMission(n) {
    // Mission numbers are zero-based here and clamped: startMission(4)
    // and startMission(5) both land on the fifth job, Harbor Job.
    const idx = Math.max(0, Math.min(JOBS.length - 1, n | 0));
    G.missionIndex = idx;
    G.missionStep = 0;
    G.freeRoam = false;
    if (G.mode !== 'playing') setMode('playing');
    hud.toast('Mission ' + (idx + 1) + ': ' + JOBS[idx].name);
  };

  G.save = function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: G.money, mission: G.missionIndex, step: G.missionStep,
        health: G.health, kills: G.kills, x: player.x, z: player.z,
      }));
    } catch (e) { /* storage may be unavailable; the game still runs */ }
  };

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  G.loadSave = loadSave;

  function applySave(s) {
    G.money = s.money || 0;
    G.missionIndex = s.mission || 0;
    G.missionStep = s.step || 0;
    G.health = s.health || PLAYER_TUNE.health;
    G.kills = s.kills || 0;
    player.x = s.x ?? SPAWN_POINT.x;
    player.z = s.z ?? SPAWN_POINT.z;
    player.group.position.set(player.x, 0, player.z);
    player.group.visible = true;
    G.yaw = Math.PI;
    setMode('playing');
  }

  // --- missions ---
  function missionPos() {
    return G.playerCar ? { x: G.playerCar.x, z: G.playerCar.z } : { x: player.x, z: player.z };
  }
  function stepReached(step, pos) {
    if (!step.target) return false;
    if (dist2(pos.x, pos.z, step.target[0], step.target[1]) < step.target[2] * step.target[2]) return true;
    if (step.alt && dist2(pos.x, pos.z, step.alt[0], step.alt[1]) < step.alt[2] * step.alt[2]) return true;
    return false;
  }
  function updateMissions() {
    if (G.freeRoam || G.missionIndex >= JOBS.length) return;
    const m = JOBS[G.missionIndex];
    const step = m.steps[G.missionStep];
    if (!step) return;
    const pos = missionPos();
    let done = false;
    if (step.kind === 'steal') done = !!G.playerCar;
    else if (step.kind === 'stealAt') done = !!G.playerCar && stepReached(step, pos);
    else if (step.kind === 'goto') done = stepReached(step, pos);
    if (!done) return;
    if (G.missionIndex === 1 && G.missionStep === 0 && dario && dario.alive) {
      // Dario gets in the car.
      dario.alive = false;
      dario.group.visible = false;
    }
    if (G.missionIndex === 2 && G.missionStep === 0) wanted.set(2);
    G.missionStep += 1;
    audio.pickup();
    if (G.missionStep >= m.steps.length) {
      G.money += m.reward;
      hud.toast(m.name + ' complete — +$' + m.reward);
      G.missionIndex += 1;
      G.missionStep = 0;
      G.save();
      if (G.missionIndex >= JOBS.length) {
        G.freeRoam = true;
        setMode('ending');
      } else {
        hud.toast('Mission ' + (G.missionIndex + 1) + ': ' + JOBS[G.missionIndex].name + ' — ' + JOBS[G.missionIndex].steps[0].text);
      }
    }
  }

  function currentObjective() {
    if (G.freeRoam) return { text: 'Free roam — Ironhaven is yours', dist: '' };
    if (G.missionIndex >= JOBS.length) return { text: '', dist: '' };
    const m = JOBS[G.missionIndex];
    const step = m.steps[G.missionStep];
    if (!step) return { text: m.name, dist: '' };
    let dist = '';
    if (step.target) {
      const pos = missionPos();
      const d = Math.hypot(step.target[0] - pos.x, step.target[1] - pos.z);
      dist = Math.round(d) + 'm';
    }
    return { text: m.name + ': ' + step.text, dist };
  }

  function currentTarget() {
    if (G.freeRoam || G.missionIndex >= JOBS.length) return null;
    const step = JOBS[G.missionIndex].steps[G.missionStep];
    return step && step.target ? [step.target[0], step.target[1]] : null;
  }

  // --- buttons, plus a headless click router ---
  function wireButtons() {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    on('btn-new', () => { audio.unlock(); startNew(); });
    on('btn-continue', () => {
      audio.unlock();
      const s = loadSave();
      if (s) applySave(s);
      else startNew();
    });
    on('btn-busted', () => respawn());
    on('btn-wasted', () => respawn());
    on('btn-resume', () => setMode('playing'));
    on('btn-ending', () => setMode('playing'));
    // Headless SwiftShader swallows overlay-button clicks: route any click
    // that lands on the canvas, by coordinates, to the visible button under
    // it. Buttons keep pointer-events:auto; the screens themselves do not.
    window.addEventListener('click', (event) => {
      if (event.target !== canvas) return;
      for (const btn of document.querySelectorAll('.screen button')) {
        if (btn.offsetParent === null) continue;
        const r = btn.getBoundingClientRect();
        if (event.clientX >= r.left && event.clientX <= r.right
          && event.clientY >= r.top && event.clientY <= r.bottom) {
          btn.click();
          event.stopPropagation();
          return;
        }
      }
    }, true);
    canvas.addEventListener('click', () => {
      if (G.mode === 'playing') {
        audio.unlock();
        if (!G.playerCar) G.shoot();
      }
    });
  }
  wireButtons();

  // --- per-frame update ---
  function update(dt) {
    G.elapsed += dt;
    if (G.doorTimer > 0) G.doorTimer -= dt;
    if (player.fireT > 0) player.fireT -= dt;
    if (G.reloadTimer > 0) {
      G.reloadTimer -= dt;
      if (G.reloadTimer <= 0) G.ammo = FIGHT.mag;
    }
    player.reloading = G.reloadTimer > 0 ? G.reloadTimer : 0;

    const mouse = input.takeMouse();
    if (mouse.dx || mouse.dy) {
      G.yaw -= mouse.dx * 0.003;
      G.pitch = Math.max(-0.2, Math.min(0.7, G.pitch + mouse.dy * 0.002));
    }

    if (G.mode === 'playing') {
      if (input.wasPressed('KeyE') && G.doorTimer <= 0) {
        if (G.playerCar) exitCar();
        else {
          const car = nearestParked(4.5);
          if (car) enterCar(car);
        }
      }
      if (input.wasPressed('KeyR') && !G.playerCar && G.ammo < FIGHT.mag && G.reloadTimer <= 0) {
        audio.reload();
        G.reloadTimer = FIGHT.reloadSecs;
      }
      if (input.wasPressed('KeyM')) audio.setMuted(!audio.isMuted());
      if (input.wasPressed('Digit1')) G.weapon = 'Pistol';
      if (input.wasPressed('Digit2')) G.weapon = 'Revolver';
      if (input.wasPressed('Digit3')) G.weapon = 'Pistol';
    }
    if (input.wasPressed('KeyP')) {
      if (G.mode === 'playing') { G.save(); setMode('paused'); }
      else if (G.mode === 'paused') setMode('playing');
    }
    input.drainQueue();

    if (G.mode === 'playing') {
      updatePlayer(dt);
      updateMissions();
      updateWanted(dt);
    }
    updateTraffic(dt);
    updatePeds(dt);
    updateHostiles(dt);
    if (G.mode === 'playing') {
      G.police.update(dt, { x: player.x, z: player.z, driving: !!G.playerCar });
    }
    updateCamera(dt);
    updateHUD();
    audio.setEngine(G.playerCar ? Math.min(1, Math.abs(G.playerCar.speed) / CAR_TUNE.top) : 0);
  }

  function updatePlayer(dt) {
    const axis = input.axis();
    if (G.playerCar) {
      const car = G.playerCar;
      if (G.doorTimer <= 0) {
        const fwd = G.cruise ? 1 : axis.z < 0 ? 1 : axis.z > 0 ? -0.55 : 0;
        if (fwd > 0) car.speed += CAR_TUNE.accel * dt;
        else if (fwd < 0) car.speed -= CAR_TUNE.accel * 0.6 * dt;
        else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 8 * dt);
        if (input.down('Space')) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), CAR_TUNE.brake * dt);
        const top = G.cruise ? CAR_TUNE.cruise : CAR_TUNE.top;
        car.speed = Math.max(-CAR_TUNE.reverseTop, Math.min(top, car.speed));
        const steer = axis.x * CAR_TUNE.steer * dt * Math.min(1, Math.abs(car.speed) / 6 + 0.25) * Math.sign(car.speed || 1);
        car.heading -= steer;
      }
      const nx = car.x + Math.sin(car.heading) * car.speed * dt;
      const nz = car.z + Math.cos(car.heading) * car.speed * dt;
      const p = { x: nx, z: nz };
      world.collideCircle(p, CAR_TUNE.radius, Math.sin(car.heading) * car.speed, Math.cos(car.heading) * car.speed);
      for (const t of traffic) {
        const dx = p.x - t.x;
        const dz = p.z - t.z;
        const d = Math.hypot(dx, dz);
        if (d < 3.4 && d > 0.01) {
          p.x += (dx / d) * (3.4 - d) * 0.6;
          p.z += (dz / d) * (3.4 - d) * 0.6;
          car.speed *= 0.985;
        }
      }
      for (const c of G.police.list) {
        if (c.kind !== 'car') continue;
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < 3.6 && d > 0.01) {
          p.x += (dx / d) * (3.6 - d) * 0.7;
          p.z += (dz / d) * (3.6 - d) * 0.7;
          car.speed *= 0.9;
        }
      }
      world.clampToCity(p);
      car.x = p.x;
      car.z = p.z;
      car.group.position.set(car.x, 0, car.z);
      car.group.rotation.y = car.heading;
      for (const w of car.wheels) w.rotation.z -= (car.speed * dt) / 0.36;
      player.x = car.x;
      player.z = car.z;
      player.heading = car.heading;
      player.speed = Math.abs(car.speed);
      G.yaw = angleLerp(G.yaw, car.heading, dt * 2.2);
    } else {
      const speed = input.sprint() ? PLAYER_TUNE.sprint : PLAYER_TUNE.walk;
      const fwd = { x: Math.sin(G.yaw), z: Math.cos(G.yaw) };
      const right = { x: -Math.cos(G.yaw), z: Math.sin(G.yaw) };
      let mx = fwd.x * -axis.z + right.x * axis.x;
      let mz = fwd.z * -axis.z + right.z * axis.x;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        mx /= len;
        mz /= len;
        const p = { x: player.x + mx * speed * dt, z: player.z + mz * speed * dt };
        world.collideCircle(p, PLAYER_TUNE.radius, mx * speed, mz * speed);
        world.clampToCity(p);
        player.x = p.x;
        player.z = p.z;
        player.heading = Math.atan2(mx, mz);
        player.phase += speed * dt * 2.1;
        player.speed = speed;
        body.walk(player.phase, 1);
      } else {
        player.speed = 0;
        body.idle(G.elapsed);
      }
      if (input.down('Space') && player.y <= 0) {
        player.vy = PLAYER_TUNE.jump;
        player.y = 0.01;
      }
      if (player.y > 0 || player.vy !== 0) {
        player.vy -= PLAYER_TUNE.gravity * dt;
        player.y += player.vy * dt;
        if (player.y <= 0) { player.y = 0; player.vy = 0; }
      }
      player.group.position.set(player.x, player.y, player.z);
      player.group.rotation.y = player.heading;
    }
  }

  function updateWanted(dt) {
    if (wanted.wanted === 0) return;
    let near = false;
    for (const c of G.police.list) {
      if (dist2(c.x, c.z, player.x, player.z) < 40 * 40) { near = true; break; }
    }
    if (!near) {
      G.decayTimer += dt;
      G.seenClock += dt;
      if (G.seenClock >= 8 || G.decayTimer > HEAT.unseenSecs) {
        wanted.set(wanted.wanted - 1);
        G.decayTimer = 0;
        G.seenClock = 0;
      }
    } else {
      G.decayTimer = 0;
      G.seenClock = 0;
    }
    let cars = G.police.list.filter((c) => c.kind === 'car').length;
    let feet = G.police.list.filter((c) => c.kind === 'foot').length;
    const wantCars = Math.min(wanted.wanted, 3);
    const wantFeet = wanted.wanted >= 3 && !G.playerCar ? 1 : 0;
    if (cars >= wantCars && feet >= wantFeet) {
      G.spawnTimer = HEAT.spawnEvery;
      return;
    }
    G.spawnTimer -= dt;
    while (G.spawnTimer <= 0 && (cars < wantCars || feet < wantFeet)) {
      G.spawnTimer += HEAT.spawnEvery;
      if (cars < wantCars) {
        const ang = range(rand, 0, Math.PI * 2);
        const sx = player.x + Math.cos(ang) * 40;
        const sz = player.z + Math.sin(ang) * 40;
        const roadX = CITY.roadAt.reduce((a, b) => (Math.abs(b - sx) < Math.abs(a - sx) ? b : a));
        const roadZ = CITY.roadAt.reduce((a, b) => (Math.abs(b - sz) < Math.abs(a - sz) ? b : a));
        const useX = Math.abs(roadX - sx) < Math.abs(roadZ - sz);
        const cop = G.police.spawnCar(useX ? roadX : sx, useX ? sz : roadZ);
        cop.heading = Math.atan2(player.x - cop.x, player.z - cop.z);
        cars += 1;
      } else if (feet < wantFeet) {
        const ang = range(rand, 0, Math.PI * 2);
        G.police.spawnFootCop(player.x + Math.cos(ang) * 14, player.z + Math.sin(ang) * 14);
        feet += 1;
      }
    }
  }

  function updateTraffic(dt) {
    for (const t of traffic) {
      let s = t.speed;
      if (G.playerCar) {
        const d = Math.hypot(t.x - G.playerCar.x, t.z - G.playerCar.z);
        if (d < 9) s = t.speed * 0.4;
      }
      if (t.onXRoad) t.x += t.dir * s * dt;
      else t.z += t.dir * s * dt;
      const along = t.onXRoad ? t.x : t.z;
      if (along > 192) { if (t.onXRoad) t.x = -192; else t.z = -192; }
      if (along < -192) { if (t.onXRoad) t.x = 192; else t.z = 192; }
      t.group.position.set(t.x, 0, t.z);
      for (const w of t.wheels) w.rotation.z -= (s * dt) / 0.36;
    }
  }

  function updatePeds(dt) {
    for (const p of peds) {
      if (!p.alive) continue;
      p.x = p.group.position.x;
      p.z = p.group.position.z;
      if (p.stay) {
        p.humanoid.idle(G.elapsed);
        p.group.position.set(p.x, 0, p.z);
        continue;
      }
      const dx = p.wp.x - p.x;
      const dz = p.wp.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) {
        p.wp = { x: p.x + range(rand, -30, 30), z: p.z + range(rand, -30, 30) };
        continue;
      }
      p.heading = Math.atan2(dx, dz);
      const pos = { x: p.x + (dx / d) * p.speed * dt, z: p.z + (dz / d) * p.speed * dt };
      world.collideCircle(pos, 0.5, (dx / d) * p.speed, (dz / d) * p.speed);
      p.x = pos.x;
      p.z = pos.z;
      p.phase += p.speed * dt * 2.2;
      p.humanoid.walk(p.phase, 0.8);
      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.y = p.heading;
    }
  }

  function updateHostiles(dt) {
    for (const h of hostiles) {
      if (!h.alive) continue;
      h.x = h.group.position.x;
      h.z = h.group.position.z;
      if (h.target && h.speed > 0) {
        const dx = h.target.x - h.x;
        const dz = h.target.z - h.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.5) {
          h.heading = Math.atan2(dx, dz);
          const pos = { x: h.x + (dx / d) * h.speed * dt, z: h.z + (dz / d) * h.speed * dt };
          world.collideCircle(pos, 0.5, (dx / d) * h.speed, (dz / d) * h.speed);
          h.x = pos.x;
          h.z = pos.z;
          h.phase += h.speed * dt * 2.2;
          h.humanoid.walk(h.phase, 0.9);
        }
      }
      if (G.mode === 'playing' && h.shootT !== undefined) {
        h.shootT -= dt;
        const d = Math.hypot(player.x - h.x, player.z - h.z);
        if (h.shootT <= 0 && d < 40) {
          h.shootT = 2.5;
          hurtPlayer(8);
        }
      }
      h.group.position.set(h.x, 0, h.z);
      h.group.rotation.y = h.heading;
    }
  }

  function updateCamera(dt) {
    if (G.cameraMode === 'shot' && G.shotCamera) {
      camera.position.set(G.shotCamera.pos[0], G.shotCamera.pos[1], G.shotCamera.pos[2]);
      camera.lookAt(G.shotCamera.look[0], G.shotCamera.look[1], G.shotCamera.look[2]);
      return;
    }
    if (G.mode === 'title') {
      const t = G.elapsed * 0.03;
      camera.position.set(Math.cos(t) * 150, 70, Math.sin(t) * 150);
      camera.lookAt(0, 0, 0);
      return;
    }
    const target = G.playerCar
      ? { x: G.playerCar.x, z: G.playerCar.z, y: 0 }
      : { x: player.x, z: player.z, y: player.y };
    const dist = G.playerCar ? 10 : 7.5;
    const height = G.playerCar ? 4.2 : 3.1 + G.pitch * 2.4;
    const fwd = { x: Math.sin(G.yaw), z: Math.cos(G.yaw) };
    camera.position.set(
      target.x - fwd.x * dist,
      target.y + height,
      target.z - fwd.z * dist,
    );
    camera.lookAt(target.x + fwd.x * 3, target.y + 1.6, target.z + fwd.z * 3);
  }

  function updateHUD() {
    const obj = currentObjective();
    hud.update({
      health: G.health,
      money: G.money,
      wanted: wanted.wanted,
      objective: obj.text,
      objectiveDist: obj.dist,
      missionName: G.freeRoam ? 'IRONHAVEN' : 'MISSION ' + Math.min(G.missionIndex + 1, 5) + '/5',
      driving: !!G.playerCar,
      speed: G.playerCar ? Math.abs(G.playerCar.speed) : player.speed,
      ammo: G.ammo,
      reserve: G.reserve,
      player: { x: player.x, z: player.z },
      heading: G.playerCar ? G.playerCar.heading : G.yaw,
      police: G.police.list.map((c) => ({ x: c.x, z: c.z })),
      target: currentTarget(),
    });
  }

  // --- public state snapshot + API ---
  G.state = function state() {
    return {
      mode: G.mode,
      mission: G.missionIndex,
      missionStep: G.missionStep,
      money: G.money,
      health: Math.round(G.health),
      wanted: wanted.wanted,
      police: G.police.count,
      driving: !!G.playerCar,
      speed: G.playerCar ? Math.abs(G.playerCar.speed) : player.speed,
      player: { x: player.x, z: player.z },
      car: G.playerCar ? { x: G.playerCar.x, z: G.playerCar.z } : null,
      kills: G.kills,
      ammo: G.ammo,
    };
  };

  G.update = update;

  // Boot on the title screen.
  setMode('title');

  const api = {
    ready: true,
    version: '6.0.0',
    state: G.state,
    teleport,
    setWanted: G.setWanted,
    aimAt: G.aimAt,
    shoot: G.shoot,
    startMission: G.startMission,
    save: G.save,
    game: G,
  };

  return { game: G, api, stageShot: (name) => stageShot(G, name) };
}
