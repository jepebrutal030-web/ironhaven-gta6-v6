// IRONHAVEN v6 city: a 392x392 m grid, seven roads each way, downtown
// towers, residential blocks and a harbor with a sea to the east. All
// textures are procedural canvas art and every building is a box — no
// downloaded assets, so the game runs from static files with no network.
import { CITY, PALETTE, OPEN_BLOCKS, WAREHOUSE_SPOT } from './config.js';
import { range, pick } from './random.js';

export function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function paintCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}

export function buildWorld(THREE, scene, rand) {
  const aabbs = [];
  const circles = [];
  const centers = [];
  for (let i = 0; i < CITY.roadAt.length - 1; i += 1) {
    centers.push((CITY.roadAt[i] + CITY.roadAt[i + 1]) / 2);
  }
  const isOpen = (cx, cz) => OPEN_BLOCKS.some((p) => p.x === cx && p.z === cz);

  // --- grass ground with a noise speckle ---
  const grass = paintCanvas(256, 256, (g) => {
    g.fillStyle = PALETTE.grass;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i += 1) {
      g.fillStyle = rand() > 0.5 ? '#547f43' : '#679654';
      g.fillRect(Math.floor(rand() * 256), Math.floor(rand() * 256), 3, 3);
    }
  });
  const grassTex = new THREE.CanvasTexture(grass);
  grassTex.wrapS = THREE.RepeatWrapping;
  grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(24, 24);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size + 140, CITY.size + 140),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(40, -0.05, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  // --- asphalt roads with dashed centre lines and edge stripes ---
  const roadCanvas = paintCanvas(128, 128, (g) => {
    g.fillStyle = PALETTE.asphalt;
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i += 1) {
      g.fillStyle = rand() > 0.5 ? '#3f4247' : '#4b4e55';
      g.fillRect(Math.floor(rand() * 128), Math.floor(rand() * 128), 2, 2);
    }
    g.fillStyle = '#d8d8c8';
    g.fillRect(0, 6, 128, 3);
    g.fillRect(0, 119, 128, 3);
    g.fillStyle = '#e8c84a';
    g.fillRect(8, 62, 40, 4);
    g.fillRect(72, 62, 40, 4);
  });
  const roadTex = new THREE.CanvasTexture(roadCanvas);
  roadTex.wrapS = THREE.RepeatWrapping;
  roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(24, 1);
  const roadTexZ = roadTex.clone();
  roadTexZ.needsUpdate = true;
  roadTexZ.center.set(0.5, 0.5);
  roadTexZ.rotation = Math.PI / 2;
  const matX = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95 });
  const matZ = new THREE.MeshStandardMaterial({ map: roadTexZ, roughness: 0.95 });
  const geoX = new THREE.PlaneGeometry(CITY.size, CITY.roadWidth);
  const geoZ = new THREE.PlaneGeometry(CITY.roadWidth, CITY.size);
  for (const axis of CITY.roadAt) {
    const rx = new THREE.Mesh(geoX, matX);
    rx.rotation.x = -Math.PI / 2;
    rx.position.set(0, 0.02, axis);
    rx.receiveShadow = true;
    scene.add(rx);
    const rz = new THREE.Mesh(geoZ, matZ);
    rz.rotation.x = -Math.PI / 2;
    rz.position.set(axis, 0.02, 0);
    rz.receiveShadow = true;
    scene.add(rz);
  }

  // --- sidewalk pads, one per block ---
  const walkMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 1 });
  const walkGeo = new THREE.PlaneGeometry(CITY.block, CITY.block);
  for (const cx of centers) {
    for (const cz of centers) {
      const pad = new THREE.Mesh(walkGeo, walkMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(cx, 0.03, cz);
      pad.receiveShadow = true;
      scene.add(pad);
    }
  }

  // --- facades, cached per colour + glass ---
  const facadeCache = new Map();
  function facadeTex(color, glass) {
    const key = color + (glass ? 'g' : 'b');
    if (facadeCache.has(key)) return facadeCache.get(key);
    const c = paintCanvas(128, 256, (g) => {
      g.fillStyle = color;
      g.fillRect(0, 0, 128, 256);
      for (let r = 0; r < 9; r += 1) {
        for (let col = 0; col < 4; col += 1) {
          const lit = rand() > 0.72;
          g.fillStyle = glass ? (lit ? '#ffe9a8' : '#2a3a4a') : (lit ? '#ffe9a8' : '#20242c');
          g.fillRect(10 + col * 28, 12 + r * 26, 18, 14);
        }
      }
      if (!glass) {
        g.fillStyle = '#3a3a3a';
        g.fillRect(0, 232, 128, 24);
        g.fillStyle = '#c8b890';
        g.fillRect(8, 238, 50, 12);
        g.fillRect(70, 238, 50, 12);
      }
    });
    const t = new THREE.CanvasTexture(c);
    facadeCache.set(key, t);
    return t;
  }

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  function putBuilding(cx, cz, w, h, d, color, glass) {
    const mat = new THREE.MeshStandardMaterial({ map: facadeTex(color, glass), roughness: 0.85 });
    const b = new THREE.Mesh(unitBox, mat);
    b.scale.set(w, h, d);
    b.position.set(cx, h / 2, cz);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
    const cap = new THREE.Mesh(
      unitBox,
      new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 1 }),
    );
    cap.scale.set(w + 0.3, 0.4, d + 0.3);
    cap.position.set(cx, h + 0.2, cz);
    scene.add(cap);
    aabbs.push({
      minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2,
    });
    return b;
  }

  for (const cx of centers) {
    for (const cz of centers) {
      if (isOpen(cx, cz)) continue;
      const downtown = Math.abs(cx) <= 84 && Math.abs(cz) <= 84;
      const harbor = cx >= 140;
      if (harbor) {
        putBuilding(cx, cz, 30, range(rand, 9, 15), 22, pick(rand, PALETTE.harbor), false);
      } else if (downtown) {
        if (rand() > 0.5) {
          putBuilding(cx, cz, 26, range(rand, 34, 68), 26, pick(rand, PALETTE.downtown), true);
        } else {
          putBuilding(cx - 9, cz, 16, range(rand, 26, 52), 22, pick(rand, PALETTE.downtown), true);
          putBuilding(cx + 9, cz, 16, range(rand, 20, 44), 22, pick(rand, PALETTE.downtown), true);
        }
      } else {
        const n = 2 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i += 1) {
          putBuilding(
            cx + range(rand, -13, 13), cz + range(rand, -13, 13),
            range(rand, 9, 14), range(rand, 7, 15), range(rand, 9, 13),
            pick(rand, PALETTE.residential), false,
          );
        }
      }
    }
  }

  // The harbor warehouse the final job ends at.
  putBuilding(WAREHOUSE_SPOT.x, WAREHOUSE_SPOT.z, 26, 13, 18, '#5a6a7a', false);

  // --- trees, kept out of building footprints and off the roads ---
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1 });
  const leafGeo = new THREE.IcosahedronGeometry(1.5, 0);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a34, roughness: 1 });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x548c3a, roughness: 1 });
  for (const cx of centers) {
    for (const cz of centers) {
      if (isOpen(cx, cz)) continue;
      const n = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i += 1) {
        const tx = cx + range(rand, -14, 14);
        const tz = cz + range(rand, -14, 14);
        let inside = false;
        for (const a of aabbs) {
          if (tx > a.minX - 1 && tx < a.maxX + 1 && tz > a.minZ - 1 && tz < a.maxZ + 1) { inside = true; break; }
        }
        if (inside) continue;
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(tx, 0.8, tz);
        trunk.castShadow = true;
        scene.add(trunk);
        const leaf = new THREE.Mesh(leafGeo, rand() > 0.5 ? leafMat : leafMat2);
        leaf.position.set(tx, 2.6, tz);
        leaf.scale.y = 1.25;
        leaf.castShadow = true;
        scene.add(leaf);
        circles.push({ x: tx, z: tz, r: 0.6 });
      }
    }
  }

  // --- street lamps at every other intersection ---
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.2, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.7, metalness: 0.4 });
  const lampGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffdf80, emissiveIntensity: 0.9 });
  for (const ax of CITY.roadAt) {
    for (const az of CITY.roadAt) {
      if ((ax + az) % 112 !== 0) continue;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(ax + 6.2, 2.6, az + 6.2);
      scene.add(pole);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(ax + 6.2, 5.3, az + 6.2);
      scene.add(lamp);
    }
  }

  // --- traffic lights at four central intersections ---
  const signalMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  for (const [lx, lz] of [[0, 0], [56, -56], [-56, 56], [0, 112]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5.6, 6), signalMat);
    pole.position.set(lx + 5.6, 2.8, lz + 5.6);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.4), signalMat);
    head.position.set(lx + 5.6, 5.4, lz + 5.6);
    scene.add(head);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x22cc44, emissive: 0x22cc44, emissiveIntensity: 1.2 }),
    );
    dot.position.set(lx + 5.6, 5.15, lz + 5.35);
    scene.add(dot);
  }

  // --- the sea east of the harbor, with three wooden piers ---
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(120, CITY.size + 60),
    new THREE.MeshStandardMaterial({ color: 0x2a6a8a, roughness: 0.35, metalness: 0.25 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(256, -0.4, 0);
  scene.add(sea);
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x7a6a52, roughness: 1 });
  for (const pz of [-84, 0, 84]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(26, 0.3, 10), pierMat);
    pier.position.set(196, 0.05, pz);
    pier.receiveShadow = true;
    scene.add(pier);
  }

  // --- a gold pillar of light marks the hideout ---
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd34a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  beacon.position.set(-56, 30, -140);
  scene.add(beacon);

  return {
    colliders: { aabbs, circles },
    blockCenters: centers,
    beacon,
    // Push a circle out of every collider. The lateral bias keeps cars from
    // wedging head-on against round obstacles: after the radial push, slide
    // a little along the tangent, in the direction of travel, so a glancing
    // hit becomes a slide instead of a stop.
    collideCircle(p, r, vx, vz) {
      let hit = false;
      for (const a of aabbs) {
        const cx = Math.max(a.minX, Math.min(p.x, a.maxX));
        const cz = Math.max(a.minZ, Math.min(p.z, a.maxZ));
        let dx = p.x - cx;
        let dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 < 1e-6) {
          const pl = Math.min(p.x - a.minX, a.maxX - p.x);
          const pd = Math.min(p.z - a.minZ, a.maxZ - p.z);
          if (pl < pd) p.x += (p.x - a.minX < a.maxX - p.x ? -(pl + r) : pl + r);
          else p.z += (p.z - a.minZ < a.maxZ - p.z ? -(pd + r) : pd + r);
        } else {
          const d = Math.sqrt(d2);
          dx /= d;
          dz /= d;
          p.x = cx + dx * r;
          p.z = cz + dz * r;
        }
      }
      for (const c of circles) {
        const dx = p.x - c.x;
        const dz = p.z - c.z;
        const rr = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-9) continue;
        hit = true;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const nz = dz / d;
        const overlap = rr - d;
        p.x = c.x + nx * rr;
        p.z = c.z + nz * rr;
        const tx = -nz;
        const tz = nx;
        const along = (vx || 0) * tx + (vz || 0) * tz;
        const bias = 0.35 * overlap * (along >= 0 ? 1 : -1);
        p.x += tx * bias;
        p.z += tz * bias;
      }
      return hit;
    },
    clampToCity(p) {
      p.x = Math.max(-CITY.half + 2, Math.min(CITY.half + 2, p.x));
      p.z = Math.max(-CITY.half + 2, Math.min(CITY.half + 2, p.z));
    },
  };
}
