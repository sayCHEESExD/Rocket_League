import { CAR } from '@rlb/shared';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Quaternion,
  Vector3,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S } from '../units.js';

/**
 * THE FIVE CARS, as data.
 *
 * Each body is LOFTED: a row of rounded cross-sections (superellipses with
 * tumblehome) along the car's length, skinned into one smooth mesh - which is
 * what gives these a real hood, haunches, a tapering nose and a fastback
 * instead of stacked boxes. The cabin is a second loft in tinted glass (the
 * driver stays visible inside), topped by a roof panel. Wheels are lathe-turned
 * tyres with per-car rim designs.
 *
 * Car-local axes (three): +X forward, +Y up, +Z right; metres. GROUND is where
 * the tyres touch.
 */

export const GROUND = -CAR.rideHeight * S;

/** Body / colour regions a vertex can belong to. */
type Region = 'paint' | 'accent' | 'accent2' | 'trim' | 'dark' | 'glass' | 'chrome' | 'red' | 'stripe';

interface Station {
  x: number;
  /** Bottom and top of the section, above the ground. */
  yb: number;
  yt: number;
  /** Half width at mid height, at the top, at the bottom. */
  w: number;
  wt: number;
  wb: number;
  /** Squareness (2 = ellipse, higher = boxier). */
  n?: number;
  /** Sideways centre (stripes). */
  zc?: number;
}

/** A painted stripe laid on the body (and roof) top, as thin geometry. */
interface Stripe {
  z: number;
  w: number;
  from: number;
  to: number;
  color: Region;
  roof?: boolean;
}

interface WheelSpec {
  r: number;
  width: number;
  front: number;
  rear: number;
  track: number;
  style: 'five' | 'six' | 'multi' | 'snow' | 'mesh';
  rim: number;
  accent: number;
}

export interface CarModel {
  id: number;
  name: string;
  tagline: string;
  /** The car's own colours (the reference look) - the same on both teams. */
  showroom: { paint: number; accent: number; accent2: number; trim: number; stripe: number };
  body: Station[];
  cabin: Station[];
  /** Roof panel covers the cabin between these x. */
  roof: [number, number];
  /** Region of a body vertex (x, height above ground, |z|, top-ness 0..1). */
  region(x: number, h: number, z: number, top: number): Region;
  wheels: WheelSpec;
  /** Extra parts: wings, mirrors, scoops... added to the body geometry. */
  parts(p: Parts): void;
  lights(p: Parts): void;
  /** Driver: hip position (x, height) and scale. */
  seat: { x: number; h: number; scale: number };
  nozzles: [number, number, number][];
  decal?: 'grid' | 'ice';
  /** Headlight colour. */
  lamp: number;
  stripes?: Stripe[];
}

/** Adds coloured, UV'd parts to a list. */
export class Parts {
  readonly list: BufferGeometry[] = [];
  constructor(private readonly color: (r: Region) => Color) {}

  box(r: Region, w: number, h: number, d: number, x: number, y: number, z: number, rot?: { x?: number; y?: number; z?: number }, mirror = false): void {
    for (const s of mirror ? [-1, 1] : [1]) {
      const g = new BoxGeometry(w, h, d);
      if (rot?.z) g.rotateZ(rot.z);
      if (rot?.y) g.rotateY(rot.y * s);
      if (rot?.x) g.rotateX(rot.x * s);
      g.translate(x, GROUND + y, z * s);
      this.push(g, r);
    }
  }

  cyl(r: Region, rt: number, rb: number, h: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', seg = 12, mirror = false): void {
    for (const s of mirror ? [-1, 1] : [1]) {
      const g = new CylinderGeometry(rt, rb, h, seg);
      if (axis === 'x') g.rotateZ(-Math.PI / 2);
      if (axis === 'z') g.rotateX(Math.PI / 2);
      g.translate(x, GROUND + y, z * s);
      this.push(g, r);
    }
  }

  /** A square-section beam between two points (heights above ground), mirrored to both sides. */
  beam(r: Region, a: [number, number, number], b: [number, number, number], t: number): void {
    for (const s of [-1, 1]) {
      const ax = a[0], ay = GROUND + a[1], az = a[2] * s;
      const bx = b[0], by = GROUND + b[1], bz = b[2] * s;
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const g = new BoxGeometry(t, len, t);
      const dir = new Vector3(bx - ax, by - ay, bz - az).normalize();
      g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir));
      g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      this.push(g, r);
    }
  }

  /** A wheel-arch flare: half a flattened torus over the wheel. */
  arch(r: Region, cx: number, cy: number, z: number, radius: number, thick: number, width: number): void {
    for (const s of [-1, 1]) {
      const g = new TorusGeometry(radius + 0.004, thick * 0.6, 5, 16, Math.PI);
      g.scale(1, 1, (width * 0.75) / (thick * 0.6));
      g.translate(cx, GROUND + cy, (z - 0.022) * s);
      this.push(g, r);
    }
  }

  push(g: BufferGeometry, r: Region): void {
    const geo = g.index ? g.toNonIndexed() : g;
    const c = this.color(r);
    const n = geo.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    this.list.push(geo);
  }
}

// ------------------------------------------------------------------ the loft

const RING = 28;

/** One cross-section ring: [y, z] pairs (absolute y), counter-clockwise from the bottom centre. */
const ring = (st: Station): [number, number][] => {
  const out: [number, number][] = [];
  const n = st.n ?? 4;
  const ex = 2 / n;
  const ym = GROUND + (st.yb + st.yt) / 2;
  const hh = (st.yt - st.yb) / 2;
  for (let i = 0; i < RING; i += 1) {
    const t = -Math.PI / 2 + (i / RING) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const cx = Math.sign(c) * Math.abs(c) ** ex;
    const cy = Math.sign(s) * Math.abs(s) ** ex;
    const width = cy < 0 ? st.w + (st.wb - st.w) * -cy : st.w + (st.wt - st.w) * cy;
    out.push([ym + cy * hh, (st.zc ?? 0) + cx * width]);
  }
  return out;
};

/** Interpolate extra stations so a loft has smooth curvature between key sections. */
const refine = (sts: Station[], per = 2): Station[] => {
  const out: Station[] = [];
  for (let i = 0; i < sts.length - 1; i += 1) {
    const a = sts[i]!;
    const b = sts[i + 1]!;
    for (let k = 0; k < per; k += 1) {
      const t = k / per;
      // smooth (Catmull-like) easing on the profile using neighbours
      const p = sts[i - 1] ?? a;
      const q = sts[i + 2] ?? b;
      const cr = (pv: number, av: number, bv: number, qv: number): number => {
        const t2 = t * t;
        const t3 = t2 * t;
        return 0.5 * (2 * av + (-pv + bv) * t + (2 * pv - 5 * av + 4 * bv - qv) * t2 + (-pv + 3 * av - 3 * bv + qv) * t3);
      };
      out.push({
        x: a.x + (b.x - a.x) * t,
        yb: cr(p.yb, a.yb, b.yb, q.yb),
        yt: cr(p.yt, a.yt, b.yt, q.yt),
        w: cr(p.w, a.w, b.w, q.w),
        wt: cr(p.wt, a.wt, b.wt, q.wt),
        wb: cr(p.wb, a.wb, b.wb, q.wb),
        n: a.n,
        zc: a.zc,
      });
    }
  }
  out.push(sts[sts.length - 1]!);
  return out;
};

/**
 * Pushes a body vertex in to open a wheel well: returns the new |z| (or null
 * to leave it). Arguments: x, height above ground, |z|, and how much the ring
 * point faces up (sin of its ring angle, -1 bottom .. 1 top).
 */
type Carve = (x: number, h: number, z: number, up: number) => number | null;

/** Wheel-well liner: near-black, so the recess reads as depth. */
const WELL = new Color(0x0b0c10);

/** Skin stations (front to back) into a closed mesh, colouring each vertex. */
const loft = (stations: Station[], color: (x: number, y: number, z: number, top: number) => Color, uvScale = 1, carve?: Carve): BufferGeometry => {
  const sts = refine(stations, 3);
  const rings = sts.map((s) => ring(s));
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const add = (x: number, y: number, z: number, i: number): number => {
    const up = Math.sin(-Math.PI / 2 + (i / RING) * Math.PI * 2);
    const zz = carve ? carve(x, y - GROUND, Math.abs(z), up) : null;
    pos.push(x, y, zz === null ? z : Math.sign(z) * zz);
    const top = Math.max(0, up);
    const c = zz === null ? color(x, y - GROUND, z, top) : WELL;
    col.push(c.r, c.g, c.b);
    uv.push(x * 2.2 * uvScale, (i / RING) * 4.6 * uvScale);
    return pos.length / 3 - 1;
  };
  const base: number[] = [];
  rings.forEach((r, k) => {
    base.push(pos.length / 3);
    r.forEach(([y, z], i) => add(sts[k]!.x, y, z, i));
  });
  for (let k = 0; k + 1 < rings.length; k += 1) {
    const A = base[k]!;
    const B = base[k + 1]!;
    for (let i = 0; i < RING; i += 1) {
      const i1 = (i + 1) % RING;
      idx.push(A + i, A + i1, B + i, A + i1, B + i1, B + i);
    }
  }
  // caps
  const cap = (k: number, front: boolean): void => {
    const r = rings[k]!;
    const x = sts[k]!.x;
    let cy = 0;
    for (const [y] of r) cy += y;
    const c = add(x, cy / r.length, 0, 0);
    for (let i = 0; i < RING; i += 1) {
      const i1 = (i + 1) % RING;
      if (front) idx.push(c, base[k]! + i1, base[k]! + i);
      else idx.push(c, base[k]! + i, base[k]! + i1);
    }
  };
  cap(0, true);
  cap(rings.length - 1, false);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
};

// ------------------------------------------------------------------ wheels

/** A wheel (spins about +Z), lathe tyre + designed rim, vertex coloured. */
const wheelGeometry = (w: WheelSpec): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  const paint = (g: BufferGeometry, hex: number): void => {
    const geo = g.index ? g.toNonIndexed() : g;
    const c = new Color(hex);
    const n = geo.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) a.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new Float32BufferAttribute(a, 3));
    if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
    parts.push(geo);
  };
  const r = w.r;
  const hw = w.width / 2;
  // tyre: rounded shoulders and sidewall
  const prof = [
    new Vector2(r * 0.76, -hw),
    new Vector2(r * 0.9, -hw * 1.02),
    new Vector2(r * 0.97, -hw * 0.8),
    new Vector2(r, -hw * 0.45),
    new Vector2(r, hw * 0.45),
    new Vector2(r * 0.97, hw * 0.8),
    new Vector2(r * 0.9, hw * 1.02),
    new Vector2(r * 0.76, hw),
  ];
  const tyre = new LatheGeometry(prof, 20);
  tyre.rotateX(Math.PI / 2);
  paint(tyre, 0x16181d);
  // barrel and face
  const barrel = new CylinderGeometry(r * 0.76, r * 0.76, w.width * 0.9, 22, 1, true);
  barrel.rotateX(Math.PI / 2);
  paint(barrel, 0x2a2d35);
  const face = new CylinderGeometry(r * 0.74, r * 0.74, 0.006, 22);
  face.rotateX(Math.PI / 2);
  face.translate(0, 0, hw * 0.55);
  paint(face, 0x1b1d22);
  const lip = new TorusGeometry(r * 0.73, 0.008, 4, 26);
  lip.translate(0, 0, hw * 0.78);
  paint(lip, w.style === 'multi' ? w.accent : w.rim);
  // spokes
  const spoke = (angle: number, width: number, len: number, inner: number, hex: number, depth = 0.016): void => {
    const g = new BoxGeometry(width, len, depth);
    g.translate(0, inner + len / 2, hw * 0.66);
    g.rotateZ(angle);
    paint(g, hex);
  };
  const R0 = r * 0.16;
  const L = r * 0.56;
  if (w.style === 'five') for (let i = 0; i < 5; i += 1) spoke((i / 5) * Math.PI * 2, r * 0.17, L, R0, w.rim);
  if (w.style === 'six') for (let i = 0; i < 6; i += 1) spoke((i / 6) * Math.PI * 2, r * 0.13, L, R0, w.rim);
  if (w.style === 'multi') for (let i = 0; i < 10; i += 1) spoke((i / 10) * Math.PI * 2, r * 0.06, L, R0, w.rim);
  if (w.style === 'mesh') {
    for (let i = 0; i < 10; i += 1) spoke((i / 10) * Math.PI * 2 + 0.25, r * 0.05, L, R0, w.rim);
    for (let i = 0; i < 10; i += 1) spoke((i / 10) * Math.PI * 2 - 0.25, r * 0.05, L, R0, w.rim);
  }
  if (w.style === 'snow') {
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      spoke(a, r * 0.07, L, R0, w.rim);
      for (const side of [-1, 1]) {
        const g = new BoxGeometry(r * 0.05, L * 0.34, 0.014);
        g.translate(0, L * 0.17, 0);
        g.rotateZ(side * 0.75);
        g.translate(0, R0 + L * 0.55, hw * 0.66);
        g.rotateZ(a);
        paint(g, w.rim);
      }
    }
  }
  const hub = new CylinderGeometry(r * 0.16, r * 0.18, 0.03, 12);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, hw * 0.66);
  paint(hub, w.style === 'snow' ? 0xbfe6ff : 0x8a8f9a);
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
};

// ------------------------------------------------------------------ the five

const BLACK = 0x15171c;
const BODY_DARK = 0x23262e;

export const CAR_MODELS: CarModel[] = [
  // 0 - VIPER GT: the green supercar. Long low nose, black skirts and flares, fastback, high wing.
  {
    id: 0,
    name: 'VIPER GT',
    tagline: 'Low, long and mean. Supercar fastback with a high wing.',
    showroom: { paint: 0x2ad13f, accent: BLACK, accent2: 0x1a9d2c, trim: 0x2b2f38, stripe: 0x2ad13f },
    body: [
      { x: 0.83, yb: 0.09, yt: 0.155, w: 0.36, wt: 0.33, wb: 0.34, n: 9 },
      { x: 0.76, yb: 0.07, yt: 0.22, w: 0.43, wt: 0.38, wb: 0.41, n: 8 },
      { x: 0.68, yb: 0.065, yt: 0.27, w: 0.45, wt: 0.39, wb: 0.42, n: 6 },
      { x: 0.55, yb: 0.065, yt: 0.31, w: 0.46, wt: 0.39, wb: 0.42, n: 4 },
      { x: 0.35, yb: 0.065, yt: 0.33, w: 0.45, wt: 0.38, wb: 0.42, n: 4 },
      { x: 0.15, yb: 0.065, yt: 0.35, w: 0.43, wt: 0.38, wb: 0.41, n: 4 },
      { x: -0.1, yb: 0.065, yt: 0.36, w: 0.44, wt: 0.39, wb: 0.41, n: 4 },
      { x: -0.32, yb: 0.07, yt: 0.37, w: 0.47, wt: 0.41, wb: 0.42, n: 4 },
      { x: -0.5, yb: 0.08, yt: 0.36, w: 0.46, wt: 0.39, wb: 0.41, n: 4 },
      { x: -0.62, yb: 0.12, yt: 0.34, w: 0.42, wt: 0.35, wb: 0.38, n: 4 },
    ],
    cabin: [
      { x: 0.24, yb: 0.32, yt: 0.335, w: 0.37, wt: 0.36, wb: 0.37, n: 3 },
      { x: 0.1, yb: 0.33, yt: 0.47, w: 0.37, wt: 0.27, wb: 0.37, n: 3 },
      { x: -0.08, yb: 0.34, yt: 0.535, w: 0.36, wt: 0.26, wb: 0.37, n: 3 },
      { x: -0.26, yb: 0.35, yt: 0.52, w: 0.36, wt: 0.26, wb: 0.37, n: 3 },
      { x: -0.44, yb: 0.35, yt: 0.43, w: 0.37, wt: 0.3, wb: 0.38, n: 3 },
      { x: -0.56, yb: 0.35, yt: 0.365, w: 0.37, wt: 0.35, wb: 0.37, n: 3 },
    ],
    roof: [-0.02, -0.34],
    region: (x, h, z, top) => {
      if (h < 0.115) return 'accent';
      if (x > 0.7 && h < 0.17) return 'accent';
      // side intake behind the front wheel
      if (top < 0.25 && x > 0.15 && x < 0.32 && h > 0.15 && h < 0.26) return 'accent';
      if (x < -0.56 && h < 0.24) return 'accent';
      return 'paint';
    },
    wheels: { r: 0.165, width: 0.13, front: 0.5, rear: -0.4, track: 0.405, style: 'five', rim: 0x3a3f4a, accent: 0xd02020 },
    parts: (p) => {
      p.arch('accent', 0.5, 0.165, 0.405, 0.185, 0.03, 0.08);
      p.arch('accent', -0.4, 0.165, 0.41, 0.19, 0.032, 0.09);
      // splitter, diffuser, mirrors, high wing
      p.box('accent', 0.14, 0.025, 0.66, 0.74, 0.07, 0);
      p.box('accent', 0.1, 0.06, 0.62, -0.62, 0.12, 0);
      p.box('paint', 0.07, 0.035, 0.05, 0.14, 0.39, 0.42, undefined, true); // mirrors, in body colour
      for (const z of [-0.2, 0.2]) p.box('accent', 0.05, 0.12, 0.025, -0.52, 0.42, z);
      p.box('accent', 0.17, 0.025, 0.86, -0.56, 0.49, 0, { z: 0.07 });
      p.box('paint', 0.18, 0.08, 0.02, -0.56, 0.48, 0.43, undefined, true);
      // brake calipers (red, don't spin)
      p.box('red', 0.06, 0.07, 0.025, 0.5, 0.2, 0.33, undefined, true);
      p.box('red', 0.06, 0.07, 0.025, -0.4, 0.2, 0.34, undefined, true);
    },
    lights: (p) => {
      // swept LED strips along the nose corners, and the lower DRL
      p.box('glass', 0.16, 0.014, 0.022, 0.72, 0.232, 0.31, { y: 0.42, z: -0.32 }, true);
      p.box('glass', 0.012, 0.012, 0.12, 0.825, 0.135, 0.22, { y: 0.35 }, true);
      p.box('red', 0.012, 0.02, 0.72, -0.627, 0.3, 0);
    },
    seat: { x: -0.17, h: 0.123, scale: 0.17 },
    lamp: 0xf2fbff,
    nozzles: [[-0.64, 0.17, 0.12], [-0.64, 0.17, -0.12]],
  },
  // 1 - BREAKER: the chunky all-rounder. Tall cabin, short nose, big exposed wheels, high wing, grid decal.
  {
    id: 1,
    name: 'BREAKER',
    tagline: 'The all-rounder. Tall, tough, and big on wheels.',
    showroom: { paint: 0xff5a10, accent: BLACK, accent2: 0xffffff, trim: 0xffffff, stripe: 0xff5a10 },
    body: [
      { x: 0.76, yb: 0.15, yt: 0.27, w: 0.3, wt: 0.25, wb: 0.29, n: 5 },
      { x: 0.66, yb: 0.12, yt: 0.33, w: 0.38, wt: 0.33, wb: 0.35, n: 5 },
      { x: 0.48, yb: 0.12, yt: 0.35, w: 0.39, wt: 0.35, wb: 0.36, n: 5 },
      { x: 0.24, yb: 0.12, yt: 0.37, w: 0.39, wt: 0.35, wb: 0.36, n: 5 },
      { x: 0.0, yb: 0.12, yt: 0.38, w: 0.39, wt: 0.35, wb: 0.36, n: 5 },
      { x: -0.28, yb: 0.13, yt: 0.4, w: 0.4, wt: 0.36, wb: 0.37, n: 5 },
      { x: -0.48, yb: 0.14, yt: 0.4, w: 0.39, wt: 0.35, wb: 0.36, n: 5 },
      { x: -0.58, yb: 0.17, yt: 0.37, w: 0.35, wt: 0.31, wb: 0.32, n: 5 },
    ],
    cabin: [
      { x: 0.2, yb: 0.36, yt: 0.38, w: 0.35, wt: 0.34, wb: 0.35, n: 6 },
      { x: 0.08, yb: 0.37, yt: 0.57, w: 0.34, wt: 0.27, wb: 0.35, n: 6 },
      { x: -0.14, yb: 0.38, yt: 0.62, w: 0.33, wt: 0.27, wb: 0.35, n: 6 },
      { x: -0.36, yb: 0.39, yt: 0.6, w: 0.33, wt: 0.27, wb: 0.35, n: 6 },
      { x: -0.46, yb: 0.39, yt: 0.42, w: 0.34, wt: 0.32, wb: 0.35, n: 6 },
    ],
    roof: [0.02, -0.4],
    region: (x, h, _z, top) => {
      if (h < 0.17) return 'accent';
      // the white trim line along the shoulder and around the nose
      if (top > 0.62 && top < 0.86) return 'trim';
      if (x > 0.7 && h < 0.24) return 'accent';
      return 'paint';
    },
    wheels: { r: 0.195, width: 0.15, front: 0.5, rear: -0.4, track: 0.455, style: 'six', rim: 0xd3d8e2, accent: 0xd3d8e2 },
    parts: (p) => {
      p.arch('paint', 0.5, 0.2, 0.43, 0.21, 0.03, 0.1);
      p.arch('paint', -0.4, 0.2, 0.43, 0.215, 0.03, 0.1);
      p.box('accent', 0.1, 0.07, 0.6, 0.76, 0.13, 0);
      // grille
      p.box('accent', 0.02, 0.07, 0.34, 0.765, 0.21, 0);
      // high rear wing on struts
      for (const z of [-0.18, 0.18]) p.box('accent', 0.04, 0.2, 0.03, -0.47, 0.5, z, { z: 0.25 });
      p.box('paint', 0.18, 0.03, 0.82, -0.52, 0.61, 0, { z: 0.08 });
      p.box('trim', 0.19, 0.012, 0.83, -0.52, 0.628, 0, { z: 0.08 });
      p.box('accent', 0.2, 0.1, 0.02, -0.52, 0.6, 0.42, undefined, true);
      // roof scoop
      p.box('accent', 0.12, 0.04, 0.14, -0.05, 0.63, 0);
      p.box('paint', 0.06, 0.035, 0.05, 0.12, 0.42, 0.37, undefined, true); // mirrors
    },
    lights: (p) => {
      for (const z of [0.2, 0.29]) p.cyl('glass', 0.035, 0.035, 0.03, 0.77, 0.27, z, 'x', 14, true);
      p.box('red', 0.012, 0.05, 0.12, -0.585, 0.33, 0.25, undefined, true);
    },
    seat: { x: -0.17, h: 0.208, scale: 0.17 },
    lamp: 0x7fd6ff,
    nozzles: [[-0.6, 0.22, 0.13], [-0.6, 0.22, -0.13]],
    decal: 'grid',
  },
  // 2 - TEMPEST: the teal/yellow modern muscle. Wide, sculpted, LED strip lights, big black grille.
  {
    id: 2,
    name: 'TEMPEST',
    tagline: 'Wide-body modern muscle. Sharp LEDs, big grille.',
    showroom: { paint: 0x19c3c8, accent: BLACK, accent2: 0xffd319, trim: 0x2a2d35, stripe: 0xffd319 },
    body: [
      { x: 0.8, yb: 0.11, yt: 0.25, w: 0.37, wt: 0.31, wb: 0.34, n: 6 },
      { x: 0.72, yb: 0.075, yt: 0.31, w: 0.45, wt: 0.39, wb: 0.41, n: 6 },
      { x: 0.52, yb: 0.065, yt: 0.34, w: 0.47, wt: 0.4, wb: 0.42, n: 5 },
      { x: 0.28, yb: 0.065, yt: 0.35, w: 0.46, wt: 0.4, wb: 0.42, n: 5 },
      { x: 0.04, yb: 0.065, yt: 0.36, w: 0.46, wt: 0.4, wb: 0.42, n: 5 },
      { x: -0.24, yb: 0.065, yt: 0.38, w: 0.48, wt: 0.41, wb: 0.43, n: 5 },
      { x: -0.46, yb: 0.075, yt: 0.38, w: 0.47, wt: 0.4, wb: 0.42, n: 5 },
      { x: -0.6, yb: 0.11, yt: 0.36, w: 0.43, wt: 0.37, wb: 0.39, n: 6 },
    ],
    cabin: [
      { x: 0.22, yb: 0.34, yt: 0.355, w: 0.39, wt: 0.38, wb: 0.39, n: 4 },
      { x: 0.08, yb: 0.35, yt: 0.49, w: 0.38, wt: 0.3, wb: 0.39, n: 4 },
      { x: -0.14, yb: 0.36, yt: 0.54, w: 0.37, wt: 0.3, wb: 0.39, n: 4 },
      { x: -0.36, yb: 0.37, yt: 0.52, w: 0.38, wt: 0.31, wb: 0.39, n: 4 },
      { x: -0.52, yb: 0.37, yt: 0.395, w: 0.39, wt: 0.37, wb: 0.39, n: 4 },
    ],
    roof: [0.0, -0.4],
    region: (x, h, z, top) => {
      if (h < 0.115) return 'accent';
      // the front: black grille block under the lights
      if (x > 0.7 && h < 0.255) return 'accent';
      // yellow hood panel and the yellow side sculpt
      if (top > 0.85 && x > 0.18 && z < 0.22) return 'stripe';
      if (top < 0.35 && x < 0.05 && x > -0.45 && h > 0.17 && h < 0.27) return 'stripe';
      if (x < -0.56 && h < 0.22) return 'accent';
      return 'paint';
    },
    wheels: { r: 0.175, width: 0.135, front: 0.53, rear: -0.42, track: 0.425, style: 'multi', rim: 0x1c1e24, accent: 0xffd319 },
    parts: (p) => {
      p.arch('accent', 0.53, 0.175, 0.43, 0.195, 0.03, 0.09);
      p.arch('accent', -0.42, 0.175, 0.435, 0.2, 0.032, 0.1);
      p.box('accent', 0.12, 0.03, 0.74, 0.76, 0.075, 0);
      // grille slats
      for (const y of [0.15, 0.19, 0.23]) p.box('trim', 0.015, 0.012, 0.5, 0.805, y, 0);
      // hood vents
      p.box('accent', 0.1, 0.012, 0.05, 0.45, 0.345, 0.12, undefined, true);
      p.box('paint', 0.07, 0.035, 0.05, 0.15, 0.4, 0.44, undefined, true); // mirrors
      // ducktail
      p.box('paint', 0.12, 0.03, 0.78, -0.55, 0.39, 0, { z: 0.18 });
      p.box('accent', 0.08, 0.05, 0.62, -0.6, 0.13, 0);
    },
    lights: (p) => {
      // thin LED strips across the top of the grille + inner DRL
      p.box('glass', 0.012, 0.016, 0.22, 0.795, 0.262, 0.23, { y: 0.35 }, true);
      p.box('glass', 0.012, 0.05, 0.012, 0.8, 0.2, 0.36, undefined, true);
      p.box('red', 0.012, 0.018, 0.8, -0.605, 0.32, 0);
    },
    seat: { x: -0.2, h: 0.128, scale: 0.17 },
    lamp: 0xffffff,
    stripes: [{ z: 0, w: 0.15, from: 0.8, to: 0.2, color: 'stripe' }],
    nozzles: [[-0.62, 0.16, 0.14], [-0.62, 0.16, -0.14]],
  },
  // 3 - HOTSHOT: the hot hatch. Boxy cabin, long roof, white lower kit, roof spoiler + wing.
  {
    id: 3,
    name: 'HOTSHOT',
    tagline: 'Hot hatch with a race kit. Boxy, nimble, loud.',
    showroom: { paint: 0xd81e3c, accent: 0xf3f4f6, accent2: BLACK, trim: 0xf3f4f6, stripe: 0x15171c },
    body: [
      { x: 0.76, yb: 0.11, yt: 0.27, w: 0.39, wt: 0.34, wb: 0.37, n: 6 },
      { x: 0.68, yb: 0.085, yt: 0.33, w: 0.43, wt: 0.38, wb: 0.4, n: 6 },
      { x: 0.5, yb: 0.085, yt: 0.36, w: 0.44, wt: 0.39, wb: 0.41, n: 6 },
      { x: 0.3, yb: 0.085, yt: 0.385, w: 0.44, wt: 0.4, wb: 0.41, n: 6 },
      { x: 0.05, yb: 0.085, yt: 0.39, w: 0.44, wt: 0.4, wb: 0.41, n: 6 },
      { x: -0.25, yb: 0.085, yt: 0.4, w: 0.45, wt: 0.41, wb: 0.42, n: 6 },
      { x: -0.46, yb: 0.09, yt: 0.4, w: 0.44, wt: 0.4, wb: 0.41, n: 6 },
      { x: -0.55, yb: 0.11, yt: 0.39, w: 0.41, wt: 0.37, wb: 0.39, n: 7 },
    ],
    cabin: [
      { x: 0.3, yb: 0.37, yt: 0.39, w: 0.4, wt: 0.39, wb: 0.4, n: 6 },
      { x: 0.16, yb: 0.38, yt: 0.56, w: 0.39, wt: 0.33, wb: 0.4, n: 6 },
      { x: -0.04, yb: 0.39, yt: 0.63, w: 0.38, wt: 0.33, wb: 0.4, n: 6 },
      { x: -0.36, yb: 0.39, yt: 0.63, w: 0.38, wt: 0.33, wb: 0.4, n: 6 },
      { x: -0.5, yb: 0.39, yt: 0.6, w: 0.38, wt: 0.34, wb: 0.39, n: 6 },
      { x: -0.545, yb: 0.385, yt: 0.4, w: 0.39, wt: 0.37, wb: 0.39, n: 6 },
    ],
    roof: [0.06, -0.52],
    region: (x, h, _z, top) => {
      // white race kit: splitter lip, skirts, and a pinstripe
      if (h < 0.12) return 'accent';
      if (top < 0.3 && h > 0.16 && h < 0.18) return 'accent';
      if (x > 0.72 && h < 0.17) return 'accent';
      return 'paint';
    },
    wheels: { r: 0.17, width: 0.125, front: 0.5, rear: -0.38, track: 0.41, style: 'five', rim: 0xd9dde5, accent: 0xd9dde5 },
    parts: (p) => {
      p.arch('paint', 0.5, 0.17, 0.42, 0.19, 0.028, 0.06);
      p.arch('paint', -0.38, 0.17, 0.42, 0.19, 0.028, 0.06);
      p.box('accent', 0.16, 0.022, 0.8, 0.72, 0.085, 0);
      p.box('accent', 0.09, 0.05, 0.7, -0.56, 0.12, 0);
      // black glass roof panel is the roof region; roof spoiler and a big wing
      p.box('accent2', 0.12, 0.025, 0.7, -0.55, 0.62, 0, { z: -0.12 });
      for (const z of [-0.2, 0.2]) p.box('accent2', 0.04, 0.1, 0.025, -0.58, 0.46, z);
      p.box('paint', 0.15, 0.022, 0.84, -0.6, 0.52, 0, { z: 0.06 });
      p.box('accent', 0.16, 0.06, 0.018, -0.6, 0.51, 0.43, undefined, true);
      // grille band and mirrors
      p.box('accent2', 0.02, 0.06, 0.66, 0.765, 0.23, 0);
      p.box('accent', 0.02, 0.008, 0.66, 0.77, 0.205, 0);
      p.box('paint', 0.07, 0.04, 0.05, 0.22, 0.43, 0.42, undefined, true);
    },
    lights: (p) => {
      p.box('glass', 0.014, 0.024, 0.16, 0.77, 0.27, 0.26, { y: 0.3 }, true);
      p.box('red', 0.014, 0.05, 0.12, -0.555, 0.34, 0.31, undefined, true);
    },
    seat: { x: -0.16, h: 0.218, scale: 0.17 },
    lamp: 0xbfe8ff,
    nozzles: [[-0.58, 0.16, 0.15], [-0.58, 0.16, -0.15]],
  },
  // 4 - FROSTBITE: the muscle car with a blower. Long hood, fastback, racing stripes, ice camo, snowflake rims.
  {
    id: 4,
    name: 'FROSTBITE',
    tagline: 'Old-school muscle with a supercharger and ice in its veins.',
    showroom: { paint: 0x2bb8e0, accent: BLACK, accent2: 0xffffff, trim: 0xe0263a, stripe: 0x14306a },
    body: [
      { x: 0.8, yb: 0.12, yt: 0.27, w: 0.38, wt: 0.34, wb: 0.36, n: 7 },
      { x: 0.72, yb: 0.095, yt: 0.32, w: 0.44, wt: 0.4, wb: 0.41, n: 6 },
      { x: 0.5, yb: 0.085, yt: 0.345, w: 0.45, wt: 0.41, wb: 0.42, n: 6 },
      { x: 0.26, yb: 0.085, yt: 0.355, w: 0.45, wt: 0.41, wb: 0.42, n: 6 },
      { x: 0.02, yb: 0.085, yt: 0.36, w: 0.45, wt: 0.41, wb: 0.42, n: 6 },
      { x: -0.26, yb: 0.085, yt: 0.37, w: 0.46, wt: 0.42, wb: 0.43, n: 6 },
      { x: -0.48, yb: 0.095, yt: 0.37, w: 0.45, wt: 0.41, wb: 0.42, n: 6 },
      { x: -0.6, yb: 0.125, yt: 0.35, w: 0.42, wt: 0.38, wb: 0.4, n: 6 },
    ],
    cabin: [
      { x: 0.04, yb: 0.35, yt: 0.37, w: 0.4, wt: 0.39, wb: 0.4, n: 4 },
      { x: -0.08, yb: 0.36, yt: 0.51, w: 0.39, wt: 0.31, wb: 0.4, n: 4 },
      { x: -0.26, yb: 0.36, yt: 0.54, w: 0.38, wt: 0.3, wb: 0.4, n: 4 },
      { x: -0.44, yb: 0.36, yt: 0.43, w: 0.39, wt: 0.35, wb: 0.4, n: 4 },
      { x: -0.56, yb: 0.36, yt: 0.375, w: 0.4, wt: 0.38, wb: 0.4, n: 4 },
    ],
    roof: [-0.1, -0.36],
    region: (x, h, z, top) => {
      if (h < 0.13) return 'accent';
      if (x > 0.74 && h < 0.2) return 'accent';
      // twin racing stripes over the whole car, white-edged; a red pinstripe low on the flank
      if (top > 0.8 && z > 0.035 && z < 0.12) return 'stripe';
      if (top > 0.8 && z >= 0.12 && z < 0.145) return 'accent2';
      if (top < 0.3 && h > 0.185 && h < 0.205) return 'trim';
      return 'paint';
    },
    wheels: { r: 0.175, width: 0.135, front: 0.53, rear: -0.4, track: 0.42, style: 'snow', rim: 0xf4f8ff, accent: 0xf4f8ff },
    parts: (p) => {
      p.arch('paint', 0.53, 0.175, 0.425, 0.195, 0.03, 0.07);
      p.arch('paint', -0.4, 0.175, 0.43, 0.2, 0.03, 0.08);
      // the blower: housing, intake, scoop
      p.box('accent', 0.2, 0.07, 0.17, 0.36, 0.38, 0);
      p.box('chrome', 0.16, 0.025, 0.15, 0.36, 0.425, 0);
      p.box('accent', 0.1, 0.07, 0.13, 0.4, 0.47, 0);
      p.box('chrome', 0.02, 0.06, 0.12, 0.452, 0.47, 0);
      // grille, bumper, chin
      p.box('chrome', 0.025, 0.02, 0.74, 0.8, 0.135, 0);
      p.box('accent', 0.02, 0.07, 0.56, 0.805, 0.2, 0);
      p.box('accent', 0.1, 0.05, 0.66, -0.6, 0.13, 0);
      p.box('paint', 0.1, 0.025, 0.78, -0.56, 0.375, 0, { z: 0.14 });
      p.box('paint', 0.06, 0.03, 0.05, 0.0, 0.4, 0.43, undefined, true); // mirrors
    },
    lights: (p) => {
      for (const z of [0.2, 0.3]) p.cyl('glass', 0.032, 0.032, 0.025, 0.805, 0.245, z, 'x', 14, true);
      p.box('red', 0.012, 0.035, 0.26, -0.605, 0.3, 0.19, undefined, true);
    },
    seat: { x: -0.25, h: 0.128, scale: 0.17 },
    lamp: 0xfff2cf,
    stripes: [
      { z: 0.08, w: 0.034, from: 0.8, to: -0.6, color: 'stripe', roof: true },
      { z: -0.08, w: 0.034, from: 0.8, to: -0.6, color: 'stripe', roof: true },
      { z: 0.122, w: 0.008, from: 0.8, to: -0.6, color: 'accent2', roof: true },
      { z: -0.122, w: 0.008, from: 0.8, to: -0.6, color: 'accent2', roof: true },
      { z: 0.038, w: 0.008, from: 0.8, to: -0.6, color: 'accent2', roof: true },
      { z: -0.038, w: 0.008, from: 0.8, to: -0.6, color: 'accent2', roof: true },
    ],
    nozzles: [[-0.62, 0.17, 0.14], [-0.62, 0.17, -0.14]],
    decal: 'ice',
  },
];

// ------------------------------------------------------------------ decals

let gridTex: Texture | null = null;
let iceTex: Texture | null = null;
const decalTexture = (kind: 'grid' | 'ice' | undefined): Texture | null => {
  if (!kind) return null;
  if (kind === 'grid' && gridTex) return gridTex;
  if (kind === 'ice' && iceTex) return iceTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  if (kind === 'grid') {
    // the tron-ish grid: dark lines, slightly skewed, with a brighter core
    g.strokeStyle = 'rgba(70,10,0,0.75)';
    g.lineWidth = 7;
    for (let i = -256; i < 512; i += 42) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 60, 256);
      g.stroke();
    }
    for (let j = 0; j < 256; j += 42) {
      g.beginPath();
      g.moveTo(0, j);
      g.lineTo(256, j + 10);
      g.stroke();
    }
  } else {
    // ice camo: pale shards over the paint
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i += 1) {
      g.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,1)' : i % 3 === 1 ? 'rgba(200,235,255,1)' : 'rgba(150,200,240,1)';
      g.beginPath();
      const x = rnd() * 256;
      const y = rnd() * 256;
      g.moveTo(x, y);
      for (let k = 0; k < 3; k += 1) g.lineTo(x + (rnd() - 0.5) * 120, y + (rnd() - 0.5) * 90);
      g.closePath();
      g.globalAlpha = 0.8;
      g.fill();
    }
    g.globalAlpha = 1;
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  if (kind === 'grid') gridTex = t;
  else iceTex = t;
  return t;
};

// ------------------------------------------------------------------ build

export interface BuiltCar {
  body: BufferGeometry;
  /** Painted stripes over the body and roof (null: none) - drawn with a polygon offset. */
  stripes: BufferGeometry | null;
  glass: BufferGeometry;
  lights: BufferGeometry;
  decal: Texture | null;
  wheel: BufferGeometry;
  /** Wheel centres (front-left, front-right, rear-left, rear-right) and radius. */
  wheelPos: [number, number, number][];
  wheelR: number;
}

const cache = new Map<number, BuiltCar>();
const wheelCache = new Map<number, BufferGeometry>();

/**
 * One car model's geometry, always in its own colours: team identity comes
 * from the name plates, the underglow and the HUD, never from repainting.
 */
export const buildCar = (id: number): BuiltCar => {
  const model = CAR_MODELS[id] ?? CAR_MODELS[0]!;
  const hit = cache.get(model.id);
  if (hit) return hit;
  const pal = model.showroom;
  const colors: Record<Region, Color> = {
    paint: new Color(pal.paint),
    accent: new Color(pal.accent),
    accent2: new Color(pal.accent2),
    trim: new Color(pal.trim),
    stripe: new Color(pal.stripe),
    dark: new Color(BODY_DARK),
    glass: new Color(0xeaf6ff),
    chrome: new Color(0xd8dde6),
    red: new Color(0xff2a2a),
  };
  const color = (r: Region): Color => colors[r];
  // crisper sections: boxier, near-vertical flanks, flat-ish tops (a defined shoulder line)
  const crisp = model.body.map((st) => ({ ...st, n: Math.max(st.n ?? 4, 7), wb: Math.max(st.wb, st.w - 0.025), wt: Math.max(st.wt, st.w - 0.07) }));
  // wheel wells: the solid loft is pushed in round each wheel so a tyre never shows through the
  // flank - deeper at the front, where the wheels steer (the visual steer angle is capped in CarView)
  const wh = model.wheels;
  const wells = [
    { x: wh.front, inner: wh.track - wh.width / 2 - 0.055 },
    { x: wh.rear, inner: wh.track - wh.width / 2 - 0.02 },
  ];
  const wellR = wh.r + 0.03;
  const carve: Carve = (x, h, z, up) => {
    if (up > 0.72) return null; // keep the shoulder: it becomes the fender lip over the wheel
    for (const w of wells) {
      const dx = x - w.x;
      const dy = h - wh.r;
      if (dx * dx + dy * dy < wellR * wellR && z > w.inner) return w.inner;
    }
    return null;
  };
  const body = loft(crisp, (x, h, z, top) => color(model.region(x, h, Math.abs(z), top)), 1, carve);
  // roof panel: a thin lid over the glass
  const roofSts = model.cabin
    .filter((s) => s.x <= model.roof[0] + 0.12 && s.x >= model.roof[1] - 0.12)
    .map((s) => ({ ...s, yb: s.yt - 0.03, yt: s.yt + 0.014, w: s.wt + 0.014, wb: s.wt + 0.012, wt: s.wt - 0.004, n: 4 }));
  const roofColor = model.id === 3 ? colors.accent2 : colors.paint;
  const parts = new Parts(color);
  parts.list.push(body);
  if (roofSts.length >= 2) parts.list.push(loft(roofSts, () => roofColor));
  model.parts(parts);
  // window pillars (A at the windscreen, B mid, C at the back) so the cabin reads as structure
  const cab = model.cabin;
  const first = cab[0]!;
  const last = cab[cab.length - 1]!;
  const front = cab.find((s) => s.x <= model.roof[0] + 0.001) ?? cab[1]!;
  const back = [...cab].reverse().find((s) => s.x >= model.roof[1] - 0.001) ?? cab[cab.length - 2]!;
  const pillar = model.id === 3 ? 'accent2' : 'dark';
  parts.beam(pillar, [first.x, first.yt, first.wb * 0.97], [front.x, front.yt - 0.01, front.wt * 0.98], 0.026);
  parts.beam(pillar, [back.x, back.yt - 0.01, back.wt * 0.98], [last.x, last.yt, last.wb * 0.97], 0.03);
  const mid = (front.x + back.x) / 2;
  const midSt = cab.reduce((p, c) => (Math.abs(c.x - mid) < Math.abs(p.x - mid) ? c : p), cab[1]!);
  parts.beam(pillar, [mid, midSt.yb + 0.02, midSt.wb * 0.99], [mid, midSt.yt - 0.015, midSt.wt * 1.0], 0.024);
  // Painted stripes are their OWN geometry (drawn with a polygon offset in CarView): laid a few
  // millimetres over a surface they only approximate between sections, merged into the body they
  // z-fought it in places (Frostbite's twin stripes shimmered on the roof and the rear deck).
  const stripeParts: BufferGeometry[] = [];
  for (const st of model.stripes ?? []) {
    const strip = (src: Station[], lift: number, x0: number, x1: number): void => {
      const pts = src.filter((p) => p.x <= x0 + 1e-6 && p.x >= x1 - 1e-6);
      if (pts.length < 2) return;
      stripeParts.push(
        loft(
          pts.map((p) => {
            const n = p.n ?? 4;
            const ym = (p.yb + p.yt) / 2;
            const hh = (p.yt - p.yb) / 2;
            const k = Math.min(0.999, Math.abs(st.z) / Math.max(0.01, p.wt));
            const top = ym + hh * Math.pow(1 - Math.pow(k, n), 1 / n);
            return { x: p.x, yb: top - 0.01 + lift, yt: top + 0.008 + lift, w: st.w, wt: st.w, wb: st.w, n: 8, zc: st.z };
          }),
          () => colors[st.color],
        ),
      );
    };
    strip(refine(crisp, 3), 0, st.from, st.to);
    if (st.roof && roofSts.length >= 2) {
      // on the roof PANEL's own sections (not the glass cabin under it): the stripe follows the lid
      strip(refine(roofSts, 3), 0.003, model.roof[0], model.roof[1]);
    }
  }
  const glassParts: BufferGeometry[] = [loft(model.cabin, () => colors.glass)];
  const lamp = new Color(model.lamp);
  const lights = new Parts((r) => (r === 'glass' ? lamp : color(r)));
  model.lights(lights);
  const wheelR = model.wheels.r;
  let wheel = wheelCache.get(model.id);
  if (!wheel) {
    wheel = wheelGeometry(model.wheels);
    wheelCache.set(model.id, wheel);
  }
  const w = model.wheels;
  const built: BuiltCar = {
    body: mergeGeometries(parts.list)!,
    stripes: stripeParts.length ? mergeGeometries(stripeParts)! : null,
    glass: mergeGeometries(glassParts.map((g) => (g.getAttribute('uv') ? g : g)))!,
    lights: mergeGeometries(lights.list)!,
    decal: decalTexture(model.decal),
    wheel,
    wheelPos: [
      [w.front, GROUND + w.r, -w.track],
      [w.front, GROUND + w.r, w.track],
      [w.rear, GROUND + w.r, -w.track],
      [w.rear, GROUND + w.r, w.track],
    ],
    wheelR,
  };
  cache.set(model.id, built);
  return built;
};

