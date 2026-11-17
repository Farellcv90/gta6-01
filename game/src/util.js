// Port Meridian — shared helpers: seeded random, math, and the map constants.
// Authored fresh for this entry; no code copied from any earlier build.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

// Map: 480 x 480 centred on the origin. Roads form a grid every 60 units.
export const MAP_HALF = 240;
export const ROAD_STEP = 60;
export const ROAD_LINES = [-240, -180, -120, -60, 0, 60, 120, 180, 240];
export const ROAD_WIDTH = 12;

// Nearest road line to a coordinate (roads sit on multiples of 60).
export function nearestRoad(v) {
  return Math.round(v / ROAD_STEP) * ROAD_STEP;
}
// Is a point (x,z) on a road (within the road half-width)?
export function onRoad(x, z) {
  const dx = Math.abs(x - nearestRoad(x));
  const dz = Math.abs(z - nearestRoad(z));
  return dx <= ROAD_WIDTH / 2 + 1 || dz <= ROAD_WIDTH / 2 + 1;
}
// Angle helpers.
export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}
export function dist2(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}
