// Port Meridian — wanted level, police cars, foot officers, busted/wasted.
// Police chase with a capped turn rate, flash red/blue, ram on foot or in a
// car, and always use the building push-out so they never clip a corner.
import * as THREE from 'three';
import { makeCar, syncCarMesh } from './vehicles.js';
import { makePersonMesh } from './people.js';
import { clamp, mulberry32 } from './util.js';

export function makePolice(city, scene, G) {
  const rng = mulberry32(23);
  const police = {
    wanted: 0,
    cars: [],
    officers: [],
    quietTimer: 0,
    hiddenTimer: 0,
    flashT: 0,
    addCrime(level, msg) {
      this.wanted = clamp(this.wanted + level, 0, 5);
      this.quietTimer = 0;
      this.hiddenTimer = 0;
      if (msg) G.message(msg);
      G.audio.siren(this.wanted > 0);
      G.hud.refresh();
    },
    spawnPoliceCar() {
      const ang = rng() * Math.PI * 2;
      const d = 55 + rng() * 20;
      const x = clamp(G.player.x + Math.cos(ang) * d, -230, 230);
      const z = clamp(G.player.z + Math.sin(ang) * d, -230, 230);
      const car = makeCar('police', 0x2a3a52, x, z, 0, true);
      car.mesh.position.set(x, 0, z);
      scene.add(car.mesh);
      this.cars.push(car);
      return car;
    },
    spawnOfficer() {
      const ang = rng() * Math.PI * 2;
      const x = clamp(G.player.x + Math.cos(ang) * 22, -230, 230);
      const z = clamp(G.player.z + Math.sin(ang) * 22, -230, 230);
      const mesh = makePersonMesh(0x1a2a5a, 0xe8b88a, 1.85, { cap: true, pants: 0x1a2a5a });
      const off = { mesh, x, z, heading: 0, speed: 6.5, alive: true, isOfficer: true };
      mesh.position.set(x, 0, z);
      scene.add(mesh);
      this.officers.push(off);
      return off;
    },
    clearAll() {
      for (const c of this.cars) scene.remove(c.mesh);
      for (const o of this.officers) scene.remove(o.mesh);
      this.cars = [];
      this.officers = [];
    },
    bust() {
      G.cash = Math.max(0, G.cash - 200);
      G.message('BUSTED! Fine $200');
      G.audio.busted();
      this.wanted = 0;
      this.clearAll();
      G.player.health = 100;
      G.respawnAtGarage();
      G.showGameOver('BUSTED', 'The harbour police caught you. Fine: $200.');
    },
    wasted() {
      G.cash = Math.max(0, G.cash - 150);
      G.message('WASTED! Fine $150');
      G.audio.busted();
      this.wanted = 0;
      this.clearAll();
      G.player.health = 100;
      G.respawnAtGarage();
      G.showGameOver('WASTED', 'Mara is down. Fine: $150.');
    },
    update(dt, t) {
      // Spawn police cars up to the wanted level (capped at 3).
      const wantCars = Math.min(this.wanted, 3);
      while (this.cars.length < wantCars) this.spawnPoliceCar();
      while (this.cars.length > wantCars) {
        const c = this.cars.pop();
        scene.remove(c.mesh);
      }
      // Foot officers when wanted >= 2 and the player is on foot.
      const wantOfficers = this.wanted >= 2 && !G.player.car ? Math.min(2, this.wanted - 1) : 0;
      while (this.officers.length < wantOfficers) this.spawnOfficer();
      while (this.officers.length > wantOfficers) {
        const o = this.officers.pop();
        scene.remove(o.mesh);
      }
      this.flashT += dt;
      const flashOn = Math.sin(this.flashT * 10) > 0;
      for (const car of this.cars) {
        // Chase: steer toward the player with a capped turn rate.
        const targetHeading = Math.atan2(G.player.x - car.x, G.player.z - car.z);
        let diff = targetHeading - car.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        car.heading += clamp(diff, -1.9 * dt, 1.9 * dt);
        car.speed = Math.min(car.speed + 9 * dt, 19);
        car.x += Math.sin(car.heading) * car.speed * dt;
        car.z += Math.cos(car.heading) * car.speed * dt;
        city.pushOut(car, 1.6);
        city.clampToMap(car, 6);
        syncCarMesh(car);
        const bar = car.mesh.userData.lightBar;
        if (bar) {
          bar.userData.rBar.material.emissiveIntensity = flashOn ? 3 : 0.4;
          bar.userData.bBar.material.emissiveIntensity = flashOn ? 0.4 : 3;
        }
        // Ram / bust by proximity.
        const d = Math.hypot(G.player.x - car.x, G.player.z - car.z);
        if (d < 4) {
          if (G.player.car) {
            if (G.player.car.speed < 2) {
              G.player.health -= 25 * dt;
              G.hud.flashDamage();
            }
            G.player.car.speed *= 0.94;
            G.shake(0.25);
          } else if (G.player.speed < 3) {
            G.player.health -= 22 * dt;
            G.hud.flashDamage();
          }
        }
        if (d < 2.6 && G.player.car) {
          G.player.car.health -= 12 * dt;
          G.audio.crash();
        }
      }
      for (const o of this.officers) {
        const dx = G.player.x - o.x, dz = G.player.z - o.z;
        const d = Math.hypot(dx, dz) || 1;
        o.heading = Math.atan2(dx / d, dz / d);
        o.x += (dx / d) * o.speed * dt;
        o.z += (dz / d) * o.speed * dt;
        city.pushOut(o, 0.6);
        o.mesh.position.set(o.x, 0, o.z);
        o.mesh.rotation.y = o.heading;
        const swing = Math.sin(t * 14 + o.x) * 0.5;
        o.mesh.userData.legL.rotation.x = swing;
        o.mesh.userData.legR.rotation.x = -swing;
        if (d < 3.5 && !G.player.car) {
          G.player.health -= 22 * dt;
          G.hud.flashDamage();
        }
      }
      // Wanted decays only after a quiet period with no police nearby.
      if (this.wanted > 0) {
        let near = false;
        for (const c of this.cars) {
          if (Math.hypot(G.player.x - c.x, G.player.z - c.z) < 45) { near = true; break; }
        }
        if (!near && this.officers.length === 0) {
          this.quietTimer += dt;
          if (this.quietTimer > 20) {
            this.hiddenTimer += dt;
            if (this.hiddenTimer > 6) {
              this.hiddenTimer = 0;
              this.quietTimer = 0;
              this.wanted--;
              G.message('Heat is cooling off…');
              G.audio.siren(this.wanted > 0);
              G.hud.refresh();
            }
          }
        } else {
          this.quietTimer = 0;
          this.hiddenTimer = 0;
        }
      }
      if (G.player.health <= 0) {
        if (this.wanted > 0 && this.cars.length > 0) this.bust();
        else this.wasted();
      }
    },
  };
  return police;
}
