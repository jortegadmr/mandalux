import * as THREE from 'three';
import { makeGlowTexture } from './glow';

const FLOOR_Y = -3.1;

function additive<T extends THREE.Material>(m: T): T {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.AdditiveBlending;
  return m;
}

/** The faint scaffolding around the sculpture: floor rings, symmetry axes, drawing plane and dust. */
export class LoomFrame {
  readonly group = new THREE.Group();
  private readonly spokes = new THREE.Group();
  private readonly spokeMat = additive(new THREE.LineBasicMaterial({ color: 0x6f86ff, opacity: 0.2 }));
  private readonly mirrorMat = additive(new THREE.LineBasicMaterial({ color: 0x6f86ff, opacity: 0.07 }));
  private readonly plane = new THREE.Group();
  private readonly planeMats: THREE.MeshBasicMaterial[] = [];
  private readonly dust: THREE.Points;
  private level = 0.5;

  constructor() {
    const ringMat = additive(new THREE.LineBasicMaterial({ color: 0x5f78ff, opacity: 0.1 }));
    for (const r of [1.2, 2.4, 3.6, 4.8]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, FLOOR_Y, Math.sin(a) * r));
      }
      this.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
    }
    this.group.add(this.spokes);

    // loom axis
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, FLOOR_Y, 0),
      new THREE.Vector3(0, 4.6, 0),
    ]);
    this.group.add(new THREE.Line(axisGeo, additive(new THREE.LineBasicMaterial({ color: 0x9db0ff, opacity: 0.18 }))));

    // drawing plane guide
    const ringGeo = new THREE.RingGeometry(4.29, 4.31, 180);
    const fillGeo = new THREE.CircleGeometry(4.3, 90);
    const rm = additive(new THREE.MeshBasicMaterial({ color: 0x9fb4ff, opacity: 0.22, side: THREE.DoubleSide }));
    const fm = additive(new THREE.MeshBasicMaterial({ color: 0x6f86ff, opacity: 0.008, side: THREE.DoubleSide }));
    const lm = additive(new THREE.LineBasicMaterial({ color: 0x9fb4ff, opacity: 0.16 }));
    this.planeMats.push(rm, fm);
    this.plane.add(new THREE.Mesh(ringGeo, rm), new THREE.Mesh(fillGeo, fm));
    const cross = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-4.3, 0, 0),
      new THREE.Vector3(4.3, 0, 0),
    ]);
    this.plane.add(new THREE.Line(cross, lm));
    this.group.add(this.plane);

    // dust
    const n = 520;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 3.5 + Math.random() * 9;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.8;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dg,
      additive(new THREE.PointsMaterial({ color: 0x9db4ff, size: 0.16, opacity: 0.5, sizeAttenuation: true, map: makeGlowTexture() })),
    );
    this.group.add(this.dust);
  }

  setSymmetry(n: number, mirror: boolean): void {
    this.spokes.clear();
    const line = (a: number, r0: number, r1: number, mat: THREE.LineBasicMaterial): THREE.Line => {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(Math.cos(a) * r0, FLOOR_Y, -Math.sin(a) * r0),
        new THREE.Vector3(Math.cos(a) * r1, FLOOR_Y, -Math.sin(a) * r1),
      ]);
      return new THREE.Line(g, mat);
    };
    for (let k = 0; k < n; k++) this.spokes.add(line((k / n) * Math.PI * 2, 0.3, 4.8, this.spokeMat));
    if (mirror) {
      for (let k = 0; k < n * 2; k++) this.spokes.add(line(Math.PI / 2 + (k / (2 * n)) * Math.PI * 2, 0.3, 4.8, this.mirrorMat));
    }
  }

  setTint(hex: string): void {
    const c = new THREE.Color(hex);
    this.planeMats.forEach((m) => m.color.copy(c));
  }

  /** `active` raises the guide's visibility while the user paints. */
  update(phi: number, active: boolean, dt: number): void {
    this.plane.rotation.y = phi;
    const target = active ? 1 : 0.55;
    this.level += (target - this.level) * Math.min(1, dt * 5);
    this.planeMats[0].opacity = 0.22 * this.level;
    this.planeMats[1].opacity = 0.008 + 0.03 * (this.level - 0.55);
    this.dust.rotation.y += dt * 0.012;
  }
}
