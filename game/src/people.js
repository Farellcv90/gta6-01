// Port Meridian — pedestrians: sidewalk walkers who flee from crimes and
// gunshots, and always use the building push-out so they never clip a corner.
import * as THREE from 'three';
import { MAP_HALF, clamp, mulberry32 } from './util.js';

const SHIRTS = [0xd8d8d8, 0x3a6fd8, 0xd83a5a, 0x3aa84a, 0xf2c230, 0x8a4ad8, 0xd86a1e, 0x4ad8c8];
const SKINS = [0xe8b88a, 0xc98a5a, 0x8a5a3a, 0xf0c8a0, 0x6a4028];

export function makePersonMesh(shirt, skin, h = 1.8, opts = {}) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.3),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 }));
  torso.position.y = 1.05;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34),
    new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 }));
  head.position.y = 1.62;
  g.add(head);
  const legMat = new THREE.MeshStandardMaterial({ color: opts.pants ?? 0x2a2f3a, roughness: 0.9 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.7, 0.2), legMat);
  legL.position.set(-0.14, 0.35, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legL, legR);
  const armMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.9 });
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.14), armMat);
  armL.position.set(-0.36, 1.05, 0);
  const armR = armL.clone();
  armR.position.x = 0.36;
  g.add(armL, armR);
  if (opts.cap) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 8),
      new THREE.MeshStandardMaterial({ color: 0x1a2a5a, roughness: 0.8 }));
    cap.position.y = 1.84;
    g.add(cap);
  }
  g.scale.setScalar(h / 1.8);
  g.userData = { legL, legR, armL, armR };
  return g;
}

export function makePedestrians(city, scene, seed = 11, count = 22) {
  const rng = mulberry32(seed);
  const peds = [];
  for (let i = 0; i < count; i++) {
    const mesh = makePersonMesh(
      SHIRTS[Math.floor(rng() * SHIRTS.length)],
      SKINS[Math.floor(rng() * SKINS.length)],
      1.65 + rng() * 0.3
    );
    const ped = {
      mesh,
      x: (rng() * 2 - 1) * (MAP_HALF - 20),
      z: (rng() * 2 - 1) * (MAP_HALF - 20),
      heading: Math.floor(rng() * 4) * (Math.PI / 2),
      speed: 1.4 + rng() * 0.8,
      walkTimer: 2 + rng() * 4,
      fleeTimer: 0,
      fleeX: 0, fleeZ: 0,
      alive: true,
      isOfficer: false,
    };
    if (ped.z > 185) ped.z = 180;
    city.pushOut(ped, 0.6);
    mesh.position.set(ped.x, 0, ped.z);
    mesh.rotation.y = ped.heading;
    scene.add(mesh);
    peds.push(ped);
  }
  return {
    peds,
    scare(x, z, radius = 25) {
      for (const p of peds) {
        const dx = p.x - x, dz = p.z - z;
        const d = Math.hypot(dx, dz);
        if (d < radius) {
          p.fleeTimer = 3 + Math.random() * 2;
          p.fleeX = x; p.fleeZ = z;
        }
      }
    },
    update(dt, t) {
      for (const p of peds) {
        if (!p.alive) continue;
        if (p.fleeTimer > 0) {
          p.fleeTimer -= dt;
          const dx = p.x - p.fleeX, dz = p.z - p.fleeZ;
          const d = Math.hypot(dx, dz) || 1;
          p.heading = Math.atan2(dx / d, dz / d);
          p.x += (dx / d) * 5.5 * dt;
          p.z += (dz / d) * 5.5 * dt;
        } else {
          p.walkTimer -= dt;
          if (p.walkTimer <= 0) {
            p.walkTimer = 2 + Math.random() * 4;
            p.heading = Math.floor(Math.random() * 4) * (Math.PI / 2);
          }
          p.x += Math.sin(p.heading) * p.speed * dt;
          p.z += Math.cos(p.heading) * p.speed * dt;
        }
        city.pushOut(p, 0.6);
        p.x = clamp(p.x, -MAP_HALF + 5, MAP_HALF - 5);
        p.z = clamp(p.z, -MAP_HALF + 5, MAP_HALF + 20);
        p.mesh.position.set(p.x, 0, p.z);
        p.mesh.rotation.y = p.heading;
        const swing = Math.sin(t * (p.fleeTimer > 0 ? 14 : 8) + p.x) * 0.4;
        p.mesh.userData.legL.rotation.x = swing;
        p.mesh.userData.legR.rotation.x = -swing;
      }
    },
  };
}
