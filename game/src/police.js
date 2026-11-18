// The wanted system: police cruisers that chase and ram, foot cops that
// run the player down and arrest them. Ramming is a gentle nudge with light
// damage so a foot cop can still catch the player; once a foot cop gets
// within reach it latches on and stays glued until the arrest lands.
import { HEAT } from './config.js';
import { buildCar, modelByName } from './cars.js';
import { buildHumanoid } from './people.js';

export function createPolice(THREE, scene, world, hooks) {
  // Each entry: {kind:'car'|'foot', group, x, z, heading, speed, hold,
  // placed, latched, arrestT, lightMat, ...}. Positions are read back from
  // the group's position at the start of every update, so outside code
  // that moves a cop's group (tests, staging) actually moves the cop.
  const list = [];
  let flashT = 0;

  function spawnCar(x, z, hold = false) {
    const built = buildCar(THREE, modelByName('Regal'), 0x14161a);
    built.group.position.set(x, 0, z);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
    for (const side of [1, -1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.4, 0.06), doorMat);
      door.position.set(0.2, 0.85, side * (built.width / 2 + 0.01));
      built.group.add(door);
    }
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0x2244ff, emissive: 0x2244ff, emissiveIntensity: 2,
    });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 1.1), lightMat);
    bar.position.set(-0.2, 1.52, 0);
    built.group.add(bar);
    scene.add(built.group);
    const cop = {
      kind: 'car', group: built.group, paintMat: built.paintMat, lightMat,
      x, z, heading: 0, speed: 0, hold, placed: true, wheels: built.wheels,
    };
    list.push(cop);
    return cop;
  }

  function spawnFootCop(x, z) {
    const h = buildHumanoid(THREE, { shirt: 0x2244aa, pants: 0x1a2233, skin: 0xb87a5a, hair: 0x111111 });
    h.group.position.set(x, 0, z);
    scene.add(h.group);
    const cop = {
      kind: 'foot', group: h.group, humanoid: h, hp: 100,
      x, z, heading: 0, speed: 0, hold: false,
      placed: true,
      latched: false, latchedDX: 0, latchedDZ: 0, arrestT: 0, phase: 0,
    };
    list.push(cop);
    return cop;
  }

  function clearAll() {
    for (const c of list) scene.remove(c.group);
    list.length = 0;
  }

  function sync(c) {
    c.x = c.group.position.x;
    c.z = c.group.position.z;
  }

  function update(dt, player) {
    flashT += dt;
    const flashBlue = Math.floor(flashT * 4) % 2 === 0;
    for (const c of list) {
      sync(c);
      if (c.kind === 'car') {
        c.lightMat.emissive.setHex(flashBlue ? 0x2244ff : 0xff2222);
        c.lightMat.color.setHex(flashBlue ? 0x2244ff : 0xff2222);
        if (c.hold) continue;
        const dx = player.x - c.x;
        const dz = player.z - c.z;
        const dist = Math.hypot(dx, dz) || 1;
        const wantHeading = Math.atan2(dx, dz);
        let dh = wantHeading - c.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        c.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, dh));
        const wantSpeed = dist > 26 ? 17 : 13;
        c.speed += (wantSpeed - c.speed) * Math.min(1, 1.6 * dt);
        const nx = c.x + Math.sin(c.heading) * c.speed * dt;
        const nz = c.z + Math.cos(c.heading) * c.speed * dt;
        const p = { x: nx, z: nz };
        world.collideCircle(p, 1.7, Math.sin(c.heading) * c.speed, Math.cos(c.heading) * c.speed);
        world.clampToCity(p);
        c.x = p.x;
        c.z = p.z;
        c.group.position.set(c.x, 0, c.z);
        c.group.rotation.y = c.heading;
        for (const w of c.wheels) w.rotation.z -= (c.speed * dt) / 0.36;
        if (dist < 3.6 && !player.driving) {
          const push = HEAT.ramPush * dt;
          player.x += (dx / dist) * push;
          player.z += (dz / dist) * push;
          hooks.damage(HEAT.ramHurt * dt);
        }
      } else {
        if (c.alive === false) continue;
        const dx = player.x - c.x;
        const dz = player.z - c.z;
        const dist = Math.hypot(dx, dz) || 1;
        if (!c.latched && dist < HEAT.latchReach) {
          c.latched = true;
          c.latchedDX = c.x - player.x;
          c.latchedDZ = c.z - player.z;
        }
        if (c.latched) {
          c.x = player.x + c.latchedDX * 0.4;
          c.z = player.z + c.latchedDZ * 0.4;
          c.heading = Math.atan2(player.x - c.x, player.z - c.z);
          if (dist < HEAT.arrestReach + 0.4) {
            c.arrestT += dt;
            if (c.arrestT >= HEAT.arrestSecs) hooks.busted();
          }
        } else {
          const run = 5.4;
          c.heading = Math.atan2(dx, dz);
          const nx = c.x + (dx / dist) * run * dt;
          const nz = c.z + (dz / dist) * run * dt;
          const p = { x: nx, z: nz };
          world.collideCircle(p, 0.5, (dx / dist) * run, (dz / dist) * run);
          c.x = p.x;
          c.z = p.z;
          c.phase += run * dt * 2.2;
          c.humanoid.walk(c.phase, 0.9);
        }
        c.group.position.set(c.x, 0, c.z);
        c.group.rotation.y = c.heading;
      }
    }
  }

  return {
    list, spawnCar, spawnFootCop, clearAll, update,
    get count() { return list.length; },
  };
}
