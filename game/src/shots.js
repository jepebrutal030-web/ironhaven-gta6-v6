// Screenshot staging for ?shot=chase|drive|foot|mission. Each scene is
// staged from the live simulation: a car is moved onto the road under the
// player before the player is put in it, police roadblocks sit ahead of
// the direction of travel, and the mission shot uses a dedicated camera
// so the golden car and Dario are never occluded.
import { GOLDEN_SPOT } from './config.js';

export function stageShot(game, name) {
  const g = game;
  g.cruise = false;
  g.shotCamera = null;
  if (name === 'chase') {
    // Cover: the player mid-chase in a red car on road x=56 heading north,
    // a police roadblock 30 m ahead and a cruiser closing from behind.
    g.startNew();
    const car = g.stageCarOnRoad('Manta', 0xc8102e, 56, 60, Math.PI);
    g.enterCar(car);
    g.cruise = true;
    g.setWanted(3);
    g.police.spawnCar(56, 30, true);
    g.police.spawnCar(52, 26, true);
    const tail = g.police.spawnCar(56, 92, false);
    tail.heading = Math.PI;
    g.cameraMode = 'follow';
  } else if (name === 'drive') {
    // Driving north along road x=56 in a red car, speedometer ~18 mph.
    g.startNew();
    const car = g.stageCarOnRoad('Comet', 0xc8102e, 56, 80, Math.PI);
    g.enterCar(car);
    g.cruise = true;
    g.setWanted(0);
    g.cameraMode = 'follow';
  } else if (name === 'foot') {
    // On foot on the x=0 road, third person, pedestrians nearby.
    g.startNew();
    g.teleport(0, 24);
    g.setWanted(0);
    g.spawnPedsNear(0, 24, 4);
    g.yaw = Math.PI;
    g.cameraMode = 'follow';
  } else if (name === 'mission') {
    // Harbor Job: the golden Manta at the harbor, Dario beside it, no
    // cops, a 3/4 camera that clears the warehouse.
    g.startNew();
    g.setWanted(0);
    g.police.clearAll();
    const car = g.stageCarAt('Manta', 0xd4a017, GOLDEN_SPOT.x, GOLDEN_SPOT.z, Math.PI / 2);
    g.goldenCar = car;
    g.placeDario(GOLDEN_SPOT.x - 3.4, GOLDEN_SPOT.z + 1.5);
    g.teleport(GOLDEN_SPOT.x - 8, GOLDEN_SPOT.z + 8);
    g.yaw = Math.atan2(GOLDEN_SPOT.x - g.player.x, GOLDEN_SPOT.z - g.player.z);
    g.shotCamera = {
      pos: [GOLDEN_SPOT.x - 8, 3.0, GOLDEN_SPOT.z - 6],
      look: [GOLDEN_SPOT.x, 1.3, GOLDEN_SPOT.z],
    };
    g.cameraMode = 'shot';
  }
}
