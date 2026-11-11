// Publishes the source tree to GitHub and/or Gitee through their REST APIs.
// No git binary needed (this machine has none).
//
// usage:
//   node tools/publish.mjs --check                 # list files + sizes, no network
//   node tools/publish.mjs --github                # create repo + push one commit
//   node tools/publish.mjs --gitee
//   node tools/publish.mjs --release               # GitHub release + zip asset
//
// tokens (env or ../../.tokens.txt with `github=...` / `gitee=...` lines):
//   GITHUB_TOKEN, GITEE_TOKEN
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = 'meteor-wallpaper';
const DESC = 'Windows 桌面随机星系 / 流星雨壁纸（.NET 8 + WebView2 + three.js），每次启动生成一套新星系';
const TOPICS = ['wallpaper', 'threejs', 'webview2', 'dotnet', 'windows', 'procedural-generation'];

const SKIP_DIRS = new Set([
  '.git', '.sdk', '.nuget', '.appdata', '.dhome', '.tmp', '.edgetmp', '.edgetmp2',
  'bin', 'obj', 'dist', 'data', 'shots', '.vs', '.vscode', 'node_modules',
]);
const SKIP_FILES = /(\.zip|\.log|\.pdb|^settings\.json$)/i;

function collect(dir = ROOT, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collect(path.join(dir, entry.name), rel));
    } else {
      if (SKIP_FILES.test(entry.name)) continue;
      out.push({ rel, abs: path.join(dir, entry.name), size: fs.statSync(path.join(dir, entry.name)).size });
    }
  }
  return out;
}

function tokens() {
  const file = path.resolve(ROOT, '..', '.tokens.txt');
  const cfg = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(github|gitee)\s*=\s*(\S+)\s*$/i);
      if (m) cfg[m[1].toLowerCase()] = m[2];
    }
  }
  return {
    github: process.env.GITHUB_TOKEN || cfg.github,
    gitee: process.env.GITEE_TOKEN || cfg.gitee,
  };
}

async function api(url, { method = 'GET', token, body, headers = {}, raw = false }) {
  const res = await fetch(url, {
    method,
    headers: {
      'user-agent': 'meteor-wallpaper-publisher',
      accept: 'application/vnd.github+json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body && !raw ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { }
  if (!res.ok) {
    const msg = json?.message || text.slice(0, 300);
    const err = new Error(`${method} ${url} -> ${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/* ------------------------------------------------------------------ */

async function publishGitHub(token, files) {
  const me = await api('https://api.github.com/user', { token });
  const owner = me.login;
  console.log(`github user: ${owner}`);

  try {
    await api('https://api.github.com/user/repos', {
      method: 'POST', token,
      body: { name: REPO, description: DESC, private: false, has_issues: true, auto_init: false },
    });
    console.log(`created ${owner}/${REPO}`);
  } catch (e) {
    if (e.status === 422) console.log(`${owner}/${REPO} already exists, reusing`);
    else throw e;
  }

  // The Git Data API refuses to write blobs into a repo that has no commits
  // ("409 Git Repository is empty"), so seed one commit through the Contents API.
  let parentSha = null;
  try {
    const ref = await api(`https://api.github.com/repos/${owner}/${REPO}/git/ref/heads/main`, { token });
    parentSha = ref.object.sha;
  } catch { }

  if (!parentSha) {
    const seedFile = files.find(f => f.rel === '.gitignore') || files[0];
    const seed = await api(
      `https://api.github.com/repos/${owner}/${REPO}/contents/${seedFile.rel.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'PUT', token, body: { message: 'init', content: fs.readFileSync(seedFile.abs).toString('base64') } });
    parentSha = seed.commit.sha;
    console.log(`seeded empty repo with ${seedFile.rel}`);
  }

  const tree = [];
  for (const f of files) {
    const blob = await api(`https://api.github.com/repos/${owner}/${REPO}/git/blobs`, {
      method: 'POST', token,
      body: { content: fs.readFileSync(f.abs).toString('base64'), encoding: 'base64' },
    });
    tree.push({ path: f.rel, mode: '100644', type: 'blob', sha: blob.sha });
    console.log(`  blob ${f.rel} (${(f.size / 1024).toFixed(0)} KB)`);
  }

  const t = await api(`https://api.github.com/repos/${owner}/${REPO}/git/trees`, {
    method: 'POST', token, body: { tree },
  });
  const commit = await api(`https://api.github.com/repos/${owner}/${REPO}/git/commits`, {
    method: 'POST', token,
    body: { message: 'v1.7.1: 随机星系完整版\n\n- galaxy.js: 种子 -> SystemSpec，约束随机\n- 托盘「换一个星系」热重建\n- 退出兜底：关闭壁纸.bat / 二次启动 / --quit', tree: t.sha, parents: [parentSha] },
  });
  await api(`https://api.github.com/repos/${owner}/${REPO}/git/refs/heads/main`, {
    method: 'PATCH', token, body: { sha: commit.sha, force: true },
  });
  await api(`https://api.github.com/repos/${owner}/${REPO}`, {
    method: 'PATCH', token, body: { topics: TOPICS, description: DESC },
  }).catch(e => console.log('topics skipped:', e.message));

  console.log(`github done: https://github.com/${owner}/${REPO}`);
  return owner;
}

async function publishGitee(token, files) {
  const me = await api(`https://gitee.com/api/v5/user?access_token=${encodeURIComponent(token)}`);
  const owner = me.login;
  console.log(`gitee user: ${owner}`);

  try {
    await api(`https://gitee.com/api/v5/user/repos`, {
      method: 'POST',
      body: { access_token: token, name: REPO, description: DESC, private: false, auto_init: false, has_issues: true },
    });
    console.log(`created ${owner}/${REPO}`);
  } catch (e) {
    if (/already exists|已存在|404/.test(e.message)) console.log(`${owner}/${REPO} already exists, reusing`);
    else throw e;
  }

  // Gitee has no tree API here: one commit per file is the only way without git.
  let branch = 'master';
  for (const f of files) {
    const url = `https://gitee.com/api/v5/repos/${owner}/${REPO}/contents/${f.rel.split('/').map(encodeURIComponent).join('/')}`;
    const body = {
      access_token: token,
      content: fs.readFileSync(f.abs).toString('base64'),
      message: `add ${f.rel}`,
      branch,
    };
    try {
      await api(url, { method: 'POST', body });
      console.log(`  file ${f.rel} (${(f.size / 1024).toFixed(0)} KB)`);
    } catch (e) {
      if (e.status === 400 || e.status === 422) {
        // file exists: update it
        const existing = await api(`${url}?access_token=${encodeURIComponent(token)}&ref=${branch}`);
        await api(url, { method: 'PUT', body: { ...body, sha: existing.sha, message: `update ${f.rel}` } });
        console.log(`  update ${f.rel}`);
      } else throw e;
    }
  }
  console.log(`gitee done: https://gitee.com/${owner}/${REPO}`);
  return owner;
}

async function githubRelease(token, owner) {
  const zip = path.join(ROOT, 'dist', 'MeteorWallpaper_v1.7.1.zip');
  if (!fs.existsSync(zip)) throw new Error(`missing ${zip}`);
  const body = '随机星系完整版。Windows 10/11，解压后双击 MeteorWallpaper.exe。\n\n' +
    '每次启动随机一个星系；托盘「换一个星系」立即换；找不到托盘图标时双击「关闭壁纸.bat」。';
  let rel;
  try {
    rel = await api(`https://api.github.com/repos/${owner}/${REPO}/releases`, {
      method: 'POST', token,
      body: { tag_name: 'v1.7.1', name: 'v1.7.1 · 随机星系', body, draft: false, prerelease: false, target_commitish: 'main' },
    });
  } catch (e) {
    if (e.status !== 422) throw e;
    rel = await api(`https://api.github.com/repos/${owner}/${REPO}/releases/tags/v1.7.1`, { token });
  }
  const name = path.basename(zip);
  const size = fs.statSync(zip).size;
  const upload = await fetch(
    `https://uploads.github.com/repos/${owner}/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/zip',
        'content-length': String(size),
        'user-agent': 'meteor-wallpaper-publisher',
      },
      body: fs.readFileSync(zip),
    });
  const txt = await upload.text();
  if (!upload.ok) throw new Error(`upload -> ${upload.status} ${txt.slice(0, 300)}`);
  console.log(`release asset uploaded (${(size / 1048576).toFixed(1)} MB)`);
  console.log(`release: https://github.com/${owner}/${REPO}/releases/tag/v1.7.1`);
}

/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const files = collect().sort((a, b) => a.rel.localeCompare(b.rel));

if (args.includes('--check')) {
  let total = 0;
  for (const f of files) { total += f.size; console.log(`${(f.size / 1024).toFixed(1).padStart(7)} KB  ${f.rel}`); }
  console.log(`${files.length} files, ${(total / 1048576).toFixed(2)} MB`);
  process.exit(0);
}

const tk = tokens();
if (args.includes('--github')) {
  if (!tk.github) { console.error('missing GITHUB_TOKEN'); process.exit(2); }
  const owner = await publishGitHub(tk.github, files);
  globalThis.__ghOwner = owner;
}
if (args.includes('--gitee')) {
  if (!tk.gitee) { console.error('missing GITEE_TOKEN'); process.exit(2); }
  await publishGitee(tk.gitee, files);
}
if (args.includes('--release')) {
  if (!tk.github) { console.error('missing GITHUB_TOKEN'); process.exit(2); }
  const me = await api('https://api.github.com/user', { token: tk.github });
  await githubRelease(tk.github, me.login);
}
