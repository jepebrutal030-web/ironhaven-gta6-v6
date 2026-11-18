// Procedural cars: body, glass cabin, four wheels, head- and taillights,
// bumpers and a plate. No model files — every model is built from boxes,
// so the eight models differ only by the dimensions in config.js.
import { CAR_MODELS } from './config.js';

export function buildCar(THREE, model, colorHex) {
  const g = new THREE.Group();
  const paintMat = new THREE.MeshStandardMaterial({
    color: colorHex, metalness: 0.55, roughness: 0.35,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x1a2a3a, metalness: 0.7, roughness: 0.15,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xb8bcc2, metalness: 0.9, roughness: 0.25,
  });
  const { len, wid } = model;
  const tall = model.roof === 'truck' || model.roof === 'van';
  const bodyH = tall ? 0.85 : 0.55;

  function addBox(w, h, d, mat, x, y, z, rz = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    g.add(m);
    return m;
  }

  // Main body, with a lower nose and tail.
  addBox(len, bodyH, wid, paintMat, 0, 0.55 + bodyH / 2 - 0.28, 0);
  addBox(len * 0.22, 0.34, wid * 0.92, paintMat, len / 2 - len * 0.11, 0.62, 0);
  addBox(len * 0.18, 0.4, wid * 0.94, paintMat, -len / 2 + len * 0.09, 0.66, 0);

  // Cabin: glasshouse with a sloped rear window (a pickup bed instead).
  if (model.roof === 'truck') {
    addBox(len * 0.4, 0.3, wid * 0.9, darkMat, -len * 0.24, 1.0, 0);
    addBox(len * 0.3, 0.62, wid * 0.9, glassMat, len * 0.2, 1.2, 0);
  } else {
    const cabLen = model.roof === 'van' ? len * 0.62 : len * 0.42;
    const cabX = model.roof === 'van' ? -len * 0.08 : -len * 0.06;
    addBox(cabLen, 0.5, wid * 0.82, glassMat, cabX, 1.18, 0);
    addBox(cabLen * 0.9, 0.08, wid * 0.8, paintMat, cabX, 1.46, 0);
    addBox(0.06, 0.62, wid * 0.78, glassMat, -len * 0.06 - cabLen / 2 - 0.12, 1.14, 0, -0.6);
  }

  // Four wheels with chrome hubs.
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.28, 8);
  const wheels = [];
  for (const [wx, wz] of [
    [len * 0.32, wid / 2 - 0.05], [len * 0.32, -wid / 2 + 0.05],
    [-len * 0.32, wid / 2 - 0.05], [-len * 0.32, -wid / 2 + 0.05],
  ]) {
    const wheel = new THREE.Mesh(wheelGeo, darkMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    wheel.castShadow = true;
    g.add(wheel);
    const hub = new THREE.Mesh(hubGeo, chromeMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(wx, 0.36, wz);
    g.add(hub);
    wheels.push(wheel);
  }

  // Bright headlights up front, red taillights at the back.
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff8d0, emissive: 0xfff2b0, emissiveIntensity: 1.6,
  });
  addBox(0.08, 0.16, wid * 0.72, headMat, len / 2 + 0.01, 0.72, 0);
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xcc1111, emissive: 0xff2222, emissiveIntensity: 1.4,
  });
  addBox(0.08, 0.18, wid * 0.78, tailMat, -len / 2 - 0.01, 0.74, 0);

  // Bumpers and a rear plate.
  const bumperMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.5 });
  addBox(0.14, 0.22, wid * 0.96, bumperMat, len / 2 + 0.06, 0.42, 0);
  addBox(0.14, 0.22, wid * 0.96, bumperMat, -len / 2 - 0.06, 0.42, 0);
  addBox(0.04, 0.2, 0.5, new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.6 }), -len / 2 - 0.14, 0.55, 0);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, paintMat, wheels, model, length: len, width: wid };
}

export function modelByName(name) {
  return CAR_MODELS.find((m) => m.name === name) || CAR_MODELS[0];
}
