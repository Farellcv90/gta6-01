// Port Meridian — car models and traffic AI. Cars are built from boxes;
// traffic drives the road grid, snaps to lane centres at intersections,
// stops at red lights and never clips a building.
import * as THREE from 'three';
import { MAP_HALF, ROAD_LINES, ROAD_STEP, angDiff, clamp, mulberry32, nearestRoad } from './util.js';

export const CAR_COLORS = [0xd83a2e, 0x2a6fd8, 0xf2c230, 0x3aa84a, 0xe8e8e8, 0x22242a, 0x8a4ad8, 0xd86a1e];
export const CAR_NAMES = { sedan: 'Street Car', van: 'Harbour Van', sport: 'Meridian Sport', police: 'Harbour Police' };

export function makeCarMesh(style, color, isPolice = false) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x18222e, roughness: 0.15, metalness: 0.6 });
  const bodyH = style === 'van' ? 1.5 : style === 'sport' ? 0.62 : 0.85;
  const bodyL = style === 'van' ? 5.2 : style === 'sport' ? 4.6 : 4.4;
  const bodyW = style === 'sport' ? 2.3 : 2.0;
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyL), bodyMat);
  body.position.y = 0.75;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.82, style === 'van' ? 0.9 : 0.65, bodyL * (style === 'van' ? 0.8 : 0.45)), glassMat);
  cabin.position.set(0, 0.75 + bodyH / 2 + (style === 'van' ? 0.45 : 0.3), style === 'van' ? -0.2 : -0.2);
  g.add(cabin);
  // Headlights (warm emissive) and red taillights.
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd98a, emissiveIntensity: 1.4 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xc01010, emissiveIntensity: 1.0 });
  for (const sx of [-0.65, 0.65]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.12), headMat);
    h.position.set(sx, 0.75, bodyL / 2 + 0.02);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.12), tailMat);
    t.position.set(sx, 0.75, -bodyL / 2 - 0.02);
    g.add(t);
  }
  // Wheels.
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const wheels = [];
  for (const [wx, wz] of [[-bodyW / 2, bodyL / 2 - 0.8], [bodyW / 2, bodyL / 2 - 0.8], [-bodyW / 2, -bodyL / 2 + 0.8], [bodyW / 2, -bodyL / 2 + 0.8]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.42, wz);
    g.add(w);
    wheels.push(w);
  }
  let lightBar = null;
  if (isPolice) {
    lightBar = new THREE.Group();
    const rBar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 2 }));
    rBar.position.x = -0.4;
    const bBar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x2040ff, emissive: 0x2040ff, emissiveIntensity: 2 }));
    bBar.position.x = 0.4;
    lightBar.add(rBar, bBar);
    lightBar.position.set(0, 0.75 + bodyH / 2 + 0.65 + 0.15, -0.2);
    lightBar.userData = { rBar, bBar };
    g.add(lightBar);
  }
  g.userData.wheels = wheels;
  g.userData.lightBar = lightBar;
  return g;
}

// A drivable car (player or police). Heading: 0 = -z (north), PI/2 = +x (east).
export function makeCar(style, color, x, z, heading, isPolice = false) {
  const topSpeed = style === 'sport' ? 21 : style === 'van' ? 14 : style === 'police' ? 19 : 17;
  return {
    mesh: makeCarMesh(style, color, isPolice),
    x, z, heading, speed: 0,
    style, topSpeed, health: 100, isPolice,
    name: isPolice ? CAR_NAMES.police : CAR_NAMES[style],
    steer: 0, crashed: false,
  };
}

export function syncCarMesh(car) {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  const spin = car.speed * 0.12;
  for (const w of car.mesh.userData.wheels) w.rotation.x += spin * 0.016 * 60 * 0.016;
}

// ---------------------------------------------------------------- traffic AI
export function makeTraffic(city, seed = 7) {
  const rng = mulberry32(seed);
  const cars = [];
  const styles = ['sedan', 'sedan', 'van', 'sport'];
  for (let i = 0; i < 10; i++) {
    const along = ROAD_LINES[1 + Math.floor(rng() * (ROAD_LINES.length - 2))];
    const cross = ROAD_LINES[1 + Math.floor(rng() * (ROAD_LINES.length - 2))];
    const horizontal = rng() < 0.5;
    const dir = rng() < 0.5 ? 1 : -1;
    const lane = 3;
    const car = makeCar(styles[Math.floor(rng() * styles.length)],
      CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
      horizontal ? cross : along + dir * lane * -1,
      horizontal ? along + dir * lane : cross,
      horizontal ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? Math.PI : 0));
    car.cruise = 10 + rng() * 4;
    car.axis = horizontal ? 'x' : 'z';
    car.dir = dir;
    car.mesh.position.set(car.x, 0, car.z);
    cars.push(car);
  }
  return {
    cars,
    update(dt, t, G) {
      for (const car of cars) {
        // Slow when another car is close ahead.
        let ahead = false;
        const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
        for (const other of [...cars, ...(G.police ? G.police.cars : [])]) {
          if (other === car) continue;
          const dx = other.x - car.x, dz = other.z - car.z;
          const along = dx * fx + dz * fz;
          const side = Math.abs(dx * fz - dz * fx);
          if (along > 0 && along < 13 && side < 3) { ahead = true; break; }
        }
        // Stop at a red light within 10 units of an intersection.
        let redStop = false;
        const nx = car.x + fx * 10, nz = car.z + fz * 10;
        for (const tl of city.trafficLights) {
          if (tl.state === 'red' && Math.abs(nx - tl.x) < 12 && Math.abs(nz - tl.z) < 12) { redStop = true; break; }
        }
        const target = (ahead || redStop) ? 0 : car.cruise;
        car.speed += clamp(target - car.speed, -14 * dt, 8 * dt);
        car.x += Math.sin(car.heading) * car.speed * dt;
        car.z += Math.cos(car.heading) * car.speed * dt;
        city.pushOut(car, 1.6);
        city.clampToMap(car, 6);
        // At an intersection, sometimes pick a new road-aligned direction,
        // snapping to the new road's lane centre so it never drifts off-road.
        const nearInt = Math.abs(car.x - nearestRoad(car.x)) < 2.5 && Math.abs(car.z - nearestRoad(car.z)) < 2.5;
        if (nearInt && rng() < 0.35) {
          const turn = rng();
          if (turn < 0.25) { // turn left
            car.heading += Math.PI / 2;
          } else if (turn < 0.5) { // turn right
            car.heading -= Math.PI / 2;
          } else if (turn < 0.6) { // U-turn
            car.heading += Math.PI;
          }
          car.heading = Math.round(car.heading / (Math.PI / 2)) * (Math.PI / 2);
          // Snap to the new road's lane centre.
          const lane = 3;
          if (Math.abs(Math.sin(car.heading)) > 0.5) {
            car.z = nearestRoad(car.z) + Math.sign(Math.sin(car.heading)) * lane;
          } else {
            car.x = nearestRoad(car.x) + Math.sign(Math.cos(car.heading)) * lane;
          }
        }
        // Respawn on a random road at the map edge.
        if (Math.abs(car.x) > MAP_HALF - 8 || Math.abs(car.z) > MAP_HALF - 8) {
          const along = ROAD_LINES[1 + Math.floor(rng() * (ROAD_LINES.length - 2))];
          const cross = ROAD_LINES[1 + Math.floor(rng() * (ROAD_LINES.length - 2))];
          const horizontal = rng() < 0.5;
          const dir = rng() < 0.5 ? 1 : -1;
          car.x = horizontal ? cross : along - dir * 3;
          car.z = horizontal ? along + dir * 3 : cross;
          car.heading = horizontal ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? Math.PI : 0);
          car.speed = car.cruise;
        }
        syncCarMesh(car);
        // Spin wheels.
        for (const w of car.mesh.userData.wheels) w.rotation.x += car.speed * dt * 2.4;
      }
    },
  };
}
