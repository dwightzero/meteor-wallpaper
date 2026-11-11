// Batch-validates the seeded galaxy generator without a browser.
//
// usage: node tools/check-galaxy.mjs [count] [startSeed]
//
// Every generated system has to satisfy the constraints from HANDOVER §7.
// Exits non-zero on the first violation.

import { makeSpec } from '../src/MeteorWallpaper/wwwroot/galaxy.js';

const count = Number(process.argv[2]) || 500;
const start = Number(process.argv[3]) || 1;

const errors = [];
const stats = { planets: {}, belts: {}, stars: {} };
let minInner = Infinity;
let maxOuter = 0;
let minGapRatio = Infinity;
let maxBeltParticles = 0;

function fail(seed, msg) {
  if (errors.length < 20) errors.push(`seed ${seed}: ${msg}`);
}

for (let i = 0; i < count; i++) {
  const seed = start + i;
  const spec = makeSpec(seed);
  const again = makeSpec(seed);

  if (JSON.stringify(spec) !== JSON.stringify(again)) fail(seed, 'not deterministic');

  const planets = spec.planets;
  const n = planets.length;
  if (n < 3 || n > 5) fail(seed, `planet count ${n}`);

  const outer = planets[n - 1].r;
  if (!(outer >= 152 * 0.97 - 1e-6 && outer <= 152 * 1.05 + 1e-6)) fail(seed, `outer orbit ${outer}`);
  if (!(spec.camera.distance >= outer * 2.34 - 1e-6 && spec.camera.distance <= outer * 2.56 + 1e-6)) {
    fail(seed, `camera distance ${spec.camera.distance} vs outer ${outer}`);
  }

  const star = spec.star;
  if (!(star.radius >= 10.6 && star.radius <= 13.4)) fail(seed, `star radius ${star.radius}`);
  if (!(star.glowScale > 0.8 && star.glowScale < 1.2)) fail(seed, `glow scale ${star.glowScale}`);
  for (const key of ['core', 'halo', 'outer', 'light']) {
    if (!Number.isInteger(star[key]) || star[key] < 0 || star[key] > 0xffffff) fail(seed, `star.${key}=${star[key]}`);
  }

  let prev = 0;
  for (let k = 0; k < n; k++) {
    const p = planets[k];
    if (!(p.r > prev)) fail(seed, `orbit ${k} not increasing (${p.r} <= ${prev})`);
    if (!(p.r > star.radius + 5)) fail(seed, `orbit ${k} (${p.r}) inside star radius ${star.radius}`);

    const gap = Math.min(
      k > 0 ? p.r - planets[k - 1].r : Infinity,
      k < n - 1 ? planets[k + 1].r - p.r : Infinity
    );
    if (p.radius * 2 > gap * 0.62) fail(seed, `planet ${k} overlaps neighbour (r=${p.radius}, gap=${gap.toFixed(1)})`);
    if (!(p.radius >= 1.2 && p.radius <= 5.6)) fail(seed, `planet ${k} radius ${p.radius}`);
    if (!(p.period > 0) || !Number.isFinite(p.period)) fail(seed, `planet ${k} period ${p.period}`);
    if (!Number.isInteger(p.color) || p.color < 0 || p.color > 0xffffff) fail(seed, `planet ${k} colour ${p.color}`);
    if (!Number.isFinite(p.phase)) fail(seed, `planet ${k} phase ${p.phase}`);
    if (k > 0) minGapRatio = Math.min(minGapRatio, p.r / planets[k - 1].r);

    prev = p.r;
  }

  if (spec.belts.length > 2) fail(seed, `belt count ${spec.belts.length}`);
  let beltParticles = 0;
  for (const b of spec.belts) {
    beltParticles += b.count;
    if (!(b.a >= outer * 1.4)) fail(seed, `belt a ${b.a} vs outer ${outer}`);
    if (!(b.e >= 0.5 && b.e <= 0.9)) fail(seed, `belt e ${b.e}`);
    if (!(Math.abs(b.inc) >= 0.1 && Math.abs(b.inc) <= 0.7)) fail(seed, `belt inc ${b.inc}`);
    if (!(b.count >= 5000 && b.count <= 9000)) fail(seed, `belt count ${b.count}`);
    if (!(b.width >= 3 && b.width <= 11.5)) fail(seed, `belt width ${b.width}`);
    if (!Number.isInteger(b.color)) fail(seed, `belt colour ${b.color}`);
  }
  maxBeltParticles = Math.max(maxBeltParticles, beltParticles);

  if (spec.viewpoint < 0 || spec.viewpoint >= n) fail(seed, `viewpoint ${spec.viewpoint}`);
  if (!Array.isArray(spec.sky.band) || spec.sky.band.length !== 3) fail(seed, 'sky.band');

  minInner = Math.min(minInner, planets[0].r);
  maxOuter = Math.max(maxOuter, outer);
  stats.planets[n] = (stats.planets[n] || 0) + 1;
  stats.belts[spec.belts.length] = (stats.belts[spec.belts.length] || 0) + 1;
  stats.stars[star.name] = (stats.stars[star.name] || 0) + 1;
}

if (errors.length) {
  console.error(`FAIL: ${errors.length} problem(s)\n` + errors.join('\n'));
  process.exit(1);
}

console.log(`OK: ${count} systems validated (seeds ${start}..${start + count - 1})`);
console.log(`  planets per system : ${JSON.stringify(stats.planets)}`);
console.log(`  belts per system   : ${JSON.stringify(stats.belts)}`);
console.log(`  star classes       : ${JSON.stringify(stats.stars)}`);
console.log(`  inner orbit        : min ${minInner.toFixed(1)}, outer max ${maxOuter.toFixed(1)}`);
console.log(`  tightest gap ratio : ${minGapRatio.toFixed(2)}`);
console.log(`  max belt particles : ${maxBeltParticles}`);
