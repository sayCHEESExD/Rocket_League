import { PADS } from '@rlb/shared';
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
} from 'three';
import { S } from './units.js';

/** The spinner outline: three swept arms with rounded tips around a hub. */
const spinnerShape = (): Shape => {
  const pts: Vector2[] = [];
  const N = 96;
  for (let i = 0; i < N; i += 1) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(3 * t);
    const k = Math.max(0, Math.min(1, (c - 0.05) / 0.95)) ** 0.42;
    const r = 0.72 + 1.22 * k;
    // sweep the arms: the further out, the more the angle trails
    const a = t + 0.5 * (r - 0.72);
    pts.push(new Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return new Shape(pts);
};

/** Angle of arm k's centreline at radius r (matching the sweep above). */
const armAngle = (k: number, r: number): number => (k * Math.PI * 2) / 3 + 0.5 * (r - 0.72);

const radial = (stops: [number, string][], size = 128): CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

/** A flame card: hot at the base, licking up and fading. */
const flameTexture = (): CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 128; y += 1) {
    const k = 1 - y / 128; // 1 at the bottom
    const w = 30 * Math.pow(k, 0.6);
    const grad = g.createLinearGradient(32 - w, 0, 32 + w, 0);
    grad.addColorStop(0, 'rgba(255,120,0,0)');
    grad.addColorStop(0.5, `rgba(255,${Math.round(160 + 80 * k)},${Math.round(40 * k)},${(k * k * 0.9).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 127 - y, 64, 1);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

/** Swirling molten gold for the orb. */
const orbTexture = (): CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c96a00';
  g.fillRect(0, 0, 256, 128);
  let seed = 3;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i += 1) {
    const x = rnd() * 256;
    const y = rnd() * 128;
    const r = 6 + rnd() * 22;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const hot = rnd() < 0.5;
    grad.addColorStop(0, hot ? 'rgba(255,240,170,0.9)' : 'rgba(150,60,0,0.7)');
    grad.addColorStop(1, 'rgba(255,170,30,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(x, y, r * 1.8, r * 0.7, rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

const LIT_YELLOW = new Color(1.0, 0.62, 0.02).multiplyScalar(1.15);
const LIT_TIP = new Color(1.0, 0.28, 0.0).multiplyScalar(3.4);
const LIT_CORE = new Color(1, 1, 1).multiplyScalar(3);
const DIM = new Color(0x3a3220);
const DIM_CORE = new Color(0x221a10);

/**
 * BOOST PADS, after the reference: a dark steel three-armed spinner, a yellow
 * pad on each arm with flames licking off it, orange lights at the tips, a
 * glowing core ring - and over the big pads a hovering orb of molten gold.
 * Small pads are the same design at half size without the orb. Everything
 * is instanced: a dozen draw calls for all thirty-four.
 */
export class BoostPads {
  readonly root = new Group();
  private readonly base: InstancedMesh;
  private readonly inlays: InstancedMesh;
  private readonly tips: InstancedMesh;
  private readonly cores: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly flames: InstancedMesh;
  private readonly orbs: InstancedMesh;
  private readonly glows: Sprite[] = [];
  private readonly bigIndex = new Map<number, number>();
  private readonly dummy = new Object3D();
  private readonly lit: boolean[] = PADS.map(() => true);
  private t = 0;

  constructor() {
    const n = PADS.length;
    const baseGeo = new ExtrudeGeometry(spinnerShape(), { depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.05, bevelSegments: 1, curveSegments: 1 });
    baseGeo.rotateX(-Math.PI / 2);
    baseGeo.translate(0, 0.02, 0);
    this.base = new InstancedMesh(baseGeo, new MeshStandardMaterial({ color: 0x2c3d6e, metalness: 0.65, roughness: 0.32, envMapIntensity: 1.2 }), n);
    this.base.receiveShadow = true;
    const inlayGeo = new BoxGeometry(0.3, 0.06, 0.62);
    inlayGeo.translate(0, 0.13, 0);
    this.inlays = new InstancedMesh(inlayGeo, new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n * 3);
    const tipGeo = new BoxGeometry(0.12, 0.1, 0.5);
    tipGeo.translate(0, 0.12, 0);
    this.tips = new InstancedMesh(tipGeo, new MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), n * 3);
    const ringGeo = new TorusGeometry(0.5, 0.075, 8, 32);
    ringGeo.rotateX(Math.PI / 2);
    ringGeo.translate(0, 0.14, 0);
    this.rings = new InstancedMesh(ringGeo, new MeshStandardMaterial({ color: 0x1b2440, metalness: 0.7, roughness: 0.3 }), n);
    const coreGeo = new CircleGeometry(0.47, 32);
    coreGeo.rotateX(-Math.PI / 2);
    coreGeo.translate(0, 0.145, 0);
    const coreTex = radial([
      [0, '#fff6c8'],
      [0.45, '#ffc21a'],
      [0.8, '#ff7a00'],
      [1, '#ffcf5a'],
    ]);
    this.cores = new InstancedMesh(coreGeo, new MeshBasicMaterial({ map: coreTex, toneMapped: false }), n);
    const flameGeo = new PlaneGeometry(0.62, 0.9);
    flameGeo.translate(0, 0.55, 0);
    this.flames = new InstancedMesh(
      flameGeo,
      new MeshBasicMaterial({ map: flameTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, toneMapped: false, color: new Color(3, 2.2, 1.4) }),
      n * 6,
    );
    this.flames.renderOrder = 8;
    const big = PADS.filter((p) => p[2]).length;
    this.orbs = new InstancedMesh(new IcosahedronGeometry(0.42, 3), new MeshBasicMaterial({ map: orbTexture(), toneMapped: false, color: new Color(3.2, 2.4, 1.3) }), big);
    const glowTex = radial([
      [0, 'rgba(255,220,120,1)'],
      [0.3, 'rgba(255,160,40,0.55)'],
      [1, 'rgba(255,120,0,0)'],
    ]);
    let bi = 0;
    PADS.forEach(([x, y, isBig], i) => {
      const s = isBig ? 1 : 0.52;
      const px = x * S;
      const pz = -y * S;
      // base, ring, core
      this.dummy.position.set(px, 0, pz);
      this.dummy.rotation.set(0, i * 0.7, 0);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.base.setMatrixAt(i, this.dummy.matrix);
      this.rings.setMatrixAt(i, this.dummy.matrix);
      this.cores.setMatrixAt(i, this.dummy.matrix);
      // per-arm parts (inlay, tip), in the base's spun frame
      for (let k = 0; k < 3; k += 1) {
        const a1 = armAngle(k, 1.42) + i * 0.7;
        const a2 = armAngle(k, 1.8) + i * 0.7;
        // shape angle is CCW in the base's XY plane; after rotateX(-90) that plane is XZ with z = -y
        this.dummy.position.set(px + Math.cos(a1) * 1.42 * s, 0, pz - Math.sin(a1) * 1.42 * s);
        this.dummy.rotation.set(0, a1, 0);
        this.dummy.scale.setScalar(s);
        this.dummy.updateMatrix();
        this.inlays.setMatrixAt(i * 3 + k, this.dummy.matrix);
        this.dummy.position.set(px + Math.cos(a2) * 1.8 * s, 0, pz - Math.sin(a2) * 1.8 * s);
        this.dummy.rotation.set(0, a2, 0);
        this.dummy.updateMatrix();
        this.tips.setMatrixAt(i * 3 + k, this.dummy.matrix);
      }
      if (isBig) {
        this.bigIndex.set(i, bi);
        const sp = new Sprite(new SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, color: new Color(2, 1.6, 1.1) }));
        sp.scale.set(3, 3, 1);
        sp.position.set(px, 1.05, pz);
        sp.renderOrder = 9;
        this.root.add(sp);
        this.glows.push(sp);
        bi += 1;
      }
    });
    for (const m of [this.base, this.rings, this.cores, this.inlays, this.tips]) m.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < n; i += 1) this.setLit(i, true);
    this.root.add(this.base, this.rings, this.cores, this.inlays, this.tips, this.flames, this.orbs);
    this.root.name = 'boost-pads';
  }

  private setLit(i: number, on: boolean): void {
    this.lit[i] = on;
    for (let k = 0; k < 3; k += 1) {
      this.inlays.setColorAt(i * 3 + k, on ? LIT_YELLOW : DIM);
      this.tips.setColorAt(i * 3 + k, on ? LIT_TIP : DIM);
    }
    this.cores.setColorAt(i, on ? LIT_CORE : DIM_CORE);
    for (const m of [this.inlays, this.tips, this.cores]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** `pads[i]` > 0 while pad i is recharging. */
  update(dt: number, pads: Int32Array): void {
    this.t += dt;
    const t = this.t;
    PADS.forEach(([x, y, isBig], i) => {
      const on = pads[i]! <= 0;
      if (on !== this.lit[i]) this.setLit(i, on);
      const s = isBig ? 1 : 0.52;
      const px = x * S;
      const pz = -y * S;
      // flames: two crossed cards per arm, flickering
      for (let k = 0; k < 3; k += 1) {
        const a = armAngle(k, 1.42) + i * 0.7;
        const fx = px + Math.cos(a) * 1.42 * s;
        const fz = pz - Math.sin(a) * 1.42 * s;
        for (let c = 0; c < 2; c += 1) {
          const f = 0.75 + 0.35 * Math.sin(t * 11 + i * 3.1 + k * 2 + c * 1.7) + Math.random() * 0.12;
          this.dummy.position.set(fx, 0, fz);
          this.dummy.rotation.set(0, a + c * Math.PI * 0.5, 0);
          this.dummy.scale.set(s, on ? s * f : 0.0001, s);
          this.dummy.updateMatrix();
          this.flames.setMatrixAt((i * 3 + k) * 2 + c, this.dummy.matrix);
        }
      }
      const b = this.bigIndex.get(i);
      if (b !== undefined) {
        this.dummy.position.set(px, 1.05 + Math.sin(t * 2.2 + i) * 0.08, pz);
        this.dummy.rotation.set(t * 0.4, t * 1.3 + i, 0);
        this.dummy.scale.setScalar(on ? 1 : 0.0001);
        this.dummy.updateMatrix();
        this.orbs.setMatrixAt(b, this.dummy.matrix);
        const g = this.glows[b]!;
        g.visible = on;
        g.position.y = this.dummy.position.y;
        const pulse = 2.9 + Math.sin(t * 4 + i) * 0.2;
        g.scale.set(pulse, pulse, 1);
      }
    });
    this.flames.instanceMatrix.needsUpdate = true;
    this.orbs.instanceMatrix.needsUpdate = true;
  }
}
