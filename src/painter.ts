import * as THREE from 'three';
import { MAX_COPIES, RibbonField } from './ribbon';
import { makeGlowTexture } from './glow';

const MIN_SPACING = 0.02;
const FILL_STEP = 0.045;
const MAX_RADIUS = 4.3;
const GHOST_SUBSTEP = 1 / 150;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface GhostCurve {
  dur: number;
  u0: number; a1: number; f1: number; p1: number; a2: number; f2: number; p2: number;
  v0: number; sweep: number; b1: number; g1: number; q1: number; b2: number; g2: number; q2: number;
}

/**
 * Turns pointer (or ghost) motion into ribbon points on a vertical drawing plane
 * that contains the sculpture axis, follows the camera and slowly swings around it.
 */
export class Painter {
  simTime = 0;
  depth = 0.55;
  sweep = 1;
  userDown = false;
  ghostOn = true;

  readonly normal = new THREE.Vector3(0, 0, 1);
  readonly uAxis = new THREE.Vector3(1, 0, 0);
  /** Plane yaw around Y, for the visual guide. */
  phi = 0;

  readonly heads: THREE.Points;

  private readonly raycaster = new THREE.Raycaster();
  private readonly headPos = new Float32Array(MAX_COPIES * 3);
  private readonly cur = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private active = false;
  private lastClock = 0;
  private speed = 0;
  private widthSm = 0.1;
  private pointsInStroke = 0;
  private pathLen = 0;
  private pathUV = 0;
  private lastU = 0;
  private lastV = 0;
  private colorBase = 0;
  private zPhase = 0;
  private sx = 0;
  private sy = 0;
  private smoothInit = false;

  private rnd = mulberry32(7);
  private curve: GhostCurve | null = null;
  private gt = 0;
  private pause = 0;
  private strokeCount = 0;

  constructor(private readonly field: RibbonField, private readonly camera: THREE.PerspectiveCamera) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.headPos, 3));
    g.setDrawRange(0, 0);
    this.heads = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.4,
        map: makeGlowTexture(),
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
        opacity: 0.55,
      }),
    );
    this.heads.frustumCulled = false;
    this.updatePlane();
  }

  updatePlane(): void {
    const c = this.camera.position;
    let nx = c.x;
    let nz = c.z;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    const theta = this.sweep * this.depth * 0.95 * Math.sin(this.simTime * 0.42);
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const rx = nx * ct + nz * st;
    const rz = -nx * st + nz * ct;
    this.normal.set(rx, 0, rz);
    this.uAxis.set(rz, 0, -rx);
    this.phi = Math.atan2(rx, rz);
  }

  private planePoint(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
    const r = Math.hypot(u, v);
    if (r > MAX_RADIUS) {
      u *= MAX_RADIUS / r;
      v *= MAX_RADIUS / r;
    }
    const z = this.depth * 1.15 * Math.sin(this.pathUV * 0.8 + this.zPhase);
    return out.copy(this.uAxis).multiplyScalar(u).addScaledVector(this.normal, z).setY(v);
  }

  /** Project a pointer position (client coords relative to canvas rect) onto the drawing plane. */
  pointerToPlane(nx: number, ny: number): { u: number; v: number } | null {
    this.ndc.set(nx, ny);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    const denom = this.normal.dot(direction);
    if (Math.abs(denom) < 0.04) return null;
    const t = -this.normal.dot(origin) / denom;
    if (t <= 0) return null;
    this.tmp.copy(origin).addScaledVector(direction, t);
    return { u: this.tmp.dot(this.uAxis), v: this.tmp.y };
  }

  // ---- stroke engine -------------------------------------------------

  private beginStroke(): void {
    this.active = false;
    this.speed = 0;
    this.widthSm = 0.1;
    this.pointsInStroke = 0;
    this.pathLen = 0;
    this.pathUV = 0;
    this.zPhase = this.rnd() * Math.PI * 2;
    this.colorBase = this.rnd();
    this.smoothInit = false;
  }

  endStroke(): void {
    if (this.active) {
      this.field.taperTail(8);
      this.field.endStroke();
    }
    this.active = false;
    this.heads.geometry.setDrawRange(0, 0);
  }

  private sample(u: number, v: number, clock: number, birth: number): void {
    this.planePoint(u, v, this.tmp);
    const p = this.tmp;
    if (!this.active) {
      this.cur.copy(p);
      this.lastClock = clock;
      this.lastU = u;
      this.lastV = v;
      this.active = true;
      this.emit(p, birth, true);
      return;
    }
    const dist = p.distanceTo(this.cur);
    if (dist < MIN_SPACING) return;
    const dt = Math.max(clock - this.lastClock, 1e-3);
    this.speed += (dist / dt - this.speed) * 0.22;
    const du = Math.hypot(u - this.lastU, v - this.lastV);
    const steps = Math.max(1, Math.ceil(dist / FILL_STEP));
    const from = this.cur.clone();
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      this.pathUV += du / steps;
      const q = from.clone().lerp(p, k);
      this.emit(q, birth - dt * (1 - k), false);
    }
    this.cur.copy(p);
    this.lastClock = clock;
    this.lastU = u;
    this.lastV = v;
  }

  private emit(p: THREE.Vector3, birth: number, first: boolean): void {
    const target = 0.12 - 0.095 * smooth(2.0, 11, this.speed);
    this.widthSm += (target - this.widthSm) * 0.2;
    const ramp = Math.min(1, (this.pointsInStroke + 1) / 9);
    const w = this.widthSm * (0.18 + 0.82 * ramp);
    this.pathLen += first ? 0 : FILL_STEP;
    const ct = this.colorBase + this.pathLen * 0.03 + this.simTime * 0.035;
    this.field.addPoint(p.x, p.y, p.z, w, birth, ct, first);
    this.pointsInStroke++;
  }

  // ---- user input ----------------------------------------------------

  userBegin(nx: number, ny: number, clock: number): void {
    this.endStroke();
    this.userDown = true;
    this.beginStroke();
    this.userMove(nx, ny, clock);
  }

  userMove(nx: number, ny: number, clock: number): void {
    if (!this.userDown) return;
    const hit = this.pointerToPlane(nx, ny);
    if (!hit) return;
    if (!this.smoothInit) {
      this.sx = hit.u;
      this.sy = hit.v;
      this.smoothInit = true;
    } else {
      this.sx += (hit.u - this.sx) * 0.55;
      this.sy += (hit.v - this.sy) * 0.55;
    }
    this.sample(this.sx, this.sy, clock, this.simTime);
  }

  userEnd(): void {
    if (!this.userDown) return;
    this.userDown = false;
    this.endStroke();
  }

  // ---- ghost brush ---------------------------------------------------

  private newCurve(): void {
    const r = this.rnd;
    const n = this.strokeCount++;
    const sweepy = n % 2 === 0;
    this.curve = {
      dur: 5.5 + r() * 3,
      u0: 1.3 + r() * 1.1,
      a1: 0.55 + r() * 0.7,
      f1: 1.1 + r() * 1.5,
      p1: r() * 6.28,
      a2: 0.15 + r() * 0.4,
      f2: 2.6 + r() * 2.6,
      p2: r() * 6.28,
      v0: (r() - 0.5) * 1.2,
      sweep: sweepy ? 1.7 + r() * 0.7 : 0,
      b1: sweepy ? 0.35 + r() * 0.3 : 0.9 + r() * 0.9,
      g1: 0.9 + r() * 1.6,
      q1: r() * 6.28,
      b2: 0.12 + r() * 0.3,
      g2: 2.2 + r() * 2.4,
      q2: r() * 6.28,
    };
    this.gt = 0;
    this.beginStroke();
  }

  private ghostStep(dt: number): void {
    if (!this.curve) {
      if (this.pause > 0) {
        this.pause -= dt;
        return;
      }
      this.newCurve();
    }
    const c = this.curve!;
    this.gt += dt;
    if (this.gt > c.dur) {
      this.endStroke();
      this.curve = null;
      this.pause = 0.35 + this.rnd() * 0.5;
      return;
    }
    const t = this.gt;
    const k = t / c.dur;
    const env = smooth(0, 0.08, k);
    const u = c.u0 + env * (c.a1 * Math.sin(c.f1 * t + c.p1) + c.a2 * Math.sin(c.f2 * t + c.p2));
    const v =
      c.v0 + c.sweep * (k - 0.5) * 2.4 + c.b1 * Math.sin(c.g1 * t + c.q1) + c.b2 * Math.sin(c.g2 * t + c.q2);
    this.sample(u, v, this.simTime, this.simTime);
  }

  /** Advance the clock and feed the ghost brush. */
  advance(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / GHOST_SUBSTEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.simTime += h;
      this.updatePlane();
      if (this.ghostOn && !this.userDown) this.ghostStep(h);
    }
    if (!this.ghostOn && !this.userDown && this.active) this.endStroke();
  }

  /** Forget the running ghost stroke (used when ghost is toggled). */
  resetGhost(): void {
    if (!this.userDown) this.endStroke();
    this.curve = null;
    this.pause = 0;
  }

  // ---- brush heads ---------------------------------------------------

  updateHeads(): void {
    const geo = this.heads.geometry;
    if (!this.active) {
      geo.setDrawRange(0, 0);
      return;
    }
    const n = this.field.copies;
    for (let i = 0; i < n; i++) {
      const [ang, mir] = this.field.getCopyParams(i);
      let x = this.cur.x;
      if (mir > 0.5) x = -x;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      this.headPos[i * 3] = c * x + s * this.cur.z;
      this.headPos[i * 3 + 1] = this.cur.y;
      this.headPos[i * 3 + 2] = -s * x + c * this.cur.z;
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, n);
  }
}
