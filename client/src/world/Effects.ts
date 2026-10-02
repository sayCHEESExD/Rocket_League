import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Points,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';

const MAX = 2400;

interface Burst {
  mesh: Mesh;
  t: number;
  life: number;
  grow: number;
}

/**
 * Every particle in the game in two draw calls (one additive "light" layer,
 * one normal "smoke" layer), plus a few pooled shockwave meshes for goals and
 * demolitions. All CPU-side, allocation-free per frame.
 */
export class Effects {
  readonly root = new Group();
  private readonly layers: Layer[];
  private readonly bursts: Burst[] = [];
  private readonly c = new Color();

  constructor() {
    this.layers = [new Layer(MAX, true), new Layer(900, false)];
    for (const l of this.layers) this.root.add(l.points);
    for (let i = 0; i < 4; i += 1) {
      const sphere = new Mesh(new SphereGeometry(1, 24, 14), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
      sphere.visible = false;
      this.root.add(sphere);
      this.bursts.push({ mesh: sphere, t: 1, life: 1, grow: 1 });
      const ring = new Mesh(new TorusGeometry(1, 0.08, 6, 48), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
      ring.visible = false;
      this.root.add(ring);
      this.bursts.push({ mesh: ring, t: 1, life: 1, grow: 1 });
    }
  }

  /** Light particle (additive). Position/velocity in three units. */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number | Color, size: number, life: number, gravity = 0, drag = 0): void {
    this.layers[0]!.emit(x, y, z, vx, vy, vz, color instanceof Color ? color : this.c.set(color), size, life, gravity, drag);
  }

  /** Smoke particle (normal blending). */
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, size: number, life: number): void {
    this.layers[1]!.emit(x, y, z, vx, vy, vz, this.c.set(color), size, life, 0.9, 1.4);
  }

  burst(kind: 'sphere' | 'ring', x: number, y: number, z: number, color: number | Color, size: number, life: number, rotX = 0): void {
    const want = kind === 'sphere' ? 0 : 1;
    let best: Burst | null = null;
    for (let i = want; i < this.bursts.length; i += 2) {
      const b = this.bursts[i]!;
      if (!best || b.t / b.life > best.t / best.life) best = b;
    }
    if (!best) return;
    best.t = 0;
    best.life = life;
    best.grow = size;
    best.mesh.position.set(x, y, z);
    best.mesh.rotation.set(rotX, 0, 0);
    (best.mesh.material as MeshBasicMaterial).color.set(color);
    best.mesh.visible = true;
  }

  /** A spray of sparks from an impact. */
  impact(x: number, y: number, z: number, strength: number, color: number | Color = 0xfff0a0): void {
    const n = Math.min(60, Math.floor(6 + strength / 60));
    for (let i = 0; i < n; i += 1) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 4) * (0.5 + strength / 2500);
      const r = Math.sqrt(1 - u * u);
      this.spark(x, y, z, Math.cos(a) * r * s, Math.abs(u) * s * 0.8 + 1, Math.sin(a) * r * s, color, 0.08 + Math.random() * 0.1, 0.35 + Math.random() * 0.4, -9, 1.2);
    }
  }

  /** The goal explosion: shockwave, sphere flash, a column of team-coloured sparks and confetti. */
  goal(x: number, y: number, z: number, team: Color): void {
    this.burst('sphere', x, y, z, team, 9, 0.9);
    this.burst('ring', x, y, z, 0xffffff, 14, 1.1, Math.PI / 2);
    this.burst('ring', x, y, z, team, 10, 0.8, Math.PI / 2 + 0.6);
    const white = new Color(0xffffff);
    for (let i = 0; i < 420; i += 1) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = 6 + Math.random() * 16;
      const col = Math.random() < 0.7 ? team : white;
      this.spark(x, y, z, Math.cos(a) * r * s, u * s * 0.7 + 5, Math.sin(a) * r * s, col, 0.14 + Math.random() * 0.22, 0.9 + Math.random() * 1.4, -7, 0.9);
    }
    // confetti: small, bright, long-lived, drifting down
    const confetti = [0xffffff, 0xffe066, 0x7ff3ff, 0xff7ad9];
    for (let i = 0; i < 160; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 9;
      this.spark(x, y + 1, z, Math.cos(a) * s, 6 + Math.random() * 10, Math.sin(a) * s, i % 3 === 0 ? team : confetti[i % 4]!, 0.09 + Math.random() * 0.06, 2.2 + Math.random() * 1.5, -3.5, 1.6);
    }
    for (let i = 0; i < 26; i += 1) {
      this.smoke(x + (Math.random() - 0.5) * 3, y + Math.random() * 2, z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4, 0xe8ecf6, 0.5 + Math.random() * 0.5, 0.9 + Math.random() * 0.5);
    }
  }

  demo(x: number, y: number, z: number): void {
    this.burst('sphere', x, y, z, 0xff8a2a, 3.2, 0.6);
    this.impact(x, y, z, 2500, 0xffb050);
    for (let i = 0; i < 18; i += 1) {
      this.smoke(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0x55585f, 0.35 + Math.random() * 0.35, 0.8 + Math.random() * 0.5);
    }
  }

  /** Point sprites scale with the viewport so a particle has the same world size everywhere. */
  setViewport(heightPx: number, fovDeg: number): void {
    const k = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const l of this.layers) l.setScale(k);
  }

  update(dt: number): void {
    for (const l of this.layers) l.update(dt);
    for (const b of this.bursts) {
      if (b.t >= b.life) continue;
      b.t += dt;
      const k = Math.min(1, b.t / b.life);
      const e = 1 - Math.pow(1 - k, 3);
      b.mesh.scale.setScalar(0.2 + e * b.grow);
      (b.mesh.material as MeshBasicMaterial).opacity = (1 - k) * 0.9;
      if (b.t >= b.life) b.mesh.visible = false;
    }
  }
}

class Layer {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly base: Float32Array;
  private next = 0;
  private readonly geo: BufferGeometry;

  constructor(private readonly max: number, private readonly additive: boolean) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.base = new Float32Array(max);
    this.life.fill(1);
    const g = new BufferGeometry();
    const attr = (a: Float32Array, n: number): BufferAttribute => new BufferAttribute(a, n).setUsage(DynamicDrawUsage);
    g.setAttribute('position', attr(this.pos, 3));
    g.setAttribute('color', attr(this.col, 3));
    g.setAttribute('size', attr(this.size, 1));
    g.setAttribute('alpha', attr(this.alpha, 1));
    this.geo = g;
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      vertexColors: true,
      uniforms: { uScale: { value: 600 } },
      vertexShader: `attribute float size; attribute float alpha; varying vec3 vColor; varying float vAlpha; uniform float uScale;
        void main(){ vColor = color; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vColor; varying float vAlpha;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard;
          float a = vAlpha * (1.0 - r * 4.0); gl_FragColor = vec4(vColor, a); }`,
    });
    this.points = new Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: Color, size: number, life: number, gravity: number, drag: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.base[i] = size;
    this.size[i] = size;
    this.life[i] = life;
    this.age[i] = 0;
    this.grav[i] = gravity;
    this.drag[i] = drag;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i += 1) {
      if (this.age[i]! >= this.life[i]!) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      const a = (this.age[i] = this.age[i]! + dt);
      const k = a / this.life[i]!;
      const d = Math.max(0, 1 - this.drag[i]! * dt);
      this.vel[i * 3] = this.vel[i * 3]! * d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * d + this.grav[i]! * dt;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! * d;
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
      this.alpha[i] = k >= 1 ? 0 : (1 - k) * (k < 0.1 ? k * 10 : 1);
      this.size[i] = this.base[i]! * (this.additive ? 1 : 1 + k * 2);
    }
    this.geo.attributes['position']!.needsUpdate = true;
    this.geo.attributes['color']!.needsUpdate = true;
    this.geo.attributes['size']!.needsUpdate = true;
    this.geo.attributes['alpha']!.needsUpdate = true;
  }

  setScale(s: number): void {
    (this.points.material as ShaderMaterial).uniforms['uScale']!.value = s;
  }
}
