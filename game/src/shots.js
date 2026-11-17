// Port Meridian — deterministic screenshot staging. Each shot sets up a real
// game state, runs the live simulation forward a fixed number of 1/60s
// steps, places the camera behind the subject, updates the HUD, and lets
// main.js render twice before setting window.__shotReady. Nothing is drawn
// that the game itself does not draw.
import { makeCar } from './vehicles.js';

function placeNear(G, list, x, z, heading) {
  // Reposition a few entities AHEAD of (x, z) along `heading`, to the sides,
  // so the street is alive in frame and nothing sits behind the camera.
  const fx = Math.sin(heading), fz = Math.cos(heading);
  const rx = Math.cos(heading), rz = -Math.sin(heading);
  let n = 0;
  for (const e of list) {
    if (n >= 4) break;
    const fwd = 12 + n * 6;
    const side = (n % 2 === 0 ? -1 : 1) * (7 + n * 2);
    e.x = x + fx * fwd + rx * side;
    e.z = z + fz * fwd + rz * side;
    if (e.cruise !== undefined) e.heading = heading; // traffic drives the same way
    if (e.mesh) { e.mesh.position.set(e.x, 0, e.z); e.mesh.rotation.y = e.heading; }
    n++;
  }
}

function stepN(G, n) {
  let t = 0;
  for (let i = 0; i < n; i++) {
    t += 1 / 60;
    G.stepSim(1 / 60, t);
  }
}

function facePlayerAt(G, x, z) {
  const p = G.player;
  p.heading = Math.atan2(x - p.x, z - p.z);
  G.camYaw = p.heading;
  G.camPitch = 0.32;
  p.mesh.rotation.y = p.heading;
}

function stageChase(G) {
  // Mara in a bright RED getaway car, wanted 4, three police interceptors —
  // on the z = 0 road, heading east down a real street, skyline ahead.
  const car = makeCar('sport', 0xd83a2e, -60, 0, Math.PI / 2);
  car.mesh.position.set(-60, 0, 0);
  G.scene.add(car.mesh);
  G.parkedCars.push(car);
  const p = G.player;
  p.x = -60; p.z = 0; p.heading = Math.PI / 2; p.car = car;
  car.stolen = true;
  p.mesh.visible = false;
  car.speed = 12;
  G.camYaw = Math.PI / 2;
  G.camPitch = 0.22;
  // Mission 1's objective is the Tower, far north — its beacon stays out of
  // the chase frame (the escape mission's beacon sits on the player).
  G.missions.startMission(0, 0);
  G.police.wanted = 4;
  G.message('WANTED ★★★★');
  // Three police interceptors: one alongside, one behind, one ahead.
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
  const spots = [
    [car.x + rx * 7 + fx * 4, car.z + rz * 7 + fz * 4, 1],
    [car.x - fx * 16, car.z - fz * 16, 1],
    [car.x + fx * 26, car.z + fz * 26, 1],
  ];
  for (const [x, z] of spots) {
    const pc = G.police.spawnPoliceCar();
    pc.x = x; pc.z = z;
    pc.heading = Math.atan2(p.x - x, p.z - z);
    pc.speed = 15;
  }
  placeNear(G, G.traffic.cars.slice(0, 2), -60, 0, Math.PI / 2);
  placeNear(G, G.pedestrians.peds.slice(0, 4), -60, 0, Math.PI / 2);
  // Fleeing pedestrians near the chase.
  for (const ped of G.pedestrians.peds.slice(0, 3)) {
    ped.fleeTimer = 4;
    ped.fleeX = p.x; ped.fleeZ = p.z;
  }
  stepN(G, 45);
  car.speed = 14; // hold a reading speedometer after the steps
  G.snapCamera();
  G.hud.refresh();
  G.hud.drawMinimap();
  G.message('WANTED ★★★★');
}

function stageDrive(G) {
  // Mara driving a bright red car EAST along the beach promenade (z = 180),
  // water, sand and palms on the right, city on the left. The camera looks
  // a touch south of east so the water reads clearly in frame.
  const car = makeCar('sport', 0xd83a2e, -120, 180, Math.PI / 2);
  car.mesh.position.set(-120, 0, 180);
  G.scene.add(car.mesh);
  G.parkedCars.push(car);
  const p = G.player;
  p.x = -120; p.z = 180; p.heading = Math.PI / 2; p.car = car;
  car.stolen = true;
  p.mesh.visible = false;
  car.speed = 13;
  G.camYaw = Math.PI / 2 - 0.4;
  G.camPitch = 0.3;
  G.missions.startMission(0, 0);
  placeNear(G, G.traffic.cars.slice(0, 2), -100, 180, Math.PI / 2);
  // Two traffic cars on the promenade itself, ahead of the player.
  const t1 = G.traffic.cars[0];
  t1.x = -90; t1.z = 183; t1.heading = Math.PI / 2; t1.speed = 11;
  const t2 = G.traffic.cars[1];
  t2.x = -155; t2.z = 177; t2.heading = Math.PI / 2; t2.speed = 10;
  placeNear(G, G.pedestrians.peds.slice(0, 4), -110, 188, Math.PI / 2);
  stepN(G, 45);
  car.speed = 14; // hold a reading speedometer after the steps
  G.snapCamera();
  G.hud.refresh();
  G.hud.drawMinimap();
}

function stageMission(G) {
  // Mara on foot at the beach promenade objective on mission 2, FACING the
  // gold beacon, about 15 units away, beach behind the objective.
  G.missions.startMission(1, 0);
  const p = G.player;
  p.x = -120; p.z = 180;
  p.car = null;
  p.mesh.visible = true;
  facePlayerAt(G, -120, 195);
  p.mesh.position.set(p.x, 0, p.z);
  // A parked car, bench and hydrant are part of the city; pull one parked
  // car close so it reads in frame.
  const pc = G.parkedCars[0];
  pc.x = -106; pc.z = 182; pc.heading = Math.PI / 2;
  pc.mesh.position.set(pc.x, 0, pc.z);
  pc.mesh.rotation.y = pc.heading;
  placeNear(G, G.pedestrians.peds.slice(0, 4), -120, 186, 0);
  stepN(G, 30);
  // Re-face after the steps (the sim does not move an idle player).
  facePlayerAt(G, -120, 195);
  G.camPitch = 0.18; // level the camera: less empty foreground road
  G.snapCamera();
  G.hud.refresh();
  G.hud.drawMinimap();
  G.hud.toast('Mission 2: Harbour Pickup — collect the crate');
}

function stageCombat(G) {
  // Mara on foot at dusk near the harbour, aiming her pistol: crosshair
  // visible, muzzle flash lit, a rival in a BRIGHT PURPLE shirt fleeing
  // 8 units ahead and 2 units right, a police car ahead-right. She stands
  // ON the x = 0 road, facing north up a real street.
  G.missions.startMission(0, 0);
  const p = G.player;
  p.x = 0; p.z = 150;
  p.car = null;
  p.mesh.visible = true;
  p.aiming = true;
  p.ammo = 11; // one shot fired
  p.heading = Math.PI; // facing north, toward the harbour
  G.camYaw = Math.PI;
  G.camPitch = 0.28;
  p.mesh.rotation.y = p.heading;
  p.mesh.position.set(p.x, 0, p.z);
  // Rival crew member: bright purple shirt, 8 ahead, 2 right of the line.
  const rival = G.pedestrians.peds[0];
  const fx = Math.sin(p.heading), fz = Math.cos(p.heading);
  const rx = Math.cos(p.heading), rz = -Math.sin(p.heading);
  rival.x = p.x + fx * 8 + rx * 2;
  rival.z = p.z + fz * 8 + rz * 2;
  rival.fleeTimer = 5;
  rival.fleeX = p.x; rival.fleeZ = p.z;
  rival.mesh.position.set(rival.x, 0, rival.z);
  // Re-colour that pedestrian's shirt bright purple.
  rival.mesh.children[0].material = rival.mesh.children[0].material.clone();
  rival.mesh.children[0].material.color.setHex(0x8a2be2);
  // Police car about 18 units ahead-right, light bar visible.
  G.police.wanted = 2;
  const pc = G.police.spawnPoliceCar();
  pc.x = p.x + fx * 18 + rx * 10;
  pc.z = p.z + fz * 18 + rz * 10;
  pc.heading = Math.atan2(p.x - pc.x, p.z - pc.z);
  pc.speed = 8;
  placeNear(G, G.pedestrians.peds.slice(1, 4), p.x, p.z + 10, Math.PI);
  stepN(G, 20);
  // MUZZLE FLASH RULE: set the light on directly and leave it on through
  // the render — do not rely on the 60 ms flash timeout.
  G.muzzle.intensity = 10;
  G.muzzle.position.set(p.x + Math.sin(p.heading) * 0.8, 1.5, p.z + Math.cos(p.heading) * 0.8);
  // A few yellow spark particles at the muzzle.
  for (let i = 0; i < 5; i++) {
    const part = G.particles[i];
    part.life = part.max = 1;
    part.mesh.visible = true;
    part.mesh.material.color.setHex(0xffd34d);
    part.mesh.position.set(
      p.x + Math.sin(p.heading) * (1 + i * 0.3),
      1.4 + (Math.random() - 0.5) * 0.3,
      p.z + Math.cos(p.heading) * (1 + i * 0.3)
    );
    part.vx = 0; part.vy = 0; part.vz = 0;
  }
  G.snapCamera();
  G.hud.refresh();
  G.hud.drawMinimap();
  G.message('WANTED ★★');
}

export function stageShot(G, shot, seed) {
  G.timeOfDay = 17.3;
  G.cash = 1250;
  G.player.health = 100;
  G.player.ammo = 12;
  G.player.reserve = 48;
  const stages = { chase: stageChase, drive: stageDrive, mission: stageMission, combat: stageCombat };
  const fn = stages[shot];
  if (!fn) throw new Error(`unknown shot: ${shot}`);
  fn(G);
  // Final HUD pass so every readout reflects the staged state.
  G.hud.refresh();
  G.hud.drawMinimap();
}
