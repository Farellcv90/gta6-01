// Port Meridian — side activities: taxi fares, Meridian tokens, courier runs.
import * as THREE from 'three';
import { makePersonMesh } from './people.js';
import { clamp, mulberry32 } from './util.js';

const TOKEN_SPOTS = [
  [-150, 212], [-60, 238], [90, 210], [170, 216], [-210, 60], [-30, -210],
  [210, -180], [120, 120], [-180, -120], [60, 180], [0, -60], [-120, -180],
];

export function makeSide(scene, G) {
  const rng = mulberry32(41);
  const side = {
    tokens: [], tokensCollected: 0,
    fare: null, fareCooldown: 0, farePassenger: null, fareMarker: null,
    courier: null, courierCooldown: 12,

    init() {
      // 12 gold spinning tokens at fixed spots.
      const geo = new THREE.OctahedronGeometry(0.9);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffd34d, emissive: 0xa87800, emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.3,
      });
      for (const [x, z] of TOKEN_SPOTS) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, 1.4, z);
        scene.add(m);
        this.tokens.push({ mesh: m, x, z, taken: false });
      }
      this.spawnFare();
    },

    spawnFare() {
      // Waiting passenger at a kerb with a gold TAXI marker above them.
      const roadX = [-180, -120, -60, 0, 60, 120, 180][Math.floor(rng() * 7)];
      const roadZ = [-180, -120, -60, 0, 60, 120, 180][Math.floor(rng() * 7)];
      const x = roadX + 8, z = roadZ + 8;
      const mesh = makePersonMesh(0xf2c230, 0xe8b88a, 1.75);
      mesh.position.set(x, 0, z);
      scene.add(mesh);
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.8, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffd34d })
      );
      marker.position.set(x, 2.6, z);
      scene.add(marker);
      const destX = [-180, -120, -60, 0, 60, 120, 180][Math.floor(rng() * 7)] + 8;
      const destZ = [-180, -120, -60, 0, 60, 120, 180][Math.floor(rng() * 7)] + 8;
      this.fare = {
        x, z, destX, destZ, pickedUp: false, parTime: 60,
        timer: 0, tripStart: 0, passengerMesh: mesh, marker,
        destMarker: null, fareText: '',
      };
      G.hud.refresh();
    },

    // A story-mission taxi stage: passenger waits at (x,z); drive to them,
    // then deliver them to a fixed destination. Returns a stage handle.
    startStoryTaxi(x, z) {
      const handle = { done: false, target: { x, z } };
      const mesh = makePersonMesh(0x37e0ff, 0xc98a5a, 1.75);
      mesh.position.set(x + 8, 0, z + 8);
      scene.add(mesh);
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.8, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffd34d })
      );
      marker.position.set(x + 8, 2.6, z + 8);
      scene.add(marker);
      const destX = 180, destZ = 78; // the garage
      handle.update = () => {
        if (handle.done) return;
        const px = G.player.x, pz = G.player.z;
        if (!handle.pickedUp) {
          if (Math.hypot(px - (x + 8), pz - (z + 8)) < 4.5 && G.player.car) {
            handle.pickedUp = true;
            scene.remove(mesh);
            scene.remove(marker);
            handle.target = { x: destX, z: destZ };
            G.message('Passenger aboard — take them to the garage.');
            G.audio.chime();
          }
        } else if (Math.hypot(px - destX, pz - destZ) < 6) {
          handle.done = true;
          G.cash += 60;
          G.message('Fare delivered — $60');
          G.audio.chime();
        }
      };
      handle.cleanup = () => { scene.remove(mesh); scene.remove(marker); };
      handle._update = handle.update;
      return handle;
    },

    update(dt, t) {
      // Tokens spin and get collected.
      for (const tok of this.tokens) {
        if (tok.taken) continue;
        tok.mesh.rotation.y += dt * 2.5;
        tok.mesh.position.y = 1.4 + Math.sin(t * 2 + tok.x) * 0.2;
        if (Math.hypot(G.player.x - tok.x, G.player.z - tok.z) < 2.5) {
          tok.taken = true;
          scene.remove(tok.mesh);
          this.tokensCollected++;
          G.cash += 25;
          G.message(`Meridian token ${this.tokensCollected}/12 — $25`);
          G.audio.token();
          if (this.tokensCollected >= 12) {
            G.cash += 500;
            G.message('All 12 tokens! Bonus $500');
            G.audio.missionComplete();
          }
          G.hud.refresh();
          G.save();
        }
      }
      // Taxi fare logic.
      if (this.fare) {
        const f = this.fare;
        f.marker.rotation.y += dt * 2;
        if (!f.pickedUp) {
          if (G.player.car && Math.hypot(G.player.x - f.x, G.player.z - f.z) < 4) {
            f.pickedUp = true;
            f.timer = 0;
            f.tripStart = Math.hypot(f.x - f.destX, f.z - f.destZ);
            scene.remove(f.passengerMesh);
            scene.remove(f.marker);
            // Gold destination marker.
            const dm = new THREE.Mesh(
              new THREE.CylinderGeometry(2, 2, 22, 12, 1, true),
              new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
            );
            dm.position.set(f.destX, 11, f.destZ);
            scene.add(dm);
            f.destMarker = dm;
            G.message('Passenger aboard — follow the gold marker.');
            G.audio.chime();
          }
        } else {
          f.timer += dt;
          if (Math.hypot(G.player.x - f.destX, G.player.z - f.destZ) < 5) {
            const dist = f.tripStart;
            const pay = 30 + Math.round(dist / 10) * 2 + (f.timer < f.parTime ? 20 : 0);
            G.cash += pay;
            G.message(`Fare delivered — $${pay}`);
            G.audio.chime();
            scene.remove(f.destMarker);
            this.fare = null;
            this.fareCooldown = 4;
            G.hud.refresh();
            G.save();
          }
        }
      } else {
        this.fareCooldown -= dt;
        if (this.fareCooldown <= 0) this.spawnFare();
      }
      // Story taxi stages tick here.
      if (G.missions?.taxiStage) G.missions.taxiStage._update?.();
      // Courier runs: a dispatch marker appears, collect and deliver in time.
      this.courierCooldown -= dt;
      if (!this.courier && this.courierCooldown <= 0) {
        const cx = [-180, -120, -60, 0, 60, 120, 180][Math.floor(rng() * 7)];
        const cz = [-180, -120, -60, 0, 60, 120, 180][Math.floor(rng() * 7)];
        const dx = [-180, -120, -60, 0, 60, 120, 180][Math.floor(rng() * 7)];
        const dz = [-180, -120, -60, 0, 60, 120, 180][Math.floor(rng() * 7)];
        const marker = new THREE.Mesh(
          new THREE.CylinderGeometry(2.4, 2.4, 16, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x37e0ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
        );
        marker.position.set(cx, 8, cz);
        scene.add(marker);
        const dist = Math.hypot(dx - cx, dz - cz);
        this.courier = { x: cx, z: cz, destX: dx, destZ: dz, pickedUp: false, timer: 45 + dist / 4, marker, dist };
        G.message('Courier dispatch: a package is waiting — grab it!');
      }
      if (this.courier) {
        const c = this.courier;
        c.timer -= dt;
        c.marker.rotation.y += dt;
        if (!c.pickedUp && Math.hypot(G.player.x - c.x, G.player.z - c.z) < 4) {
          c.pickedUp = true;
          c.marker.position.set(c.destX, 8, c.destZ);
          G.message('Package collected — deliver it before the timer runs out!');
          G.audio.chime();
        } else if (c.pickedUp && Math.hypot(G.player.x - c.destX, G.player.z - c.destZ) < 5) {
          const pay = 60 + Math.round(c.dist / 10) * 2;
          G.cash += pay;
          G.message(`Courier run done — $${pay}`);
          G.audio.chime();
          scene.remove(c.marker);
          this.courier = null;
          this.courierCooldown = 25;
          G.hud.refresh();
          G.save();
        } else if (c.timer <= 0) {
          G.message('Courier run expired.');
          scene.remove(c.marker);
          this.courier = null;
          this.courierCooldown = 25;
        }
      }
    },

    fareText() {
      if (!this.fare) return '';
      const f = this.fare;
      if (!f.pickedUp) return 'TAXI: a fare is waiting — drive to the gold marker';
      const pay = 30 + Math.round(f.tripStart / 10) * 2;
      return `TAXI: drop off the fare — $${pay}${f.timer < f.parTime ? ' (+$20 fast bonus)' : ''}`;
    },
  };
  return side;
}
