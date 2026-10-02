import { BoxGeometry, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Quaternion, Shape, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { GROUND, creased, swatchUV } from './loft.js';

/**
 * Car parts kit: wings, flares, splitters, mirrors, vents, lamps... Each part is
 * painted with one palette swatch of its car (by name) - so it shares the body's
 * material (gloss paint, satin plastic, chrome, lit LED) and draw call.
 * Heights are above the ground; `z` is the distance out from the centre line,
 * and `mirror` puts a copy on the other side.
 */
export class Parts {
  readonly list: BufferGeometry[] = [];
  constructor(private readonly swatch: (name: string) => number) {}

  push(g: BufferGeometry, paint: string, crease = 40): void {
    let geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('normal');
    const n = geo.getAttribute('position').count;
    const [u, v] = swatchUV(this.swatch(paint));
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 1) {
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    geo = creased(geo, crease);
    this.list.push(geo);
  }

  private place(g: BufferGeometry, paint: string, x: number, y: number, z: number, mirror: boolean, rot?: Rot, crease?: number): void {
    for (const s of mirror ? [-1, 1] : [1]) {
      const c = g.clone();
      if (rot?.z) c.rotateZ(rot.z);
      if (rot?.y) c.rotateY(rot.y * s);
      if (rot?.x) c.rotateX(rot.x * s);
      c.translate(x, GROUND + y, z * s);
      this.push(c, paint, crease);
    }
  }

  box(paint: string, w: number, h: number, d: number, x: number, y: number, z: number, rot?: Rot, mirror = false): void {
    this.place(new BoxGeometry(w, h, d), paint, x, y, z, mirror, rot);
  }

  cyl(paint: string, rt: number, rb: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', seg = 14, mirror = false, rot?: Rot): void {
    const g = new CylinderGeometry(rt, rb, len, seg);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    this.place(g, paint, x, y, z, mirror, rot, 50);
  }

  ball(paint: string, r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, mirror = false): void {
    const g = new SphereGeometry(r, 12, 8);
    g.scale(sx, sy, sz);
    this.place(g, paint, x, y, z, mirror, undefined, 80);
  }

  /** A square-section beam between two points (heights above ground), mirrored. */
  beam(paint: string, a: [number, number, number], b: [number, number, number], t: number, t2 = t, mirror = true): void {
    for (const s of mirror ? [-1, 1] : [1]) {
      const ax = a[0], ay = GROUND + a[1], az = a[2] * s;
      const bx = b[0], by = GROUND + b[1], bz = b[2] * s;
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const g = new BoxGeometry(t, len, t2);
      const dir = new Vector3(bx - ax, by - ay, bz - az).normalize();
      g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir));
      g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      this.push(g, paint);
    }
  }

  /**
   * A side-profile shape [x, height][] extruded across the car: from `z0` to `z1` out
   * from the centre (mirrored), or centred and `z1` wide when `z0` is null. Bevelled.
   */
  side(paint: string, pts: [number, number][], z0: number | null, z1: number, bevel = 0.004, mirror = true): void {
    const shape = new Shape(pts.map(([x, h]) => ({ x, y: h }) as never));
    const depth = z0 === null ? z1 : z1 - z0;
    const g = new ExtrudeGeometry(shape, { depth: Math.max(0.001, depth - bevel * 2), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
    g.translate(0, GROUND, 0);
    if (z0 === null) {
      g.translate(0, 0, -depth / 2 + bevel);
      this.push(g, paint);
      return;
    }
    for (const s of mirror ? [-1, 1] : [1]) {
      const c = g.clone();
      c.translate(0, 0, z0 + bevel);
      if (s < 0) c.scale(1, 1, -1);
      this.push(s < 0 ? flip(c) : c, paint);
    }
  }

  /**
   * A plan-view shape [x, z][] (z out from the centre line, mirrored to a full outline
   * when `sym`) extruded upwards from height `y0` by `t`. Splitters, plates, scoops.
   */
  plan(paint: string, pts: [number, number][], y0: number, t: number, sym = true, bevel = 0.003): void {
    const outline = sym ? [...pts.map(([x, z]) => [x, z] as [number, number]), ...[...pts].reverse().map(([x, z]) => [x, -z] as [number, number])] : pts;
    const shape = new Shape(outline.map(([x, z]) => ({ x, y: -z }) as never));
    const g = new ExtrudeGeometry(shape, { depth: Math.max(0.001, t - bevel * 2), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
    // shape (x, y=-z) extruded along +z -> rotate so the extrusion goes up
    g.rotateX(-Math.PI / 2);
    g.translate(0, GROUND + y0 + bevel, 0);
    this.push(g, paint);
  }

  /** A wheel-arch flare: an arc band round the wheel (side view), from `z0` to `z1` out. */
  flare(paint: string, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, z0: number, z1: number, seg = 10): void {
    const pts: [number, number][] = [];
    for (let i = 0; i <= seg; i += 1) {
      const a = a0 + ((a1 - a0) * i) / seg;
      pts.push([cx + Math.cos(a) * r1, cy + Math.sin(a) * r1]);
    }
    for (let i = seg; i >= 0; i -= 1) {
      const a = a0 + ((a1 - a0) * i) / seg;
      pts.push([cx + Math.cos(a) * r0, cy + Math.sin(a) * r0]);
    }
    this.side(paint, pts, z0, z1, 0.004);
  }

  /** A torus arc (pipes, rings, lips). */
  torus(paint: string, r: number, tube: number, arc: number, x: number, y: number, z: number, rot?: Rot, mirror = false): void {
    this.place(new TorusGeometry(r, tube, 6, 18, arc), paint, x, y, z, mirror, rot, 60);
  }

  /**
   * An airfoil wing across the car: chord `c` at x (leading edge forward), thickness
   * `t`, span `span`, at height y, pitched `aoa` (nose down positive).
   */
  wing(paint: string, x: number, y: number, c: number, t: number, span: number, aoa = 0.1): void {
    const pts: [number, number][] = [];
    const N = 8;
    for (let i = 0; i <= N; i += 1) {
      const u = i / N;
      const th = t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1015 * u ** 4) * 5;
      pts.push([x - u * c, y + th * 0.9]);
    }
    for (let i = N; i >= 0; i -= 1) {
      const u = i / N;
      const th = t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1015 * u ** 4) * 5;
      pts.push([x - u * c, y - th * 0.35]);
    }
    const rotated = pts.map(([px, ph]) => {
      const dx = px - x;
      const dh = ph - y;
      return [x + dx * Math.cos(aoa) - dh * Math.sin(aoa), y + dx * Math.sin(aoa) + dh * Math.cos(aoa)] as [number, number];
    });
    this.side(paint, rotated, null, span, 0.002);
  }

  /** A door mirror: a stalk off the body and a rounded head. */
  mirror(paint: string, stalk: string, x: number, y: number, z: number, size = 1): void {
    this.beam(stalk, [x + 0.015, y - 0.035, z - 0.06], [x, y - 0.01, z - 0.012], 0.012 * size);
    const head = new SphereGeometry(0.035 * size, 10, 7);
    head.scale(0.75, 0.62, 1.05);
    this.place(head, paint, x, y, z, true, undefined, 70);
    const glass = new BoxGeometry(0.004, 0.034 * size, 0.06 * size);
    this.place(glass, 'chrome', x - 0.027 * size, y, z, true);
  }
}

type Rot = { x?: number; y?: number; z?: number };

/** Mirrored geometry has inside-out triangles: swap two corners of each. */
const flip = (g: BufferGeometry): BufferGeometry => {
  const geo = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name);
    const w = a.itemSize;
    const arr = a.array as Float32Array;
    for (let t = 0; t < a.count; t += 3) {
      for (let q = 0; q < w; q += 1) {
        const i1 = (t + 1) * w + q;
        const i2 = (t + 2) * w + q;
        const tmp = arr[i1]!;
        arr[i1] = arr[i2]!;
        arr[i2] = tmp;
      }
    }
  }
  return geo;
};
