// Port Meridian — the city: golden-hour sky, procedural blocks, beach and
// harbour, props, traffic lights, and the collision helpers every moving
// thing uses (player, cars, traffic, police, officers, pedestrians).
import * as THREE from 'three';
import { MAP_HALF, ROAD_LINES, ROAD_STEP, ROAD_WIDTH, clamp, mulberry32 } from './util.js';

const PALETTE = [0x8a8f96, 0x7d8a99, 0xb09a7a, 0x9a7f8a, 0x6f7d8a, 0xa89a8a, 0x8f8578, 0x7a8a9a];
const NEON_NAMES = ['MERIDIAN', 'HARBOUR', 'PIER 9', "DARIO'S", 'TACOS', 'HOTEL'];
const NEON_COLORS = ['#ff5fa2', '#37e0ff', '#ffd34d', '#ff5fa2', '#37e0ff', '#ffd34d'];

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Three window textures so buildings do not all read the same.
function windowTexture(kind, rng) {
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3a3f46';
    ctx.fillRect(0, 0, w, h);
    const cols = 6, rows = 12;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const roll = rng();
        let lit = false, warm = true;
        if (kind === 'warm') lit = roll < 0.45;
        else if (kind === 'cool') { lit = roll < 0.35; warm = false; }
        else { lit = roll < 0.4; warm = roll < 0.6; }
        if (lit) ctx.fillStyle = warm ? '#ffd98a' : '#9fc4ff';
        else ctx.fillStyle = roll < 0.5 ? '#232830' : '#2e3440';
        ctx.fillRect(6 + c * 20, 8 + r * 20, 13, 12);
      }
    }
  });
}

function neonTexture(text, color) {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 34px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
}

function billboardTexture(text, bg, fg) {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = fg;
    const words = text.split(' ');
    ctx.fillText(words[0], w / 2, h / 2 - 16);
    if (words[1]) ctx.fillText(words.slice(1).join(' '), w / 2, h / 2 + 18);
  });
}

export function buildCity(scene, seed = 1) {
  const rng = mulberry32(seed);
  const city = {
    colliders: [], // {minX,maxX,minZ,maxZ}
    trafficLights: [], // {x,z,state,offset,mesh:{r,y,g}}
    water: null,
    sun: null,
    skyMat: null,
    buildings: [],
    towerPos: { x: 0, z: -210 },
    garagePos: { x: 180, z: 90 },
    pierPos: { x: -60, z: 235 },
    beachCratePos: { x: -120, z: 195 },
    westDocksPos: { x: -210, z: 60 },
  };

  // ---- sky, fog, lights -------------------------------------------------
  const skyTex = canvasTexture(512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7fa8d8');
    g.addColorStop(0.45, '#c9c2d8');
    g.addColorStop(0.72, '#f7c98a');
    g.addColorStop(1, '#ffb36b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Sun disc glow near the horizon.
    const sx = w * 0.68, sy = h * 0.72;
    const rg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 90);
    rg.addColorStop(0, 'rgba(255,236,190,1)');
    rg.addColorStop(0.25, 'rgba(255,200,120,0.85)');
    rg.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
  });
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false });
  city.skyMat = skyMat;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat);
  scene.add(sky);

  scene.fog = new THREE.Fog(0x9a7a8a, 160, 520);
  const sun = new THREE.DirectionalLight(0xffc27a, 1.9);
  sun.position.set(-140, 90, 120);
  scene.add(sun);
  city.sun = sun;
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a4636, 1.25);
  scene.add(hemi);

  // ---- ground, roads, beach, water --------------------------------------
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x7a7f86, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2 + 120, MAP_HALF * 2 + 120), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 30);
  scene.add(ground);

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x5d636e, roughness: 0.95 });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8c98a });
  for (const line of ROAD_LINES) {
    // North-south road.
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, MAP_HALF * 2), roadMat);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(line, 0.02, 0);
    scene.add(ns);
    const ew = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2, ROAD_WIDTH), roadMat);
    ew.rotation.x = -Math.PI / 2;
    ew.position.set(0, 0.02, line);
    scene.add(ew);
    // Centre dashes.
    for (let t = -MAP_HALF + 15; t < MAP_HALF; t += 30) {
      const d1 = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 8), dashMat);
      d1.rotation.x = -Math.PI / 2;
      d1.position.set(line, 0.04, t);
      scene.add(d1);
      const d2 = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.6), dashMat);
      d2.rotation.x = -Math.PI / 2;
      d2.position.set(t, 0.04, line);
      scene.add(d2);
    }
  }

  // Beach sand strip along the south edge (z 200..240), then water.
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_HALF * 2, 44),
    new THREE.MeshStandardMaterial({ color: 0xd9c08a, roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.03, 220);
  scene.add(sand);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2f7fa8, roughness: 0.25, metalness: 0.1,
    transparent: true, opacity: 0.88,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(MAP_HALF * 2 + 200, 140), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.15, 310);
  scene.add(water);
  city.water = water;

  // Wooden pier reaching into the water at the harbour.
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 1 });
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 8), woodMat);
    plank.position.set(city.pierPos.x, 0.6, 242 + i * 8);
    scene.add(plank);
    for (const sx of [-4, 4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6), woodMat);
      post.position.set(city.pierPos.x + sx, 0.2, 242 + i * 8);
      scene.add(post);
    }
  }

  // ---- buildings ----------------------------------------------------------
  const winTex = [windowTexture('warm', rng), windowTexture('cool', rng), windowTexture('mixed', rng)];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  let neonIdx = 0;
  const addBuilding = (cx, cz, w, d, h, opts = {}) => {
    const tex = opts.tex ?? winTex[Math.floor(rng() * 3)];
    const mat = new THREE.MeshStandardMaterial({
      color: opts.color ?? PALETTE[Math.floor(rng() * PALETTE.length)],
      roughness: 0.9, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55,
      map: opts.plain ? null : tex,
    });
    const b = new THREE.Mesh(boxGeo, mat);
    b.scale.set(w, h, d);
    b.position.set(cx, h / 2, cz);
    scene.add(b);
    city.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    city.buildings.push(b);
    // Parapet rim.
    const rim = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x3c4048, roughness: 1 }));
    rim.scale.set(w + 0.6, 0.7, d + 0.6);
    rim.position.set(cx, h + 0.35, cz);
    scene.add(rim);
    // Rooftop props on ~40% of roofs.
    if (rng() < 0.4) {
      const ac = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.8 }));
      ac.scale.set(Math.min(4, w * 0.3), 1.6, Math.min(4, d * 0.3));
      ac.position.set(cx + (rng() - 0.5) * w * 0.4, h + 1.1, cz + (rng() - 0.5) * d * 0.4);
      scene.add(ac);
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 8),
        new THREE.MeshStandardMaterial({ color: 0x777d85 }));
      vent.position.set(cx - w * 0.25, h + 1.4, cz - d * 0.25);
      scene.add(vent);
    }
    // Set-back upper floor on some tall buildings.
    if (h > 30 && rng() < 0.5) {
      const top = new THREE.Mesh(boxGeo, mat);
      top.scale.set(w * 0.55, 8, d * 0.55);
      top.position.set(cx, h + 4, cz);
      scene.add(top);
    }
    // Neon sign on six buildings.
    if (opts.neon) {
      const name = NEON_NAMES[neonIdx % NEON_NAMES.length];
      const color = NEON_COLORS[neonIdx % NEON_COLORS.length];
      neonIdx++;
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(18, w * 0.9), 4.5),
        new THREE.MeshBasicMaterial({ map: neonTexture(name, color), transparent: true })
      );
      sign.position.set(cx, h - 2.5, cz + d / 2 + 0.15);
      scene.add(sign);
    }
    return b;
  };

  // Meridian Tower — tallest building, blue glass, pink neon, north end.
  addBuilding(city.towerPos.x, city.towerPos.z, 26, 26, 50, { color: 0x4a7fb5, neon: true, tex: winTex[1] });

  // City blocks: block centres sit at grid lines + 30.
  const blockCentres = [];
  for (let i = 0; i < 7; i++) {
    for (let j = 0; j < 7; j++) {
      blockCentres.push({ x: -210 + i * 60, z: -210 + j * 60 });
    }
  }
  for (const bc of blockCentres) {
    // Skip the beach row, the tower block, and the garage block (garage is its own prop).
    if (bc.z >= 180) continue;
    if (Math.abs(bc.x - city.towerPos.x) < 30 && Math.abs(bc.z - city.towerPos.z) < 30) continue;
    const two = rng() < 0.55;
    if (two) {
      const w1 = 12 + rng() * 10, d1 = 12 + rng() * 10;
      addBuilding(bc.x - 11, bc.z - 8, w1, d1, 8 + rng() * 34, { neon: neonIdx < 6 && rng() < 0.25 });
      const w2 = 12 + rng() * 10, d2 = 12 + rng() * 10;
      addBuilding(bc.x + 11, bc.z + 9, w2, d2, 8 + rng() * 40, { neon: neonIdx < 6 && rng() < 0.25 });
    } else {
      addBuilding(bc.x, bc.z, 16 + rng() * 12, 16 + rng() * 12, 10 + rng() * 40, { neon: neonIdx < 6 && rng() < 0.3 });
    }
  }

  // Garage (east side) — low building with a big door, the respawn point.
  const garageMat = new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.9 });
  const garage = new THREE.Mesh(boxGeo, garageMat);
  garage.scale.set(20, 7, 14);
  garage.position.set(city.garagePos.x, 3.5, city.garagePos.z);
  scene.add(garage);
  city.colliders.push({
    minX: city.garagePos.x - 10, maxX: city.garagePos.x + 10,
    minZ: city.garagePos.z - 7, maxZ: city.garagePos.z + 7,
  });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(10, 5),
    new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7 }));
  door.position.set(city.garagePos.x, 2.6, city.garagePos.z - 7.1);
  door.rotation.y = Math.PI;
  scene.add(door);

  // ---- distant skyline ring ------------------------------------------------
  const skyMat2 = new THREE.MeshBasicMaterial({ color: 0x4a4450 });
  for (let i = 0; i < 44; i++) {
    const ang = (i / 44) * Math.PI * 2 + rng() * 0.12;
    const r = 300 + rng() * 120;
    const h = 30 + rng() * 90 + (Math.cos(ang) < -0.3 ? 40 : 0); // taller toward the north
    const s = new THREE.Mesh(boxGeo, skyMat2);
    const w = 14 + rng() * 18;
    s.scale.set(w, h, w);
    s.position.set(Math.cos(ang) * r, h / 2, Math.sin(ang) * r + 20);
    scene.add(s);
  }

  // ---- props ---------------------------------------------------------------
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f8a4a, roughness: 1 });
  const addPalm = (x, z) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 7, 6), trunkMat);
    trunk.position.set(x, 3.5, z);
    scene.add(trunk);
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.5, 4), leafMat);
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(x + Math.cos(a) * 1.4, 7.2, z + Math.sin(a) * 1.4);
      leaf.rotation.z = Math.cos(a) * 1.1;
      leaf.rotation.x = -Math.sin(a) * 1.1;
      scene.add(leaf);
    }
  };
  for (let x = -225; x <= 225; x += 30) addPalm(x, 196);
  for (let x = -200; x <= 200; x += 80) addPalm(x + 12, 205);

  // Beach umbrellas.
  const umbMat = new THREE.MeshStandardMaterial({ color: 0xff7a5a, roughness: 0.9 });
  for (const [x, z] of [[-150, 212], [-40, 218], [90, 210], [170, 216]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3, 6), trunkMat);
    pole.position.set(x, 1.5, z);
    scene.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(3, 1.6, 8), umbMat);
    top.position.set(x, 3.6, z);
    scene.add(top);
  }

  // Streetlights at intersections, benches, hydrants, planters, bus stops.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.6, metalness: 0.4 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd98a, emissiveIntensity: 1.2 });
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 1 });
  const hydMat = new THREE.MeshStandardMaterial({ color: 0xc03028, roughness: 0.7 });
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 1 });
  const addStreetlight = (x, z) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 6, 6), poleMat);
    pole.position.set(x, 3, z);
    scene.add(pole);
    const arm = new THREE.Mesh(boxGeo, poleMat);
    arm.scale.set(2.4, 0.25, 0.25);
    arm.position.set(x + 1, 5.9, z);
    scene.add(arm);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), lampMat);
    head.position.set(x + 2.1, 5.8, z);
    scene.add(head);
  };
  for (const [x, z] of [[-180, -180], [-60, -60], [60, 60], [180, -120], [-120, 120], [120, 180], [0, -60], [-60, 180]]) {
    addStreetlight(x + 7, z + 7);
  }
  for (let i = 0; i < 14; i++) {
    const bx = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)] + 8;
    const bz = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)] + 8;
    if (bz >= 190) continue;
    const bench = new THREE.Mesh(boxGeo, benchMat);
    bench.scale.set(3, 0.5, 1);
    bench.position.set(bx, 0.6, bz);
    scene.add(bench);
  }
  for (let i = 0; i < 12; i++) {
    const hx = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)] - 8;
    const hz = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)] - 8;
    if (hz >= 190) continue;
    const hyd = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 1.1, 8), hydMat);
    hyd.position.set(hx, 0.55, hz);
    scene.add(hyd);
  }
  for (let i = 0; i < 10; i++) {
    const px = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)] + 8;
    const pz = ROAD_LINES[Math.floor(rng() * ROAD_LINES.length)] - 8;
    if (pz >= 190) continue;
    const planter = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 1 }));
    planter.scale.set(2, 1, 2);
    planter.position.set(px, 0.5, pz);
    scene.add(planter);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), plantMat);
    bush.position.set(px, 1.4, pz);
    scene.add(bush);
  }
  // Bus stops.
  for (const [x, z] of [[-60, 67], [120, -53], [60, 127]]) {
    const shelter = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x3a6a8a, roughness: 0.8 }));
    shelter.scale.set(5, 0.3, 2);
    shelter.position.set(x, 2.6, z);
    scene.add(shelter);
    for (const sx of [-2.2, 2.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.6, 6), poleMat);
      post.position.set(x + sx, 1.3, z);
      scene.add(post);
    }
  }
  // Billboards with original text.
  const billboards = [
    ['VISIT MERIDIAN', '#204060', '#ffd34d', -180, -53],
    ['PIER 9 SEAFOOD', '#5a2040', '#ffffff', 60, -113],
    ['TACOS TACOS', '#7a3a10', '#ffe9a8', 180, 67],
  ];
  for (const [text, bg, fg, x, z] of billboards) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 7),
      new THREE.MeshBasicMaterial({ map: billboardTexture(text, bg, fg) }));
    board.position.set(x, 9, z);
    scene.add(board);
    for (const sx of [-5, 5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 6), poleMat);
      post.position.set(x + sx, 3, z);
      scene.add(post);
    }
  }

  // ---- traffic lights -------------------------------------------------------
  const lightCols = { red: 0xff3020, yellow: 0xffc020, green: 0x30ff60 };
  const tlPositions = [[-120, -120], [0, 0], [120, 120], [-60, 60], [60, -60], [180, 0]];
  for (const [x, z] of tlPositions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 6.5, 6), poleMat);
    pole.position.set(x + 7, 3.25, z + 7);
    scene.add(pole);
    const box = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6 }));
    box.scale.set(1, 2.6, 1);
    box.position.set(x + 7, 6.8, z + 7);
    scene.add(box);
    const lamps = {};
    const ys = { red: 7.7, yellow: 6.8, green: 5.9 };
    for (const [name, y] of Object.entries(ys)) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6),
        new THREE.MeshBasicMaterial({ color: lightCols[name] }));
      s.position.set(x + 7, y, z + 7.6);
      scene.add(s);
      lamps[name] = s;
    }
    city.trafficLights.push({ x, z, offset: rng() * 13.5, lamps });
  }

  // ---- collision helpers ----------------------------------------------------
  city.pushOut = (pos, r) => {
    // pos is {x, z}; pushes it out of every overlapping building AABB.
    for (const b of city.colliders) {
      if (pos.x > b.minX - r && pos.x < b.maxX + r && pos.z > b.minZ - r && pos.z < b.maxZ + r) {
        const dxl = pos.x - (b.minX - r);
        const dxr = (b.maxX + r) - pos.x;
        const dzl = pos.z - (b.minZ - r);
        const dzr = (b.maxZ + r) - pos.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) pos.x = b.minX - r;
        else if (m === dxr) pos.x = b.maxX + r;
        else if (m === dzl) pos.z = b.minZ - r;
        else pos.z = b.maxZ + r;
      }
    }
  };
  city.clampToMap = (pos, margin = 4) => {
    pos.x = clamp(pos.x, -MAP_HALF + margin, MAP_HALF - margin);
    pos.z = clamp(pos.z, -MAP_HALF + margin, MAP_HALF + 26);
  };
  city.update = (dt, t, timeOfDay) => {
    // Traffic light cycle: green 6s, yellow 1.5s, red 6s.
    for (const tl of city.trafficLights) {
      const phase = (t + tl.offset) % 13.5;
      const state = phase < 6 ? 'green' : phase < 7.5 ? 'yellow' : 'red';
      tl.lamps.red.material.color.setHex(state === 'red' ? 0xff3020 : 0x401512);
      tl.lamps.yellow.material.color.setHex(state === 'yellow' ? 0xffc020 : 0x403012);
      tl.lamps.green.material.color.setHex(state === 'green' ? 0x30ff60 : 0x123018);
      tl.state = state;
    }
    // Water gently pulses.
    if (city.water) {
      city.water.material.opacity = 0.84 + Math.sin(t * 0.7) * 0.05;
      city.water.position.y = 0.15 + Math.sin(t * 0.5) * 0.05;
    }
    // Dusk drift after 18:30.
    if (timeOfDay > 18.5) {
      const k = clamp((timeOfDay - 18.5) / 1.5, 0, 1);
      sun.intensity = 1.7 - k * 0.9;
      sun.color.setHex(0xffc27a).lerp(new THREE.Color(0xff8a5a), k);
    }
  };
  return city;
}
