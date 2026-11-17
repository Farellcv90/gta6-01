// Port Meridian — seven chained story missions. Each mission has two or
// three stages; stage kinds: goto, drive, deliver, chase, escape, taxi, race.
// Completing a mission pays cash, plays a chime, advances and saves.
import * as THREE from 'three';
import { makeCar } from './vehicles.js';
import { clamp } from './util.js';

export const MISSIONS = [
  {
    name: 'First Run', reward: 150,
    briefing: 'Drive to the Meridian Tower and deliver the package.',
    dialogue: "Dario: 'First job, Mara. Package to the Tower. No questions, no stops.'",
    stages: [
      { kind: 'drive', text: 'Drive to the Meridian Tower', x: 0, z: -195 },
      { kind: 'deliver', text: 'Deliver the package at the Tower', x: 0, z: -195 },
    ],
  },
  {
    name: 'Harbour Pickup', reward: 250,
    briefing: 'Collect a crate on the beach promenade, bring it to the garage.',
    dialogue: "Dario: 'Crate washed up by the promenade. Grab it before the Kestrels do.'",
    stages: [
      { kind: 'goto', text: 'Collect the crate on the promenade', x: -120, z: 195 },
      { kind: 'goto', text: 'Bring the crate to the garage', x: 180, z: 78 },
    ],
  },
  {
    name: 'Tail the Courier', reward: 400,
    briefing: 'Ram the rival courier\'s purple car until it stops, then report back.',
    dialogue: "Dario: 'A Kestrel courier is running our route. Stop his car. Gently is optional.'",
    stages: [
      { kind: 'chase', text: 'Ram the purple courier car until it stops', x: -60, z: 0 },
      { kind: 'goto', text: 'Report back at the garage', x: 180, z: 78 },
    ],
  },
  {
    name: 'Hot Pursuit', reward: 500,
    briefing: 'The police spotted the getaway! Survive the heat for 25 seconds, then lay low.',
    dialogue: "Dario: 'They made the car! Lose them, Mara — twenty-five seconds and you are clear.'",
    stages: [
      { kind: 'escape', text: 'Survive the heat — 25 seconds', timer: 25, x: 0, z: 0 },
      { kind: 'goto', text: 'Lay low at the garage', x: 180, z: 78 },
    ],
  },
  {
    name: 'Fare Game', reward: 350,
    briefing: 'Taxi work as a story job: pick up two fares across town.',
    dialogue: "Dario: 'Even a fixer needs a cover. Two fares, on the meter. Smile.'",
    stages: [
      { kind: 'taxi', text: 'Pick up the first fare', x: -120, z: -60 },
      { kind: 'taxi', text: 'Pick up the second fare', x: 120, z: -120 },
    ],
  },
  {
    name: 'Meridian Grand Prix', reward: 600,
    briefing: 'A timed checkpoint race: five gold rings across the city in 75 seconds.',
    dialogue: "Dario: 'The Grand Prix is tonight and our driver bailed. Five rings, seventy-five seconds.'",
    stages: [
      { kind: 'race', text: 'Race through the five rings', timer: 75,
        rings: [[-120, -120], [60, -180], [180, 60], [-60, 180], [0, 0]] },
    ],
  },
  {
    name: 'The Last Delivery', reward: 1000,
    briefing: 'Collect a package at the west docks and deliver it to the harbour pier while wanted is 4.',
    dialogue: "Dario: 'One last run and you are free, Mara. West docks, then the pier. The whole harbour is watching.'",
    stages: [
      { kind: 'goto', text: 'Collect the package at the west docks', x: -210, z: 60 },
      { kind: 'deliver', text: 'Deliver it to the harbour pier', x: -60, z: 232 },
    ],
  },
];

export function makeMissions(scene, G) {
  // Gold beacon: tall cylinder + pulsing ground ring at the objective.
  const beaconMat = new THREE.MeshBasicMaterial({
    color: 0xffd34d, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
  });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 30, 16, 1, true), beaconMat);
  beacon.position.y = 15;
  scene.add(beacon);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.1;
  scene.add(ring);
  beacon.visible = false;
  ring.visible = false;

  const rival = { car: null, hp: 60 };
  const race = { ringIdx: 0, markers: [] };

  const missions = {
    index: 0,
    stage: 0,
    done: false,
    stageTimer: 0,
    stageData: null,
    target: null, // {x, z} for the minimap + beacon
    taxiStage: null,

    current() { return MISSIONS[this.index]; },
    stageDef() { return MISSIONS[this.index]?.stages[this.stage]; },

    startMission(idx, stageIdx = 0) {
      this.index = idx;
      this.stage = stageIdx;
      this.done = false;
      this.stageData = null;
      this.taxiStage = null;
      this.clearRaceMarkers();
      if (rival.car) { scene.remove(rival.car.mesh); rival.car = null; }
      // Mission 4 (index 3): the police are called in the moment it starts.
      if (idx === 3 && stageIdx === 0) {
        G.police.wanted = 3;
        G.message('The police spotted the getaway!');
        G.audio.siren(true);
      }
      // Mission 7 (index 6): the heat is on for the last delivery.
      if (idx === 6 && stageIdx === 0) {
        G.police.wanted = Math.max(G.police.wanted, 4);
        G.message('Wanted level 4 — the whole harbour is watching!');
        G.audio.siren(true);
      }
      this.setupStage();
      G.hud.refresh();
      G.save();
    },

    setupStage() {
      const def = this.stageDef();
      if (!def) { this.target = null; beacon.visible = false; ring.visible = false; return; }
      this.stageTimer = def.timer ?? 0;
      this.stageData = {};
      if (def.kind === 'chase') {
        // Spawn the rival courier's purple car near the stage point.
        rival.car = makeCar('sedan', 0x8a4ad8, def.x, def.z, Math.PI / 2);
        rival.hp = 60;
        rival.car.mesh.position.set(def.x, 0, def.z);
        scene.add(rival.car.mesh);
        this.target = { x: def.x, z: def.z };
      } else if (def.kind === 'race') {
        race.ringIdx = 0;
        this.clearRaceMarkers();
        for (const [rx, rz] of def.rings) {
          const m = new THREE.Mesh(
            new THREE.TorusGeometry(3.2, 0.35, 10, 24),
            new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.9 })
          );
          m.position.set(rx, 2.2, rz);
          m.rotation.y = Math.PI / 2;
          scene.add(m);
          race.markers.push(m);
        }
        this.target = { x: def.rings[0][0], z: def.rings[0][1] };
      } else if (def.kind === 'taxi') {
        this.taxiStage = G.side.startStoryTaxi(def.x, def.z);
        this.target = { x: def.x, z: def.z };
      } else if (def.kind === 'escape') {
        this.target = { x: G.player.x, z: G.player.z };
      } else {
        this.target = { x: def.x, z: def.z };
      }
      if (this.target) {
        beacon.position.set(this.target.x, 15, this.target.z);
        ring.position.set(this.target.x, 0.1, this.target.z);
        beacon.visible = true;
        ring.visible = true;
      }
    },

    clearRaceMarkers() {
      for (const m of race.markers) scene.remove(m);
      race.markers = [];
    },

    completeStage() {
      const def = this.stageDef();
      if (def?.kind === 'chase' && rival.car) {
        scene.remove(rival.car.mesh);
        rival.car = null;
      }
      if (def?.kind === 'race') this.clearRaceMarkers();
      this.stage++;
      if (this.stage >= this.current().stages.length) {
        this.completeMission();
      } else {
        G.audio.chime();
        this.setupStage();
        G.hud.refresh();
        G.save();
      }
    },

    completeMission() {
      const m = this.current();
      G.cash += m.reward;
      G.message(`Mission complete: ${m.name} — $${m.reward}`);
      G.audio.missionComplete();
      beacon.visible = false;
      ring.visible = false;
      this.index++;
      this.stage = 0;
      if (this.index >= MISSIONS.length) {
        this.done = true;
        this.target = null;
        G.message('Story complete — Mara is free! Total earned $3,250');
        G.save();
        G.hud.refresh();
        return;
      }
      this.startMission(this.index, 0);
    },

    failRace() {
      G.message('Out of time — the race is lost. Replay the mission to try again.');
      G.audio.busted();
      this.startMission(this.index, 0);
    },

    replay() {
      // Reset the current mission to its first stage, clear the heat,
      // respawn at the garage.
      G.police.wanted = 0;
      G.police.clearAll();
      G.audio.siren(false);
      G.respawnAtGarage();
      this.startMission(this.index, 0);
      G.message(`Replaying: ${this.current().name}`);
    },

    update(dt, t) {
      if (this.done || !this.current()) { beacon.visible = false; ring.visible = false; return; }
      const def = this.stageDef();
      if (!def) return;
      // Pulse the beacon.
      const pulse = 1 + Math.sin(t * 3) * 0.15;
      beaconMat.opacity = 0.32 + Math.sin(t * 3) * 0.1;
      ring.scale.setScalar(pulse);
      const px = G.player.x, pz = G.player.z;
      if (def.kind === 'goto' || def.kind === 'drive' || def.kind === 'deliver') {
        const d = Math.hypot(px - def.x, pz - def.z);
        if (d < (def.kind === 'drive' ? 8 : 5)) {
          if (def.kind === 'deliver') G.audio.fanfare();
          this.completeStage();
        }
      } else if (def.kind === 'escape') {
        this.stageTimer -= dt;
        this.target = { x: px, z: pz };
        if (this.stageTimer <= 0) this.completeStage();
      } else if (def.kind === 'chase' && rival.car) {
        // Rival drives away from the player; ramming damages it.
        const dx = rival.car.x - px, dz = rival.car.z - pz;
        const d = Math.hypot(dx, dz) || 1;
        rival.car.heading = Math.atan2(dx / d, dz / d);
        rival.car.speed = 12;
        rival.car.x += Math.sin(rival.car.heading) * rival.car.speed * dt;
        rival.car.z += Math.cos(rival.car.heading) * rival.car.speed * dt;
        G.city.pushOut(rival.car, 1.6);
        G.city.clampToMap(rival.car, 6);
        rival.car.mesh.position.set(rival.car.x, 0, rival.car.z);
        rival.car.mesh.rotation.y = rival.car.heading;
        this.target = { x: rival.car.x, z: rival.car.z };
        beacon.position.set(rival.car.x, 15, rival.car.z);
        ring.position.set(rival.car.x, 0.1, rival.car.z);
        // Ram damage: player's car touching the rival.
        if (G.player.car && d < 4.5) {
          rival.hp -= 30 * dt;
          G.shake(0.3);
          if (Math.random() < dt * 8) G.audio.crash();
        }
        if (rival.hp <= 0) {
          G.message('Courier stopped! Report back at the garage.');
          this.completeStage();
        }
      } else if (def.kind === 'taxi' && this.taxiStage) {
        if (this.taxiStage.done) this.completeStage();
        else this.target = this.taxiStage.target;
      } else if (def.kind === 'race') {
        this.stageTimer -= dt;
        const [rx, rz] = def.rings[race.ringIdx];
        this.target = { x: rx, z: rz };
        beacon.position.set(rx, 15, rz);
        ring.position.set(rx, 0.1, rz);
        const d = Math.hypot(px - rx, pz - rz);
        if (d < 4.5) {
          G.audio.chime();
          race.ringIdx++;
          if (race.ringIdx >= def.rings.length) {
            this.completeStage();
            return;
          }
          const [nx, nz] = def.rings[race.ringIdx];
          this.target = { x: nx, z: nz };
        }
        if (this.stageTimer <= 0) this.failRace();
      }
      // Keep the beacon on the current target.
      if (this.target && def.kind !== 'chase' && def.kind !== 'race') {
        beacon.position.set(this.target.x, 15, this.target.z);
        ring.position.set(this.target.x, 0.1, this.target.z);
      }
    },
  };
  return missions;
}
