/* ------------------------------------------------------------------ *
 * galaxy.js — 确定性「星系」生成器
 *
 * 输入一个整数 seed，输出一份纯数据的 SystemSpec：
 *   { seed, star, planets[], belts[], camera, sky, viewpoint }
 *
 * 这里不碰 THREE、不碰 DOM，所以既能被 app.js 直接 import，
 * 也能在 Node 里批量跑（tools/check-galaxy.mjs）做约束校验。
 *
 * 设计原则见 HANDOVER §7：随机会丑，必须约束。
 *   - 轨道半径按等比递增，总跨度 2.2–4.4 倍，最外层归一化到 TARGET_OUTER
 *   - 行星半径随轨道半径缩放，且不超过相邻间隙的 22%
 *   - 颜色从 8 套预设色板里取，再按恒星色温做整体色相偏移，不随机 RGB
 *   - 尘埃带 0–2 条，粒子总数封顶
 *   - 相机距离由最外层轨道推导，保证每套系统都框得住
 * ------------------------------------------------------------------ */

export const TARGET_OUTER = 152; // 最外层行星轨道在场景单位里的半径（v1.6 的太阳系是 152）
export const CAMERA_FOV = 52;

/* ---------------------------------------------------------------- *
 * 确定性随机（mulberry32）
 * ---------------------------------------------------------------- */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (rnd, a, b) => a + rnd() * (b - a);
const intRange = (rnd, a, b) => a + Math.floor(rnd() * (b - a + 1));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function weighted(rnd, items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* ---------------------------------------------------------------- *
 * 颜色工具（避免在生成器里依赖 THREE.Color）
 * ---------------------------------------------------------------- */

function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h, s, l) {
  h = ((h % 1) + 1) % 1;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** 按恒星色温把行星色整体偏暖/偏冷，并做一点点饱和度收敛。 */
function starTint(hex, shift) {
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  return hslToHex(h + shift, s * 0.94, l);
}

/* ---------------------------------------------------------------- *
 * 预设：恒星类型 + 配色板
 * ---------------------------------------------------------------- */

const STAR_CLASSES = [
  // 3000K 红橙矮星
  { name: '红矮', temp: 3100, core: 0xffc08a, halo: 0xff9a5a, outer: 0xff7a4a, light: 0xffd7b0, tint: -0.035, weight: 0.08 },
  // 4300K 橙矮星
  { name: '橙矮', temp: 4300, core: 0xffe0b4, halo: 0xffb878, outer: 0xffa060, light: 0xffe7c8, tint: -0.018, weight: 0.16 },
  // 5600K 类太阳
  { name: '黄矮', temp: 5600, core: 0xfff3d6, halo: 0xffb060, outer: 0x88aaff, light: 0xfff0d0, tint: 0.0, weight: 0.34 },
  // 6900K 黄白
  { name: '黄白', temp: 6900, core: 0xf7f9ff, halo: 0xd6c4ff, outer: 0x9fb4ff, light: 0xeef4ff, tint: 0.012, weight: 0.22 },
  // 8800K 白蓝
  { name: '白蓝', temp: 8800, core: 0xe4edff, halo: 0x9fc0ff, outer: 0x7fa8ff, light: 0xd6e6ff, tint: 0.028, weight: 0.14 },
  // 12000K 蓝巨
  { name: '蓝巨', temp: 12000, core: 0xc9dcff, halo: 0x88aaff, outer: 0x6f9bff, light: 0xb9d0ff, tint: 0.045, weight: 0.06 }
];

const PALETTES = [
  { name: '岩石', planets: [0x9a8f86, 0xe8c27a, 0x4d8fd6, 0xc4674a, 0x7d6a58], beltHue: 0.58 },
  { name: '冰原', planets: [0xa8cfe0, 0x5f8fbf, 0xdfeef5, 0x3f6a8f, 0x8fbfd0], beltHue: 0.54 },
  { name: '沙海', planets: [0xd9b26a, 0xa67c52, 0xefe2c4, 0x6b5a45, 0xc79a5b], beltHue: 0.10 },
  { name: '紫晶', planets: [0xb79ad6, 0x7a5fa8, 0xe0d0f0, 0x4b3a6b, 0x9d7fc0], beltHue: 0.78 },
  { name: '苔原', planets: [0x9ec9a0, 0x5f8f6a, 0xdbe8c4, 0x3f5d4a, 0xb7c98a], beltHue: 0.35 },
  { name: '铁锈', planets: [0xc96f4a, 0x8a4b33, 0xe6b090, 0x5c3526, 0xd18c63], beltHue: 0.05 },
  { name: '青碧', planets: [0x7fd3c8, 0x3f8f96, 0xcfeeea, 0x2a5a63, 0x9fd6c9], beltHue: 0.48 },
  { name: '霞粉', planets: [0xe0a0b0, 0xb06a80, 0xf2d6dd, 0x7a4557, 0xcf8fa0], beltHue: 0.92 }
];

/* ---------------------------------------------------------------- *
 * 主函数
 * ---------------------------------------------------------------- */

export function makeSpec(seed) {
  const s = (seed >>> 0) || 1;
  const rnd = mulberry32(s);

  // --- 恒星 -------------------------------------------------------
  const starClass = weighted(rnd, STAR_CLASSES, STAR_CLASSES.map(c => c.weight));
  const starRadius = clamp(12 + (rnd() - 0.5) * 2.8, 10.6, 13.4);
  const glowScale = starRadius / 12; // v1.6 的辉光尺寸是按半径 12 调出来的

  // --- 配色 -------------------------------------------------------
  const palette = PALETTES[intRange(rnd, 0, PALETTES.length - 1)];
  const colorOffset = intRange(rnd, 0, 4);
  const tint = starClass.tint;

  // --- 轨道：对数空间分配间距，总跨度受限 ------------------------
  const count = 3 + intRange(rnd, 0, 2); // 3–5 颗（不生成空系统）
  const span = range(rnd, 2.2, 4.4);     // 最外层 / 最内层
  const totalLog = Math.log(span);

  // 把 log(span) 随机切成 count-1 段：疏密有变化，但相邻比值不会贴近 1
  const weights = [];
  let weightSum = 0;
  for (let i = 1; i < count; i++) {
    const w = range(rnd, 0.72, 1.3);
    weights.push(w);
    weightSum += w;
  }

  let orbit = 1;
  const rawOrbits = [orbit];
  for (let i = 0; i < weights.length; i++) {
    orbit *= Math.exp((totalLog * weights[i]) / weightSum);
    rawOrbits.push(orbit);
  }

  const outer = TARGET_OUTER * range(rnd, 0.97, 1.05);
  const scale = outer / rawOrbits[rawOrbits.length - 1];
  const orbits = rawOrbits.map(v => v * scale);

  // --- 行星 -------------------------------------------------------
  const outerPeriod = range(rnd, 1.25, 2.2); // 最外层公转周期（秒 = 值 × 180）
  const planets = orbits.map((r, i) => {
    const gap = Math.min(
      i > 0 ? r - orbits[i - 1] : Infinity,
      i < count - 1 ? orbits[i + 1] - r : Infinity
    );
    // 0.017–0.042 × 轨道半径；再压到相邻间隙的 30% 以内，保证不贴脸
    let radius = r * range(rnd, 0.017, 0.042);
    radius = Math.min(radius, gap * 0.3);
    radius = clamp(radius, 1.2, 5.6);

    const hex = palette.planets[(i + colorOffset) % palette.planets.length];
    return {
      name: 'P' + (i + 1),
      r: +r.toFixed(3),
      radius: +radius.toFixed(2),
      color: starTint(hex, tint),
      period: +Math.max(0.12, Math.pow(r / outer, 1.5) * outerPeriod).toFixed(3),
      phase: +(rnd() * Math.PI * 2).toFixed(3)
    };
  });

  // --- 尘埃带 0–2 条 ---------------------------------------------
  const roll = rnd();
  const beltCount = roll < 0.08 ? 0 : roll < 0.72 ? 1 : 2;
  const belts = [];
  for (let i = 0; i < beltCount; i++) {
    const hue = palette.beltHue + range(rnd, -0.04, 0.04) + tint * 2;
    belts.push({
      a: +(outer * range(rnd, 1.45, 2.05)).toFixed(2),
      e: +range(rnd, 0.55, 0.88).toFixed(3),
      inc: +(range(rnd, 0.12, 0.66) * (rnd() < 0.5 ? -1 : 1)).toFixed(3),
      node: +(rnd() * Math.PI * 2).toFixed(3),
      width: +range(rnd, 3.5, 11).toFixed(2),
      count: Math.round(range(rnd, 5000, 9000)),
      color: hslToHex(hue, range(rnd, 0.45, 0.68), range(rnd, 0.58, 0.78))
    });
  }

  // --- 相机 -------------------------------------------------------
  const distance = outer * range(rnd, 2.35, 2.55);

  // --- 星空 -------------------------------------------------------
  const sky = {
    band: [
      +range(rnd, 0.55, 1.15).toFixed(3),
      +range(rnd, -0.75, 0.75).toFixed(3),
      +range(rnd, 0.4, 1.55).toFixed(3)
    ],
    milky: starTint(0x9fb4dd, tint * 1.6)
  };

  const viewpoint = clamp(1 + intRange(rnd, 0, Math.max(0, count - 2)), 0, count - 1);

  return {
    seed: s,
    palette: palette.name,
    star: {
      name: starClass.name,
      temp: starClass.temp,
      radius: +starRadius.toFixed(2),
      glowScale: +(starRadius / 12).toFixed(4),
      core: starClass.core,
      halo: starClass.halo,
      outer: starClass.outer,
      light: starClass.light
    },
    planets,
    belts,
    camera: {
      distance: +distance.toFixed(2),
      elevation: +range(rnd, 0.26, 0.46).toFixed(3),
      azimuth: +(rnd() * Math.PI * 2).toFixed(3),
      fov: CAMERA_FOV
    },
    sky,
    viewpoint
  };
}

/** 给日志/状态栏用的一行摘要。 */
export function summarize(spec) {
  return `seed=${spec.seed} star=${spec.star.name}(${spec.star.temp}K) planets=${spec.planets.length} ` +
    `belts=${spec.belts.length} outer=${spec.planets[spec.planets.length - 1].r} cam=${spec.camera.distance}`;
}
