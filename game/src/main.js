// Port Meridian — boot, game loop, player, driving, combat, camera, menus,
// save. The recorded builder wrote every line of this file in-session.
import * as THREE from 'three';
import { buildCity } from './city.js';
import { makeCar, makeTraffic, syncCarMesh, CAR_COLORS } from './vehicles.js';
import { makePedestrians, makePersonMesh } from './people.js';
import { makePolice } from './police.js';
import { makeMissions, MISSIONS } from './missions.js';
import { makeSide } from './side.js';
import { makeAudio } from './audio.js';
import { makeHud } from './hud.js';
import { stageShot } from './shots.js';
import { clamp, lerp, mulberry32, MAP_HALF, ROAD_LINES } from './util.js';

const SAVE_KEY = 'port-meridian-save-v1';
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = parseInt(params.get('seed') || '1', 10) || 1;

// ---------------------------------------------------------------- boot
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = false;
document.getElementById('game-canvas').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);

const G = {
  scene, camera, renderer,
  cash: 0,
  timeOfDay: 17.25, // 17:15 golden hour
  state: 'menu', // menu | playing | paused | gameover
  shotMode: !!SHOT,
  shotFrozen: false,
  shakeT: 0,
  camYaw: Math.PI, camPitch: 0.32,
  player: null,
  city: null, traffic: null, pedestrians: null, police: null,
  missions: null, side: null, audio: null, hud: null,
  parkedCars: [],
  particles: [],
  healthPacks: [],
  muzzle: null,
  muzzleT: 0,
  message(text) { this.hud.message(text); },
  shake(amount) { this.shakeT = Math.max(this.shakeT, amount); },
  save() { saveGame(); },
  respawnAtGarage() { respawnAtGarage(); },
  showGameOver(title, text) { showGameOver(title, text); },
};
window.__game = G;

G.city = buildCity(scene, SEED);
G.audio = makeAudio();
G.hud = makeHud(G);

// Player figure: Mara Voss, pink-red jacket so she reads in screenshots.
function makePlayerMesh() {
  const g = new THREE.Group();
  const jacket = new THREE.MeshStandardMaterial({ color: 0xd83a5a, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.8 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.9 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.32), jacket);
  torso.position.y = 1.08;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), skin);
  head.position.y = 1.66;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.9 }));
  hair.position.y = 1.88;
  g.add(hair);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.72, 0.22), pants);
  legL.position.set(-0.15, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.15;
  g.add(legL, legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.62, 0.15), jacket);
  armL.position.set(-0.39, 1.08, 0);
  const armR = armL.clone();
  armR.position.x = 0.39;
  g.add(armL, armR);
  // Pistol in the right hand when aiming.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.4, metalness: 0.6 }));
  gun.position.set(0.39, 0.85, 0.2);
  gun.visible = false;
  g.add(gun);
  g.userData = { legL, legR, armL, armR, gun };
  return g;
}

const playerMesh = makePlayerMesh();
scene.add(playerMesh);
G.player = {
  mesh: playerMesh, x: 180, z: 70, y: 0, vy: 0, heading: Math.PI,
  speed: 0, health: 100, car: null, ammo: 12, reserve: 48,
  aiming: false, stepT: 0, punchT: 0, punchCooldown: 0, fireCooldown: 0,
};
G.traffic = makeTraffic(G.city, SEED + 3);
for (const c of G.traffic.cars) scene.add(c.mesh);
G.pedestrians = makePedestrians(G.city, scene, SEED + 5);
G.police = makePolice(G.city, scene, G);
G.missions = makeMissions(scene, G);
G.side = makeSide(scene, G);
G.side.init();

// Parked cars in road lanes around the city.
{
  const rng = mulberry32(SEED + 9);
  const styles = ['sedan', 'sedan', 'van', 'sport'];
  for (let i = 0; i < 8; i++) {
    const along = ROAD_LINES[1 + Math.floor(rng() * (ROAD_LINES.length - 2))];
    const cross = ROAD_LINES[1 + Math.floor(rng() * (ROAD_LINES.length - 2))];
    const horizontal = rng() < 0.5;
    const style = styles[Math.floor(rng() * styles.length)];
    const car = makeCar(style, CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
      horizontal ? cross : along + 3, horizontal ? along + 3 : cross,
      horizontal ? Math.PI / 2 : 0);
    car.parked = true;
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    scene.add(car.mesh);
    G.parkedCars.push(car);
  }
}

// Health packs: green crosses scattered around the city.
{
  const rng = mulberry32(SEED + 13);
  const spots = [[-120, -120], [60, 60], [180, -60], [-60, 120], [0, 180]];
  for (const [x, z] of spots) {
    const grp = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x30d060 });
    const a = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.4, 0.4), mat);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 0.4), mat);
    grp.add(a, b);
    grp.position.set(x, 1.2, z);
    scene.add(grp);
    G.healthPacks.push({ mesh: grp, x, z, taken: false });
  }
}

// Muzzle flash light + particle pool (coloured: tan dust, orange sparks,
// yellow muzzle flash).
G.muzzle = new THREE.PointLight(0xffc860, 0, 18);
G.muzzle.position.set(0, 1.5, 0);
scene.add(G.muzzle);
{
  const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  for (let i = 0; i < 80; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    m.visible = false;
    scene.add(m);
    G.particles.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
  }
}
function spawnParticles(x, y, z, color, n, spread = 3, up = 2) {
  let spawned = 0;
  for (const p of G.particles) {
    if (spawned >= n) break;
    if (p.life > 0) continue;
    p.life = p.max = 0.5 + Math.random() * 0.5;
    p.mesh.visible = true;
    p.mesh.material.color.setHex(color);
    p.mesh.position.set(x, y, z);
    p.vx = (Math.random() - 0.5) * spread;
    p.vy = Math.random() * up;
    p.vz = (Math.random() - 0.5) * spread;
    spawned++;
  }
}
function updateParticles(dt) {
  for (const p of G.particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.vy -= 6 * dt;
    p.mesh.material.opacity = p.life / p.max;
  }
}

// ---------------------------------------------------------------- input
const keys = {};
let mouseDown = false, dragging = false, lastMX = 0, lastMY = 0;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape') {
    if (G.state === 'playing') pauseGame();
    else if (G.state === 'paused') resumeGame();
  }
  if (e.code === 'KeyE' && G.state === 'playing') tryEnterExitCar();
  if (e.code === 'KeyF' && G.state === 'playing') punch();
  if (e.code === 'KeyR' && G.state === 'playing') reload();
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
renderer.domElement.addEventListener('mousedown', (e) => {
  mouseDown = true; dragging = false; lastMX = e.clientX; lastMY = e.clientY;
  if (e.button === 2) G.player.aiming = true;
  if (e.button === 0 && G.player.aiming) shoot();
});
addEventListener('mouseup', (e) => {
  mouseDown = false;
  if (e.button === 2) G.player.aiming = false;
});
addEventListener('mousemove', (e) => {
  if (!mouseDown) return;
  const dx = e.clientX - lastMX, dy = e.clientY - lastMY;
  lastMX = e.clientX; lastMY = e.clientY;
  if (Math.abs(dx) + Math.abs(dy) > 2) dragging = true;
  G.camYaw -= dx * 0.005;
  G.camPitch = clamp(G.camPitch + dy * 0.004, -0.05, 0.9);
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- driving
function nearestCar(maxD) {
  let best = null, bestD = maxD;
  for (const car of [...G.parkedCars, ...G.traffic.cars]) {
    const d = Math.hypot(car.x - G.player.x, car.z - G.player.z);
    if (d < bestD) { best = car; bestD = d; }
  }
  return best;
}
function tryEnterExitCar() {
  const p = G.player;
  if (p.car) {
    // Exit to the side.
    const side = p.car.heading + Math.PI / 2;
    p.x = p.car.x + Math.sin(side) * 2.6;
    p.z = p.car.z + Math.cos(side) * 2.6;
    p.y = 0; p.vy = 0;
    G.city.pushOut(p, 0.6);
    p.car = null;
    p.mesh.visible = true;
    G.audio.setEngine(0, 1);
    return;
  }
  const car = nearestCar(4.5);
  if (!car) return;
  p.car = car;
  car.parked = false;
  p.mesh.visible = false;
  if (!car.stolen) {
    car.stolen = true;
    G.police.addCrime(1, 'Car stolen! The harbour police are on to you.');
    G.pedestrians.scare(p.x, p.z, 20);
  }
  G.message(`Driving the ${car.name}`);
  G.audio.ui();
}

function updateDriving(dt) {
  const p = G.player, car = p.car;
  const fwd = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const steerIn = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
  const handbrake = keys.Space;
  const accel = 13;
  if (fwd > 0) car.speed += accel * dt;
  else if (fwd < 0) car.speed -= (car.speed > 0.5 ? 20 : 8) * dt;
  else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 4 * dt);
  if (handbrake) {
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 22 * dt);
    if (Math.abs(car.speed) > 4) spawnParticles(car.x, 0.2, car.z, 0xc8b088, 2, 2, 0.8);
  }
  car.speed = clamp(car.speed, -7, car.topSpeed);
  const steerScale = clamp(Math.abs(car.speed) / 8, 0, 1) * (car.speed < 0 ? -1 : 1);
  car.heading += steerIn * 1.9 * steerScale * dt;
  const ox = car.x, oz = car.z;
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const pushedX = car.x, pushedZ = car.z;
  G.city.pushOut(car, 1.6);
  if ((car.x !== pushedX || car.z !== pushedZ) && Math.abs(car.speed) > 6) {
    G.audio.crash();
    G.shake(0.4);
    spawnParticles(car.x, 1, car.z, 0xff8020, 10, 5, 3);
    car.health -= 12;
    car.speed *= 0.4;
  }
  G.city.clampToMap(car, 6);
  // Bump other cars apart with a small speed penalty.
  for (const other of [...G.traffic.cars, ...G.parkedCars, ...G.police.cars]) {
    if (other === car) continue;
    const dx = car.x - other.x, dz = car.z - other.z;
    const d = Math.hypot(dx, dz);
    if (d < 3.6 && d > 0.01) {
      const push = (3.6 - d) / 2;
      car.x += (dx / d) * push;
      car.z += (dz / d) * push;
      other.x -= (dx / d) * push * 0.5;
      other.z -= (dz / d) * push * 0.5;
      if (Math.abs(car.speed) > 5) {
        car.speed *= 0.85;
        G.audio.crash();
        G.shake(0.25);
        spawnParticles(car.x, 1, car.z, 0xff8020, 6, 4, 2);
      }
      syncCarMesh(other);
    }
  }
  // Running over a pedestrian at speed is a crime.
  for (const ped of G.pedestrians.peds) {
    if (!ped.alive || ped.hitT > 0) continue;
    if (Math.hypot(ped.x - car.x, ped.z - car.z) < 2.2 && Math.abs(car.speed) > 5) {
      ped.hitT = 3;
      ped.fleeTimer = 4;
      ped.fleeX = car.x; ped.fleeZ = car.z;
      G.police.addCrime(1, 'You hit a pedestrian!');
      G.pedestrians.scare(car.x, car.z, 25);
      G.shake(0.3);
    }
  }
  for (const ped of G.pedestrians.peds) if (ped.hitT > 0) ped.hitT -= dt;
  // Smoke when damaged.
  if (car.health < 60 && Math.random() < dt * 10) {
    spawnParticles(car.x, 1.2, car.z, 0x888888, 1, 1, 2);
  }
  if (car.health <= 0) {
    car.health = 100;
    car.speed = 0;
    spawnParticles(car.x, 1, car.z, 0x666666, 14, 4, 4);
    G.message('Your car is wrecked — it stalls out.');
    const rng = mulberry32((Math.random() * 1e9) | 0);
    car.x = ROAD_LINES[1 + Math.floor(rng() * (ROAD_LINES.length - 2))];
    car.z = ROAD_LINES[1 + Math.floor(rng() * (ROAD_LINES.length - 2))];
    car.heading = Math.floor(rng() * 4) * (Math.PI / 2);
  }
  p.x = car.x; p.z = car.z; p.heading = car.heading;
  syncCarMesh(car);
  for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.4;
  G.audio.setEngine(car.speed, car.topSpeed);
  // Speeding past a police car raises the heat.
  for (const pc of G.police.cars) {
    if (Math.hypot(pc.x - car.x, pc.z - car.z) < 8 && Math.abs(car.speed) > 15 && !car.speedingFlag) {
      car.speedingFlag = true;
      G.police.addCrime(1, 'Speeding past the police!');
      setTimeout(() => { car.speedingFlag = false; }, 8000);
    }
  }
}

// ---------------------------------------------------------------- on foot
function updateOnFoot(dt, t) {
  const p = G.player;
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) { mx += Math.sin(G.camYaw); mz += Math.cos(G.camYaw); }
  if (keys.KeyS || keys.ArrowDown) { mx -= Math.sin(G.camYaw); mz -= Math.cos(G.camYaw); }
  if (keys.KeyA || keys.ArrowLeft) { mx -= Math.cos(G.camYaw); mz += Math.sin(G.camYaw); }
  if (keys.KeyD || keys.ArrowRight) { mx += Math.cos(G.camYaw); mz -= Math.sin(G.camYaw); }
  const len = Math.hypot(mx, mz);
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const speed = sprint ? 9 : 5;
  if (len > 0) {
    mx /= len; mz /= len;
    p.heading = Math.atan2(mx, mz);
    p.x += mx * speed * dt;
    p.z += mz * speed * dt;
    p.speed = speed;
    p.stepT -= dt;
    if (p.stepT <= 0) {
      p.stepT = sprint ? 0.28 : 0.4;
      G.audio.footstep();
      spawnParticles(p.x, 0.1, p.z, 0xc8b088, 1, 1, 0.6);
    }
  } else {
    p.speed = 0;
  }
  // Jump.
  if (keys.Space && p.y === 0) {
    p.vy = 7;
    G.audio.blip(300, 0.1, 'sine', 0.1);
  }
  if (p.y > 0 || p.vy !== 0) {
    p.vy -= 20 * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) { p.y = 0; p.vy = 0; }
  }
  G.city.pushOut(p, 0.6);
  G.city.clampToMap(p, 5);
  // Health packs.
  for (const hp of G.healthPacks) {
    if (hp.taken) continue;
    hp.mesh.rotation.y += dt;
    if (Math.hypot(p.x - hp.x, p.z - hp.z) < 2.2) {
      hp.taken = true;
      hp.mesh.visible = false;
      p.health = Math.min(100, p.health + 40);
      G.message('Health +40');
      G.audio.chime();
      G.hud.refresh();
    }
  }
  // Walk animation.
  const swing = Math.sin(t * (p.speed > 6 ? 13 : 9)) * (p.speed > 0 ? 0.55 : 0);
  p.mesh.userData.legL.rotation.x = swing;
  p.mesh.userData.legR.rotation.x = -swing;
  p.mesh.userData.armL.rotation.x = -swing * 0.7;
  p.mesh.userData.armR.rotation.x = swing * 0.7;
  p.mesh.userData.gun.visible = p.aiming;
  p.mesh.position.set(p.x, p.y, p.z);
  p.mesh.rotation.y = p.heading;
  p.punchCooldown -= dt;
  p.fireCooldown -= dt;
}

// ---------------------------------------------------------------- combat
function punch() {
  const p = G.player;
  if (p.car || p.punchCooldown > 0) return;
  p.punchCooldown = 0.5;
  p.punchT = 0.25;
  G.audio.punch();
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  for (const ped of G.pedestrians.peds) {
    if (!ped.alive) continue;
    const dx = ped.x - p.x, dz = ped.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.4 && (dx * fx + dz * fz) / d > 0.4) {
      ped.fleeTimer = 4;
      ped.fleeX = p.x; ped.fleeZ = p.z;
      G.police.addCrime(1, 'Assault! The police are coming.');
      spawnParticles(ped.x, 1.2, ped.z, 0xffd34d, 6, 3, 2);
      break;
    }
  }
}

function shoot() {
  const p = G.player;
  if (p.car || p.fireCooldown > 0) return;
  if (p.ammo <= 0) {
    G.audio.blip(180, 0.08, 'square', 0.15);
    G.message('Out of ammo — press R to reload');
    return;
  }
  p.fireCooldown = 0.22;
  p.ammo--;
  G.audio.gunshot();
  G.shake(0.18);
  // Muzzle flash light + yellow sparks at the muzzle.
  G.muzzle.intensity = 10;
  G.muzzle.position.set(p.x + Math.sin(p.heading) * 0.8, 1.5, p.z + Math.cos(p.heading) * 0.8);
  G.muzzleT = 0.06;
  spawnParticles(p.x + Math.sin(p.heading), 1.4, p.z + Math.cos(p.heading), 0xffd34d, 5, 2, 1.5);
  // Ray test along the camera direction against peds, cars, officers < 60u.
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const ox = p.x, oy = 1.5, oz = p.z;
  let best = null, bestD = 60;
  const testTarget = (tx, tz, ty, radius, kind, ref) => {
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d > 60 || d < 0.5) return;
    const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / d;
    if (dot < 0.985) return;
    const perp = d * Math.sqrt(Math.max(0, 1 - dot * dot));
    if (perp > radius + 0.4) return;
    if (d < bestD) { bestD = d; best = { kind, ref }; }
  };
  for (const ped of G.pedestrians.peds) {
    if (ped.alive) testTarget(ped.x, ped.z, 1.2, 0.8, 'ped', ped);
  }
  for (const car of [...G.traffic.cars, ...G.parkedCars]) {
    testTarget(car.x, car.z, 1, 2.2, 'car', car);
  }
  for (const pc of G.police.cars) testTarget(pc.x, pc.z, 1, 2.2, 'policeCar', pc);
  for (const o of G.police.officers) testTarget(o.x, o.z, 1.2, 0.8, 'officer', o);
  if (best) {
    spawnParticles(ox + dir.x * bestD, oy + dir.y * bestD, oz + dir.z * bestD, 0xff8020, 8, 3, 2);
    if (best.kind === 'ped' || best.kind === 'officer') {
      const ped = best.ref;
      ped.fleeTimer = 5;
      ped.fleeX = p.x; ped.fleeZ = p.z;
      G.police.addCrime(1, best.kind === 'officer' ? 'You shot an officer!' : 'You shot a pedestrian!');
      G.pedestrians.scare(p.x, p.z, 25);
    } else {
      const car = best.ref;
      car.health -= 25;
      G.police.addCrime(1, 'Shots fired!');
      if (car.health <= 0) {
        car.health = 100;
        car.speed = 0;
        spawnParticles(car.x, 1, car.z, 0x666666, 14, 4, 4);
        G.message('That car is wrecked.');
      }
    }
  } else {
    G.police.addCrime(1, 'Shots fired!');
  }
  G.pedestrians.scare(p.x, p.z, 30);
  G.hud.refresh();
}

function reload() {
  const p = G.player;
  if (p.car || p.ammo === 12 || p.reserve === 0) return;
  const need = 12 - p.ammo;
  const take = Math.min(need, p.reserve);
  p.ammo += take;
  p.reserve -= take;
  G.audio.ui();
  G.message(`Reloaded — ${p.ammo}/12, reserve ${p.reserve}`);
  G.hud.refresh();
}

// ---------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
function updateCamera(dt) {
  const p = G.player;
  const dist = p.car ? 11 : 7.5;
  const height = p.car ? 5.2 : 4.2;
  const cp = Math.cos(G.camPitch), sp = Math.sin(G.camPitch);
  camTarget.set(
    p.x - Math.sin(G.camYaw) * dist * cp,
    p.y + height * (0.6 + sp),
    p.z - Math.cos(G.camYaw) * dist * cp
  );
  camPos.lerp(camTarget, 0.12);
  camera.position.copy(camPos);
  if (G.shakeT > 0) {
    camera.position.x += (Math.random() - 0.5) * G.shakeT;
    camera.position.y += (Math.random() - 0.5) * G.shakeT;
    G.shakeT -= dt;
  }
  camera.lookAt(p.x, p.y + 1.5, p.z);
  const speed = p.car ? Math.abs(p.car.speed) : p.speed;
  const targetFov = 62 + clamp(speed / 21, 0, 1) * 8;
  camera.fov = lerp(camera.fov, targetFov, 0.05);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- menus / save
function showMenu(id) {
  for (const m of ['menu-start', 'menu-pause', 'menu-gameover']) {
    document.getElementById(m).style.display = m === id ? 'flex' : 'none';
  }
  document.getElementById('hud').style.display = id ? 'none' : 'block';
}
function newGame() {
  G.cash = 0;
  G.player.health = 100;
  G.player.ammo = 12;
  G.player.reserve = 48;
  G.side.tokensCollected = 0;
  for (const tok of G.side.tokens) { tok.taken = false; tok.mesh.visible = true; }
  G.police.wanted = 0;
  G.police.clearAll();
  G.audio.siren(false);
  respawnAtGarage();
  G.missions.startMission(0, 0);
  G.state = 'playing';
  showMenu(null);
  G.audio.init();
  G.audio.ui();
  G.hud.refresh();
  G.hud.toast('Mission 1: First Run — drive to the Meridian Tower');
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: G.cash,
      missionIndex: G.missions.index,
      missionStage: G.missions.stage,
      tokensCollected: G.side.tokensCollected,
      tokensTaken: G.side.tokens.map((t) => t.taken),
      health: G.player.health,
    }));
  } catch { /* storage may be unavailable */ }
}
function continueGame() {
  const s = loadSave();
  if (!s) return;
  G.cash = s.cash ?? 0;
  G.player.health = s.health ?? 100;
  G.side.tokensCollected = s.tokensCollected ?? 0;
  (s.tokensTaken || []).forEach((taken, i) => {
    if (taken && G.side.tokens[i]) {
      G.side.tokens[i].taken = true;
      G.side.tokens[i].mesh.visible = false;
    }
  });
  G.police.wanted = 0;
  G.police.clearAll();
  respawnAtGarage();
  const idx = Math.min(s.missionIndex ?? 0, MISSIONS.length - 1);
  G.missions.startMission(idx, 0);
  // Mission 4 (index 3): the heat is on the moment the story resumes here.
  if (idx === 3) {
    G.police.wanted = 3;
    G.message('The police spotted the getaway!');
    G.audio.siren(true);
  }
  G.state = 'playing';
  showMenu(null);
  G.audio.init();
  G.audio.ui();
  G.hud.refresh();
}
function pauseGame() {
  G.state = 'paused';
  showMenu('menu-pause');
  const list = document.getElementById('mission-list');
  list.innerHTML = MISSIONS.map((m, i) => {
    const mark = i < G.missions.index ? '✓ done' : i === G.missions.index ? '▶ current' : '· upcoming';
    return `<div>${i + 1}. ${m.name} — $${m.reward} <span>${mark}</span></div>`;
  }).join('');
  document.getElementById('pause-stats').textContent =
    `Cash $${G.cash} · Health ${Math.round(G.player.health)} · Tokens ${G.side.tokensCollected}/12 · Wanted ${'★'.repeat(G.police.wanted)}${'☆'.repeat(5 - G.police.wanted)}`;
  G.audio.ui();
}
function resumeGame() {
  G.state = 'playing';
  showMenu(null);
  G.audio.ui();
}
function showGameOver(title, text) {
  G.state = 'gameover';
  document.getElementById('gameover-title').textContent = title;
  document.getElementById('gameover-text').textContent = text;
  showMenu('menu-gameover');
}
function respawnAtGarage() {
  const p = G.player;
  if (p.car) { p.car = null; }
  p.mesh.visible = true;
  p.x = G.city.garagePos.x;
  p.z = G.city.garagePos.z - 14;
  p.y = 0; p.vy = 0;
  p.heading = Math.PI;
  p.health = 100;
  G.camYaw = Math.PI;
  G.audio.setEngine(0, 1);
  saveGame();
}

document.getElementById('btn-new').addEventListener('click', newGame);
document.getElementById('btn-continue').addEventListener('click', continueGame);
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-restart').addEventListener('click', () => { newGame(); });
document.getElementById('btn-quit').addEventListener('click', () => {
  G.state = 'menu';
  showMenu('menu-start');
  refreshStartMenu();
});
document.getElementById('btn-retry').addEventListener('click', () => {
  G.state = 'playing';
  showMenu(null);
  G.hud.refresh();
});
document.getElementById('btn-replay').addEventListener('click', () => {
  G.missions.replay();
  resumeGame();
});
document.getElementById('volume').addEventListener('input', (e) => {
  G.audio.setVolume(parseFloat(e.target.value));
});
document.getElementById('quality').addEventListener('change', (e) => {
  const q = e.target.value;
  renderer.setPixelRatio(q === 'low' ? 1 : q === 'high' ? Math.min(devicePixelRatio, 2) : 1.25);
});
function refreshStartMenu() {
  document.getElementById('btn-continue').style.display = loadSave() ? 'block' : 'none';
}
refreshStartMenu();

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let hudT = 0;
// One fixed simulation step, shared by the live loop and screenshot staging.
function stepSim(dt, t) {
  G.timeOfDay += dt * 0.004;
  if (G.timeOfDay > 19) G.timeOfDay = 17.25;
  G.city.update(dt, t, G.timeOfDay);
  if (G.player.car) updateDriving(dt);
  else updateOnFoot(dt, t);
  G.traffic.update(dt, t, G);
  G.pedestrians.update(dt, t);
  G.police.update(dt, t);
  G.missions.update(dt, t);
  G.side.update(dt, t);
  updateParticles(dt);
  // Muzzle flash decays fast.
  if (G.muzzleT > 0) {
    G.muzzleT -= dt;
    if (G.muzzleT <= 0) G.muzzle.intensity = 0;
  }
  hudT += dt;
  if (hudT > 0.25) {
    hudT = 0;
    G.hud.refresh();
    G.hud.drawMinimap();
  }
}
G.stepSim = stepSim;
// Snap the camera to its target immediately (screenshot staging).
G.snapCamera = () => {
  const p = G.player;
  const dist = p.car ? 11 : 7.5;
  const height = p.car ? 5.2 : 4.2;
  const cp = Math.cos(G.camPitch), sp = Math.sin(G.camPitch);
  camPos.set(
    p.x - Math.sin(G.camYaw) * dist * cp,
    p.y + height * (0.6 + sp),
    p.z - Math.cos(G.camYaw) * dist * cp
  );
  camera.position.copy(camPos);
  camera.lookAt(p.x, p.y + 1.5, p.z);
  camera.fov = 62;
  camera.updateProjectionMatrix();
};
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (G.state === 'playing' && !G.shotFrozen) {
    stepSim(dt, t);
  }
  updateCamera(dt);
  renderer.render(scene, camera);
}
animate();

// Shot staging: deterministic scenes for screenshots. The recorder watches
// this session, so the staging runs here, in-session, from the live game.
if (SHOT) {
  showMenu(null);
  G.state = 'playing';
  G.audio.init = () => {}; // no audio in a headless shot
  try {
    stageShot(G, SHOT, SEED);
    G.shotFrozen = true;
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    window.__shotReady = true;
  } catch (err) {
    console.error('shot staging failed', err);
    window.__shotError = String(err);
  }
}
