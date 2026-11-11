// Dumps generated system specs to JSON so the Python previewer can draw them.
// usage: node tools/dump-spec.mjs <outdir> <seed> [seed...]
import fs from 'fs';
import path from 'path';
import { makeSpec } from '../src/MeteorWallpaper/wwwroot/galaxy.js';

const [outDir, ...seeds] = process.argv.slice(2);
if (!outDir || seeds.length === 0) {
  console.error('usage: node tools/dump-spec.mjs <outdir> <seed> [seed...]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
for (const raw of seeds) {
  const seed = Number(raw);
  const spec = makeSpec(seed);
  const file = path.join(outDir, `spec-${seed}.json`);
  fs.writeFileSync(file, JSON.stringify(spec, null, 1));
  console.log(file);
}
