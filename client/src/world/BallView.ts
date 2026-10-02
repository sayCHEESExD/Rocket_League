import { BALL } from '@rlb/shared';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { shadowTexture } from './CarView.js';
import { S } from './units.js';

/** A soccer-ish panel pattern: dark hexagons with glowing seams. */
const ballTexture = (): CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9dde6';
  g.fillRect(0, 0, 512, 256);
  const hex = (cx: number, cy: number, r: number, fill: string): void => {
    g.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = '#7fe8ff';
    g.lineWidth = 3;
    g.stroke();
  };
  for (let row = 0; row < 7; row += 1) {
    for (let col = 0; col < 13; col += 1) {
      const cx = col * 42 + (row % 2) * 21;
      const cy = row * 38 + 10;
      hex(cx, cy, 20, (row + col) % 3 === 0 ? '#3b4256' : '#b9bfcc');
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

const tmpQ = new Quaternion();
const axis = new Vector3();

/**
 * The ball: panelled sphere that visibly rolls with its motion, a glowing
 * equator ring, a ground shadow (the key depth cue for aerials), and a hit
 * flash.
 */
export class BallView {
  readonly root = new Group();
  readonly mesh: Mesh;
  private readonly ring: Mesh;
  readonly shadow: Mesh;
  private readonly flashMat: MeshBasicMaterial;
  private readonly flash: Mesh;
  private flashT = 0;
  private readonly last = new Vector3();
  private hasLast = false;

  constructor() {
    const r = BALL.radius * S;
    const mat = new MeshPhongMaterial({ map: ballTexture(), shininess: 80, specular: 0x888888, emissive: 0x111822 });
    this.mesh = new Mesh(new IcosahedronGeometry(r, 4), mat);
    this.mesh.name = 'ball';
    this.mesh.castShadow = true;
    this.root.add(this.mesh);
    this.ring = new Mesh(new RingGeometry(r * 1.02, r * 1.1, 48), new MeshBasicMaterial({ color: 0x8ff6ff, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, side: 2 }));
    this.ring.rotation.x = Math.PI / 2;
    this.mesh.add(this.ring);
    this.flashMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    this.flash = new Mesh(new IcosahedronGeometry(r * 1.06, 2), this.flashMat);
    this.root.add(this.flash);
    this.shadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 2;
  }

  /** Place at sim coordinates; the spin is derived from how it moved (rolling look). */
  place(x: number, y: number, z: number, dt: number): void {
    const p = this.root.position;
    p.set(x * S, z * S, -y * S);
    if (this.hasLast && dt > 0) {
      const dx = p.x - this.last.x;
      const dz = p.z - this.last.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-5 && d < 2) {
        axis.set(dz, 0, -dx).normalize();
        tmpQ.setFromAxisAngle(axis, d / (BALL.radius * S));
        this.mesh.quaternion.premultiply(tmpQ);
      }
    }
    this.last.copy(p);
    this.hasLast = true;
    // shadow on the floor, fading with height
    const h = z - BALL.radius;
    const k = Math.max(0, 1 - h / 1800);
    this.shadow.position.set(p.x, 0.012, p.z);
    const size = BALL.radius * S * (2.1 + h * 0.0006);
    this.shadow.scale.set(size, size, 1);
    (this.shadow.material as MeshBasicMaterial).opacity = 0.25 + 0.75 * k;
  }

  hit(strength: number): void {
    this.flashT = Math.min(1, strength / 2500 + 0.25);
  }

  update(dt: number, ringColor: Color | null): void {
    this.flashT = Math.max(0, this.flashT - dt * 4);
    this.flashMat.opacity = this.flashT * 0.8;
    this.flash.visible = this.flashT > 0.01;
    if (ringColor) (this.ring.material as MeshBasicMaterial).color.lerp(ringColor, Math.min(1, dt * 4));
  }

  setVisible(on: boolean): void {
    this.root.visible = on;
    this.shadow.visible = on;
  }
}
