// IRONHAVEN v6 boot: renderer, lights, camera, game loop. The loop clamps
// its delta so a slow headless frame never jumps the simulation, and it
// runs through renderer.setAnimationLoop so a screenshot can freeze it.
import * as THREE from 'three';
import { createRandom } from './random.js';
import { createInput } from './input.js';
import { createGame } from './game.js';
import { PALETTE } from './config.js';

const canvas = document.getElementById('game');
const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') || 1337);
const rand = createRandom(seed);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 180, 480);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
camera.position.set(0, 60, 150);

const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.05);
scene.add(hemi);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));

const sun = new THREE.DirectionalLight(PALETTE.sun, 2.1);
sun.position.set(120, 180, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -220;
sun.shadow.camera.right = 220;
sun.shadow.camera.top = 220;
sun.shadow.camera.bottom = -220;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 500;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);

const input = createInput(canvas);
const { game, api, stageShot } = createGame(THREE, scene, camera, renderer, canvas, input, rand);
window.IRONHAVEN = api;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// A screenshot URL (?shot=chase|drive|foot|mission) starts the game and
// stages its scene from the live simulation.
const shot = params.get('shot');
if (shot) {
  setTimeout(() => {
    try { stageShot(shot); } catch (e) { console.error('stageShot failed', e); }
  }, 300);
}

let last = performance.now();
function tick() {
  const now = performance.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.15) dt = 0.15;
  if (dt < 0) dt = 0;
  game.update(dt);
  renderer.render(scene, camera);
}
// Exposed so tooling can pause (setAnimationLoop(null)) and resume it.
game.loop = () => {
  last = performance.now();
  renderer.setAnimationLoop(tick);
};
renderer.setAnimationLoop(tick);
