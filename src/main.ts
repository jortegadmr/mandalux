import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import './style.css';
import { PALETTES } from './palettes';
import { RibbonField } from './ribbon';
import { Painter } from './painter';
import { LoomFrame } from './loom';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('stage');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = window.matchMedia('(pointer: coarse)').matches;

function showFallback(title?: string, text?: string): void {
  const el = $('fallback');
  if (title) el.querySelector('h2')!.textContent = title;
  if (text) el.querySelector('p')!.textContent = text;
  el.hidden = false;
  document.querySelectorAll<HTMLElement>('.dock, .hint, .chrome-toggle, .vignette').forEach((n) => (n.hidden = true));
  canvas.style.display = 'none';
}

let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
} catch {
  showFallback();
  throw new Error('WebGL is not available');
}
renderer.setClearColor(0x05060d, 1);

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  showFallback('The graphics context was lost', 'Reload the page to continue painting.');
});

// ---- state ------------------------------------------------------------
type Mode = 'paint' | 'orbit';
const state = {
  mode: 'paint' as Mode,
  axes: 6,
  mirror: true,
  palette: 0,
  depth: 0.55,
  fade: 48,
  ghost: true,
  spin: !reduceMotion,
  interacted: false,
};

const lifeFromSlider = (s: number): number => (s >= 100 ? 1e9 : 2.5 * Math.pow(16, s / 95));
const lifeLabel = (s: number): string => (s >= 100 ? 'Hold' : `${lifeFromSlider(s) < 10 ? lifeFromSlider(s).toFixed(1) : Math.round(lifeFromSlider(s))} s`);

// ---- scene ------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060d);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 80);
camera.position.set(0, 2.4, 10.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 4.5;
controls.maxDistance = 16;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = Math.PI - 0.35;
controls.autoRotateSpeed = 1.0;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.update();

const field = new RibbonField(14000);
const loom = new LoomFrame();
const painter = new Painter(field, camera);
scene.add(loom.group, field.mesh, painter.heads);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.55, 0.25);
composer.addPass(bloom);
composer.addPass(new OutputPass());

let pixelRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pixelRatio);
  composer.setSize(w, h);
  camera.aspect = w / h;
  // keep the sculpture framed on tall, narrow screens
  camera.fov = w / h < 0.8 ? 62 : 50;
  camera.updateProjectionMatrix();
  field.material.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
}
window.addEventListener('resize', resize);

// ---- apply state --------------------------------------------------------
function applySymmetry(): void {
  field.setSymmetry(state.axes, state.mirror);
  loom.setSymmetry(state.axes, state.mirror);
  $('axes-val').textContent = String(state.axes);
  $('mirror').setAttribute('aria-pressed', String(state.mirror));
  drawGlyph();
}

function applyPalette(): void {
  const p = PALETTES[state.palette];
  field.setPalette(p);
  loom.setTint(p.stops[1]);
  const root = document.documentElement.style;
  root.setProperty('--accent', p.stops[0]);
  root.setProperty('--accent-2', p.stops[2]);
  document.querySelectorAll<HTMLButtonElement>('#palettes button').forEach((b, i) => {
    b.setAttribute('aria-checked', String(i === state.palette));
    b.tabIndex = i === state.palette ? 0 : -1;
  });
}

function applyLife(): void {
  field.material.uniforms.uLife.value = lifeFromSlider(state.fade);
  $('fade-val').textContent = lifeLabel(state.fade);
}

function applyMode(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)),
  );
  canvas.classList.toggle('orbiting', state.mode === 'orbit');
  updateHint();
}

function applyGhost(): void {
  painter.ghostOn = state.ghost;
  $('ghost').setAttribute('aria-pressed', String(state.ghost));
  updateHint();
}

function drawGlyph(): void {
  const svg = $('axes-glyph');
  const n = state.axes;
  let html = '<circle r="13.5" fill="none" stroke="currentColor" stroke-opacity=".28" stroke-width="1"/>';
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 - Math.PI / 2;
    html += `<line x1="0" y1="0" x2="${(Math.cos(a) * 13.5).toFixed(2)}" y2="${(Math.sin(a) * 13.5).toFixed(2)}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  html += '<circle r="1.8" fill="currentColor"/>';
  svg.innerHTML = html;
}

let hintTimer = 0;
function updateHint(): void {
  const hint = $('hint');
  let text: string;
  if (!state.interacted && state.ghost) {
    text = coarse ? 'A ghost brush is painting. Touch the screen to take over.' : 'A ghost brush is painting. Click anywhere to take over.';
  } else if (state.mode === 'orbit') {
    text = 'Drag to turn the sculpture. Switch back to Paint to draw.';
  } else {
    text = coarse
      ? 'Drag to paint light. Use two fingers, or Orbit, to turn it.'
      : 'Drag to paint light. Shift-drag or right-drag turns the sculpture.';
  }
  hint.textContent = text;
  hint.classList.remove('quiet');
  window.clearTimeout(hintTimer);
  if (state.interacted) hintTimer = window.setTimeout(() => hint.classList.add('quiet'), 7000);
}

function markInteracted(): void {
  if (state.interacted) return;
  state.interacted = true;
  if (state.ghost) {
    state.ghost = false;
    painter.resetGhost();
    applyGhost();
  }
  updateHint();
}

// ---- UI wiring ----------------------------------------------------------
const paletteBox = $('palettes');
PALETTES.forEach((p, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', p.name);
  b.title = `${p.name} (${i + 1})`;
  b.style.background = `linear-gradient(135deg, ${p.stops.join(', ')})`;
  b.addEventListener('click', () => {
    state.palette = i;
    applyPalette();
  });
  paletteBox.appendChild(b);
});

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    state.mode = b.dataset.mode as Mode;
    applyMode();
  }),
);

function setAxes(n: number): void {
  state.axes = Math.min(16, Math.max(1, n));
  applySymmetry();
}
$('axes-dec').addEventListener('click', () => setAxes(state.axes - 1));
$('axes-inc').addEventListener('click', () => setAxes(state.axes + 1));
$('mirror').addEventListener('click', () => {
  state.mirror = !state.mirror;
  applySymmetry();
});
$('spin').addEventListener('click', () => toggleSpin());
function toggleSpin(): void {
  state.spin = !state.spin;
  $('spin').setAttribute('aria-pressed', String(state.spin));
}
$('ghost').addEventListener('click', () => {
  state.ghost = !state.ghost;
  if (state.ghost) painter.resetGhost();
  applyGhost();
});
$('clear').addEventListener('click', () => field.clear());
$('save').addEventListener('click', () => savePng());
$<HTMLInputElement>('depth').addEventListener('input', (e) => {
  state.depth = Number((e.target as HTMLInputElement).value) / 100;
  painter.depth = state.depth;
});
$<HTMLInputElement>('fade').addEventListener('input', (e) => {
  state.fade = Number((e.target as HTMLInputElement).value);
  applyLife();
});
$('more').addEventListener('click', () => {
  const dock = $('dock');
  const open = dock.classList.toggle('open');
  $('more').setAttribute('aria-expanded', String(open));
});
$('hide-ui').addEventListener('click', () => toggleUi());
function toggleUi(): void {
  const hidden = document.body.classList.toggle('ui-hidden');
  $('hide-ui').setAttribute('aria-pressed', String(hidden));
}

function savePng(): void {
  composer.render();
  const w = canvas.width;
  const h = canvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  g.drawImage(canvas, 0, 0);
  const grad = g.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.3, w / 2, h * 0.46, Math.max(w, h) * 0.75);
  grad.addColorStop(0, 'rgba(2,3,8,0)');
  grad.addColorStop(1, 'rgba(2,3,8,0.7)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `light-loom-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

// ---- keyboard ----------------------------------------------------------
let spaceHeld = false;
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement;
  if (e.code === 'Space' && (t === document.body || t === canvas)) {
    spaceHeld = true;
    e.preventDefault();
    return;
  }
  if (t instanceof HTMLInputElement && t.type === 'range' && e.key.startsWith('Arrow')) return;
  switch (e.key.toLowerCase()) {
    case 'o': state.mode = state.mode === 'paint' ? 'orbit' : 'paint'; applyMode(); break;
    case 'm': state.mirror = !state.mirror; applySymmetry(); break;
    case 'r': toggleSpin(); break;
    case 'g': state.ghost = !state.ghost; if (state.ghost) painter.resetGhost(); applyGhost(); break;
    case 'c': field.clear(); break;
    case 's': savePng(); break;
    case 'h': toggleUi(); break;
    case '+': case '=': setAxes(state.axes + 1); break;
    case '-': case '_': setAxes(state.axes - 1); break;
    default: {
      const n = Number(e.key);
      if (n >= 1 && n <= PALETTES.length) {
        state.palette = n - 1;
        applyPalette();
      }
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceHeld = false;
});
window.addEventListener('blur', () => (spaceHeld = false));

// ---- pointer: paint vs orbit -------------------------------------------
let drawingId = -1;
const toNdc = (e: PointerEvent): [number, number] => {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
};

// Registered before OrbitControls' own listener so a paint gesture can claim the pointer first.
canvas.addEventListener('pointerdown', (e) => {
  markInteracted();
  if (drawingId !== -1 && e.pointerType === 'touch') {
    // a second finger: stop painting and let the camera take it
    painter.userEnd();
    drawingId = -1;
    return;
  }
  if (state.mode === 'paint' && e.button === 0 && !e.shiftKey && !spaceHeld && drawingId === -1) {
    e.stopImmediatePropagation();
    canvas.setPointerCapture(e.pointerId);
    drawingId = e.pointerId;
    const [nx, ny] = toNdc(e);
    painter.userBegin(nx, ny, e.timeStamp / 1000);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== drawingId) return;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  const list = events.length ? events : [e];
  for (const ev of list) {
    const [nx, ny] = toNdc(ev);
    painter.userMove(nx, ny, ev.timeStamp / 1000);
  }
});
const endDraw = (e: PointerEvent): void => {
  if (e.pointerId !== drawingId) return;
  drawingId = -1;
  painter.userEnd();
};
canvas.addEventListener('pointerup', endDraw);
canvas.addEventListener('pointercancel', endDraw);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- boot --------------------------------------------------------------
resize();
applyPalette();
applySymmetry();
applyLife();
applyMode();
applyGhost();
$<HTMLInputElement>('depth').value = String(Math.round(state.depth * 100));
$<HTMLInputElement>('fade').value = String(state.fade);
painter.depth = state.depth;
$('spin').setAttribute('aria-pressed', String(state.spin));

const dockEl = $('dock');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--dock-h', `${dockEl.offsetHeight}px`);
}).observe(dockEl);

// Start with a sculpture already hanging in the air, then keep painting live.
{
  const prefill = reduceMotion ? 20 : 9;
  if (reduceMotion) {
    state.fade = 100;
    applyLife();
    $<HTMLInputElement>('fade').value = '100';
  }
  const step = 1 / 60;
  const cam = camera.position;
  for (let t = 0; t < prefill; t += step) {
    painter.advance(step);
    const a = 0.3 * step;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = cam.x * c + cam.z * s;
    cam.z = -cam.x * s + cam.z * c;
    cam.x = x;
  }
  controls.update();
  if (reduceMotion) {
    painter.sweep = 0;
    state.ghost = false;
    applyGhost();
  }
}

let lastNow = performance.now();
let slow = 0;
let frames = 0;

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min((now - lastNow) / 1000, 0.05);
  lastNow = now;

  controls.autoRotate = state.spin && !painter.userDown;
  controls.update(dt);
  painter.advance(dt);
  painter.updateHeads();
  loom.update(painter.phi, painter.userDown || (state.interacted && state.mode === 'paint'), dt);

  const u = field.material.uniforms;
  u.uTime.value = painter.simTime;
  u.uCamDist.value = camera.position.length();
  field.flush();
  composer.render();

  // adaptive resolution: drop the pixel ratio if frames stay slow
  frames++;
  if (dt > 0.034) slow++;
  if (frames % 90 === 0) {
    if (slow > 55 && pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25);
      resize();
    }
    slow = 0;
  }
}
frame();
