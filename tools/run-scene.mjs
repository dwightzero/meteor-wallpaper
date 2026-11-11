// Executes wwwroot/app.js under Node with DOM stubs to surface runtime errors
// that would otherwise show up as a black desktop.
//
// usage: node tools/run-scene.mjs <wwwroot> <workdir>
//   env MW_SEED=123456  build the first scene from that seed (default: random)
//   env MW_MODE=earth   boot in earth mode
//
// The run also exercises the live rebuild path by pushing two new seeds.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const srcDir = process.argv[2];
const workDir = process.argv[3] || path.join(srcDir, '..', '..', '.tmp', 'scene');
fs.mkdirSync(workDir, { recursive: true });

const src = fs.readFileSync(path.join(srcDir, 'app.js'), 'utf8');
const patched = src.replace(
  "import * as THREE from './three.module.js';",
  "import './scene-stub.mjs';\nimport { THREE } from './scene-stub.mjs';"
);

if (patched === src) {
  console.error('FAIL: import line not found, scene file changed shape');
  process.exit(2);
}

fs.copyFileSync(path.join(srcDir, 'three.module.js'), path.join(workDir, 'three.mjs'));
fs.copyFileSync(path.join(srcDir, 'galaxy.js'), path.join(workDir, 'galaxy.js'));
fs.copyFileSync(path.join('tools', 'scene-stub.mjs'), path.join(workDir, 'scene-stub.mjs'));
const bodyPath = path.join(workDir, 'scene-body.mjs');
fs.writeFileSync(bodyPath, patched, 'utf8');

const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };

try {
  await import(pathToFileURL(bodyPath).href);

  const q = globalThis.__frames;
  const dispatch = globalThis.__dispatchHost;
  const posted = globalThis.__posted;
  let t = 0;
  let ran = 0;
  const pump = (frames) => {
    for (let i = 0; i < frames && q.length; i++) {
      const cbs = q.splice(0, q.length);
      for (const cb of cbs) { cb(t); ran++; }
      t += 34;
    }
  };

  const specs = () => posted.filter(m => m && m.type === 'spec').map(m => m.value);
  const errors = () => posted.filter(m => m && m.type === 'error');

  pump(4);
  dispatch({ cmd: 'dim', value: 0.6 });
  dispatch({ cmd: 'fps', value: 30 });
  dispatch({ cmd: 'interactive', value: true });
  pump(4);
  dispatch({ cmd: 'mode', value: 'earth' });
  pump(20);
  dispatch({ cmd: 'paused', value: true });
  pump(2);
  dispatch({ cmd: 'paused', value: false });
  dispatch({ cmd: 'mode', value: 'solar' });
  pump(8);
  dispatch({ cmd: 'interactive', value: false });

  const first = specs().length;
  if (first !== 1) fail(`expected 1 spec after boot, got ${first}`);

  // live rebuild while on the desktop ...
  dispatch({ cmd: 'seed', value: 777001 });
  pump(6);
  // ... and while standing on a planet ...
  dispatch({ cmd: 'mode', value: 'earth' });
  pump(6);
  dispatch({ cmd: 'seed', value: 424242 });
  pump(10);
  dispatch({ cmd: 'mode', value: 'solar' });
  pump(6);

  const seen = specs();
  if (seen.length !== 3) fail(`expected 3 builds (boot + 2 seeds), got ${seen.length}`);
  if (seen[1].seed !== 777001 || seen[2].seed !== 424242) fail('seed values not honoured');
  for (const s of seen) {
    if (!(s.planets >= 3 && s.planets <= 5)) fail(`bad planet count ${s.planets} for seed ${s.seed}`);
    if (!(s.belts >= 0 && s.belts <= 2)) fail(`bad belt count ${s.belts} for seed ${s.seed}`);
    if (!(s.buildMs >= 0)) fail(`bad buildMs ${s.buildMs}`);
  }
  if (errors().length) fail('scene posted errors: ' + JSON.stringify(errors()));

  const ready = posted.filter(m => m && m.type === 'ready').length;
  if (ready < 1) fail('scene never reported ready');

  console.log(`OK: module evaluated, ${ran} frames, 3 systems built, both modes exercised`);
  console.log(`    seeds: ${seen.map(s => s.seed).join(', ')}; planets ${seen.map(s => s.planets).join('/')}; belts ${seen.map(s => s.belts).join('/')}; build ${seen.map(s => s.buildMs + 'ms').join('/')}`);
} catch (err) {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
}
