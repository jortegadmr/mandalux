import * as THREE from 'three';
import { ribbonFragment, ribbonVertex } from './shaders';
import type { Palette } from './palettes';

const STRIDE = 10; // pos3 tan3 side width birth colorT
export const MAX_COPIES = 32;

/**
 * A ring buffer of ribbon points. Every point owns two vertices (left/right edge).
 * The whole buffer is drawn once per symmetry copy through GPU instancing.
 */
export class RibbonField {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly cap: number;
  private readonly data: Float32Array;
  private readonly buf: THREE.InterleavedBuffer;
  private readonly index: Uint32Array;
  private readonly indexAttr: THREE.BufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly copyAttr: THREE.InstancedBufferAttribute;
  private head = 0;
  private filled = 0;
  private last = -1;
  private last2 = -1;
  private dirtyLo = Infinity;
  private dirtyHi = -1;
  private fullDirty = false;
  private idxLo = Infinity;
  private idxHi = -1;

  constructor(capacity = 14000) {
    this.cap = capacity;
    this.data = new Float32Array(capacity * 2 * STRIDE);
    this.buf = new THREE.InterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    this.index = new Uint32Array(capacity * 6);
    this.indexAttr = new THREE.BufferAttribute(this.index, 1);
    this.indexAttr.setUsage(THREE.DynamicDrawUsage);

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buf, 3, 0));
    g.setAttribute('aTan', new THREE.InterleavedBufferAttribute(this.buf, 3, 3));
    g.setAttribute('aParams', new THREE.InterleavedBufferAttribute(this.buf, 4, 6));
    g.setIndex(this.indexAttr);
    this.copyAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_COPIES * 3), 3);
    g.setAttribute('aCopy', this.copyAttr);
    g.setDrawRange(0, 0);
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      vertexShader: ribbonVertex,
      fragmentShader: ribbonFragment,
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: 10 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCamDist: { value: 9 },
        uSpread: { value: 0.1 },
        uGain: { value: 0.62 },
        uPal: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }

  setPalette(p: Palette): void {
    const arr = this.material.uniforms.uPal.value as THREE.Color[];
    p.stops.forEach((hex, i) => arr[i].set(hex));
  }

  /** Configure N-fold rotation and optional mirror (dihedral) copies. */
  setSymmetry(n: number, mirror: boolean): void {
    const a = this.copyAttr.array as Float32Array;
    let k = 0;
    const total = n * (mirror ? 2 : 1);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      a[k * 3] = ang;
      a[k * 3 + 1] = 0;
      a[k * 3 + 2] = k / total;
      k++;
      if (mirror) {
        a[k * 3] = ang;
        a[k * 3 + 1] = 1;
        a[k * 3 + 2] = k / total;
        k++;
      }
    }
    this.copyAttr.needsUpdate = true;
    this.geometry.instanceCount = total;
  }

  get copies(): number {
    return this.geometry.instanceCount;
  }

  getCopyParams(i: number): [number, number] {
    const a = this.copyAttr.array as Float32Array;
    return [a[i * 3], a[i * 3 + 1]];
  }

  endStroke(): void {
    this.last = -1;
    this.last2 = -1;
  }

  private writeVertices(i: number, px: number, py: number, pz: number, tx: number, ty: number, tz: number, w: number, birth: number, ct: number): void {
    for (let s = 0; s < 2; s++) {
      const o = (i * 2 + s) * STRIDE;
      const d = this.data;
      d[o] = px; d[o + 1] = py; d[o + 2] = pz;
      d[o + 3] = tx; d[o + 4] = ty; d[o + 5] = tz;
      d[o + 6] = s === 0 ? -1 : 1;
      d[o + 7] = w; d[o + 8] = birth; d[o + 9] = ct;
    }
  }

  private setTangent(i: number, tx: number, ty: number, tz: number): void {
    for (let s = 0; s < 2; s++) {
      const o = (i * 2 + s) * STRIDE + 3;
      this.data[o] = tx; this.data[o + 1] = ty; this.data[o + 2] = tz;
    }
  }

  private touch(i: number): void {
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
  }

  private touchIndex(i: number): void {
    if (i < this.idxLo) this.idxLo = i;
    if (i > this.idxHi) this.idxHi = i;
  }

  private writeSegment(slot: number, connected: boolean): void {
    const o = slot * 6;
    if (connected) {
      const a = ((slot - 1 + this.cap) % this.cap) * 2;
      const b = slot * 2;
      this.index[o] = a;
      this.index[o + 1] = a + 1;
      this.index[o + 2] = b;
      this.index[o + 3] = a + 1;
      this.index[o + 4] = b + 1;
      this.index[o + 5] = b;
    } else {
      this.index.fill(0, o, o + 6);
    }
    this.touchIndex(slot);
  }

  addPoint(x: number, y: number, z: number, width: number, birth: number, colorT: number, newStroke: boolean): number {
    const i = this.head;
    this.head = (i + 1) % this.cap;
    this.filled = Math.min(this.filled + 1, this.cap);
    if (i === 0) this.fullDirty = true;
    const connected = !newStroke && this.last >= 0 && i !== 0;
    let tx = 0, ty = 0, tz = 0;
    if (connected) {
      const pv = this.last * 2 * STRIDE;
      tx = x - this.data[pv]; ty = y - this.data[pv + 1]; tz = z - this.data[pv + 2];
      const l = Math.hypot(tx, ty, tz) || 1;
      tx /= l; ty /= l; tz /= l;
      if (this.last2 >= 0) {
        const pp = this.last2 * 2 * STRIDE;
        let ux = x - this.data[pp], uy = y - this.data[pp + 1], uz = z - this.data[pp + 2];
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        this.setTangent(this.last, ux, uy, uz);
      } else {
        this.setTangent(this.last, tx, ty, tz);
      }
      this.touch(this.last);
    }
    this.writeVertices(i, x, y, z, tx, ty, tz, width, birth, colorT);
    this.touch(i);
    this.writeSegment(i, connected);
    this.writeSegment((i + 1) % this.cap, false);
    this.last2 = connected ? this.last : -1;
    this.last = i;
    this.geometry.setDrawRange(0, this.filled * 6);
    return i;
  }

  private setWidth(i: number, w: number): void {
    this.data[i * 2 * STRIDE + 7] = w;
    this.data[(i * 2 + 1) * STRIDE + 7] = w;
    this.touch(i);
  }

  /** Taper the last k points of the current stroke towards zero width. */
  taperTail(k: number): void {
    let i = this.last;
    if (i < 0) return;
    for (let j = 0; j < k; j++) {
      const w = this.data[i * 2 * STRIDE + 7];
      this.setWidth(i, w * ((j + 0.6) / (k + 0.6)));
      // stop at the stroke start (its segment slot has no indices)
      if (this.index[i * 6 + 2] === 0 && this.index[i * 6 + 4] === 0) break;
      i = (i - 1 + this.cap) % this.cap;
    }
  }

  clear(): void {
    this.index.fill(0);
    this.data.fill(0);
    this.head = 0;
    this.filled = 0;
    this.last = -1;
    this.last2 = -1;
    this.geometry.setDrawRange(0, 0);
    this.fullDirty = true;
  }

  flush(): void {
    if (this.fullDirty) {
      this.dirtyLo = 0;
      this.dirtyHi = this.cap - 1;
      this.idxLo = 0;
      this.idxHi = this.cap - 1;
      this.fullDirty = false;
    }
    if (this.dirtyHi >= 0) {
      this.buf.clearUpdateRanges();
      const start = this.dirtyLo * 2 * STRIDE;
      this.buf.addUpdateRange(start, (this.dirtyHi + 1) * 2 * STRIDE - start);
      this.buf.needsUpdate = true;
      this.dirtyLo = Infinity;
      this.dirtyHi = -1;
    }
    if (this.idxHi >= 0) {
      this.indexAttr.clearUpdateRanges();
      this.indexAttr.addUpdateRange(this.idxLo * 6, (this.idxHi + 1 - this.idxLo) * 6);
      this.indexAttr.needsUpdate = true;
      this.idxLo = Infinity;
      this.idxHi = -1;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
