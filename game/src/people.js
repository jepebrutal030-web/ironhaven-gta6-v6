// Articulated pedestrians: head, torso, arms and legs as separate pivoted
// parts with a walk swing. Built from boxes and one sphere — never capsules
// or downloaded models — so every character is original and cheap to draw.
export function buildHumanoid(THREE, opts = {}) {
  const shirt = opts.shirt ?? 0x4a6a8a;
  const pants = opts.pants ?? 0x2c3240;
  const skin = opts.skin ?? 0xc98a6a;
  const hair = opts.hair ?? 0x2a2018;
  const g = new THREE.Group();

  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 1 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.9 });

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  // Legs hang below pivots at the hips (y 0.82).
  const legL = new THREE.Group();
  legL.position.set(0.11, 0.82, 0);
  legL.add(box(0.17, 0.78, 0.19, pantsMat, 0, -0.39, 0));
  legL.add(box(0.17, 0.1, 0.3, shoeMat, 0, -0.76, 0.05));
  g.add(legL);
  const legR = new THREE.Group();
  legR.position.set(-0.11, 0.82, 0);
  legR.add(box(0.17, 0.78, 0.19, pantsMat, 0, -0.39, 0));
  legR.add(box(0.17, 0.1, 0.3, shoeMat, 0, -0.76, 0.05));
  g.add(legR);

  // Torso with a dark belt line.
  const torso = box(0.46, 0.58, 0.26, shirtMat, 0, 1.12, 0);
  g.add(torso);
  g.add(box(0.48, 0.1, 0.28, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }), 0, 0.86, 0));

  // Arms pivot at the shoulders (y 1.36).
  const armL = new THREE.Group();
  armL.position.set(0.29, 1.36, 0);
  armL.add(box(0.13, 0.62, 0.15, shirtMat, 0, -0.31, 0));
  armL.add(box(0.12, 0.12, 0.13, skinMat, 0, -0.64, 0));
  g.add(armL);
  const armR = new THREE.Group();
  armR.position.set(-0.29, 1.36, 0);
  armR.add(box(0.13, 0.62, 0.15, shirtMat, 0, -0.31, 0));
  armR.add(box(0.12, 0.12, 0.13, skinMat, 0, -0.64, 0));
  g.add(armR);

  // Head: rounded skull, hair cap, face shade.
  const head = new THREE.Group();
  head.position.set(0, 1.56, 0);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skinMat);
  skull.scale.y = 1.15;
  skull.castShadow = true;
  head.add(skull);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.165, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
  hairCap.position.y = 0.03;
  head.add(hairCap);
  g.add(head);

  return {
    group: g,
    parts: { legL, legR, armL, armR, head, torso },
    // Swing the limbs for a walk cycle; phase advances with distance.
    walk(phase, amount) {
      const s = Math.sin(phase) * amount;
      legL.rotation.x = s * 0.7;
      legR.rotation.x = -s * 0.7;
      armL.rotation.x = -s * 0.55;
      armR.rotation.x = s * 0.55;
    },
    idle(t) {
      armL.rotation.x = Math.sin(t * 1.4) * 0.05;
      armR.rotation.x = -Math.sin(t * 1.4) * 0.05;
    },
  };
}
