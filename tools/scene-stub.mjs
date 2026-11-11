// Minimal DOM/WebGL stubs so the scene module can be executed under Node.
// Lets us catch runtime errors in app.js without a browser.

import * as RAW from './three.mjs';

const noop = () => {};

class ClassList {
  constructor() { this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  toggle(c, on) { if (on) this.add(c); else this.remove(c); }
  contains(c) { return this.set.has(c); }
}

function makeCtx2d() {
  const gradient = { addColorStop: noop };
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillRect: noop,
    clearRect: noop,
    beginPath: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })
  };
}

function makeCanvas(w = 1600, h = 900) {
  return {
    width: w,
    height: h,
    clientWidth: w,
    clientHeight: h,
    style: {},
    classList: new ClassList(),
    getContext: (type) => (type === '2d' ? makeCtx2d() : null),
    addEventListener: noop,
    removeEventListener: noop,
    setPointerCapture: noop,
    releasePointerCapture: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h })
  };
}

const sceneCanvas = makeCanvas();
const hintEl = { classList: new ClassList(), textContent: '' };

const listeners = [];
const posted = [];
const hostBridge = {
  addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
  postMessage: (msg) => { posted.push(msg); }
};
globalThis.__posted = posted;

globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 1,
  addEventListener: noop,
  removeEventListener: noop,
  chrome: { webview: hostBridge },
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (id) => clearTimeout(id)
};

globalThis.__dispatchHost = (data) => {
  for (const fn of listeners) fn({ data });
};

globalThis.document = {
  getElementById: (id) => (id === 'scene' ? sceneCanvas : hintEl),
  createElement: (tag) => (tag === 'canvas' ? makeCanvas(256, 256) : { style: {}, classList: new ClassList() }),
  body: { classList: new ClassList() },
  addEventListener: noop
};

const seedArg = process.env.MW_SEED ? `&seed=${process.env.MW_SEED}` : '';
const modeArg = process.env.MW_MODE || 'solar';
globalThis.location = { search: `?mode=${modeArg}${seedArg}` };

const define = (name, value) => {
  try { globalThis[name] = value; }
  catch { Object.defineProperty(globalThis, name, { value, configurable: true }); }
};

const frameQueue = [];
define('requestAnimationFrame', (cb) => { frameQueue.push(cb); return frameQueue.length; });
define('cancelAnimationFrame', noop);
if (!globalThis.performance) define('performance', { now: () => Date.now() });

export class FakeRenderer {
  constructor() {
    this.domElement = sceneCanvas;
    this.shadowMap = { enabled: false };
    this.info = { render: {}, memory: {} };
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.outputColorSpace = '';
  }
  setPixelRatio() {}
  getPixelRatio() { return 1; }
  setSize() {}
  setClearColor() {}
  setClearAlpha() {}
  getSize(t) { if (t && t.set) t.set(1600, 900); return { x: 1600, y: 900 }; }
  render() {}
  dispose() {}
  compile() {}
}

globalThis.__FakeRenderer = FakeRenderer;
globalThis.__frames = frameQueue;

export const THREE = new Proxy(RAW, {
  get(target, prop) {
    if (prop === 'WebGLRenderer') return FakeRenderer;
    return target[prop];
  }
});
