import { CAR } from '@rlb/shared';
import { BufferGeometry, DataTexture, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType } from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { S } from '../units.js';

/**
 * THE CAR SURFACE KIT: filleted-section lofts and baked liveries.
 *
 * A body is a row of cross-sections along the car (front to back). Each section is a
 * half profile of CONTROL POINTS from the bottom centre round the right side to the
 * top centre - [height above ground, half width, fillet radius] - and every corner is
 * rounded by its own radius: a small one is a crisp crease (a shoulder line, a fender
 * peak), a big one a soft bulge. Between sections each control value follows a
 * monotone cubic along x, so the shape flows without overshoot. The mesh is shaded
 * with creased normals (smooth across soft corners, sharp across real edges).
 *
 * The paint is a texture BAKED from a function of the 3D surface point (position,
 * normal): stripes, camo, grilles, LED headlights, vents, seams are all painted where
 * they sit on the body, crisp at texel size. A second map holds per-texel clearcoat,
 * roughness, metalness and glow (ORM + emissive), so one material draws a whole car:
 * gloss paint, satin plastics, chrome and lit LEDs. Parts (wings, mirrors, splitters)
 * sample flat palette swatches in a corner of the same textures.
 *
 * Axes (three, car-local): +X forward, +Y up, +Z right; metres. GROUND is where the
 * tyres touch.
 */

export const GROUND = -CAR.rideHeight * S;

/**
 * Creased normals at car scale: three's helper welds positions to 1/100 of a unit (a
 * centimetre here, coarser than our fillets and lug nuts), so work in tenths of a mm.
 */
export const creased = (g: BufferGeometry, deg: number): BufferGeometry => {
  g.scale(1000, 1000, 1000);
  const r = toCreasedNormals(g, (deg * Math.PI) / 180);
  r.scale(0.001, 0.001, 0.001);
  return r;
};

/** A profile control point: [height above ground, half width (>= 0), fillet radius]. */
export type Ctrl = [number, number, number];
export interface Station {
  x: number;
  p: Ctrl[];
}

/** Samples per rounded corner (the polyline round each control point); far LODs use fewer. */
const F = 4;

// ------------------------------------------------------------------ sections

/**
 * A body section from a few landmarks (all heights above ground, half widths):
 * bottom (yb), rocker/skirt, the widest point, the shoulder crease, the edge where
 * the top turns over, and the top centre. Eight control points, always - so every
 * station of a body lofts point for point.
 */
export interface SecSpec {
  /** Underside height. */
  yb: number;
  /** Top centre height (hood, roof base, deck). */
  ht: number;
  /** Widest half width. */
  w: number;
  /** Height of the widest point. */
  hw?: number;
  /** Half width of the underside edge. */
  wb?: number;
  /** Rocker / skirt point (height, half width): a step low on the flank. */
  hk?: number;
  wk?: number;
  /** Shoulder crease height and half width. */
  hs?: number;
  ws?: number;
  /** Half width where the top surface turns over (its height is `ht` + `dt`). */
  wt?: number;
  dt?: number;
  /** Centre crown above `ht` (negative: a valley between raised fenders). */
  crown?: number;
  /** Fillet radii: bottom, rocker, widest, shoulder, top edge. */
  rb?: number;
  rk?: number;
  rw?: number;
  rs?: number;
  rt?: number;
}

export const sec = (x: number, s: SecSpec): Station => {
  const hw = s.hw ?? s.yb + (s.ht - s.yb) * 0.42;
  const wb = s.wb ?? s.w - 0.04;
  const hk = s.hk ?? (s.yb + hw) / 2;
  const wk = s.wk ?? (wb + s.w) / 2;
  const hs = s.hs ?? s.ht - 0.05;
  const ws = s.ws ?? s.w - 0.012;
  const wt = s.wt ?? ws - 0.06;
  const ht = s.ht + (s.dt ?? 0);
  return {
    x,
    p: [
      [s.yb, 0, 0],
      [s.yb, wb, s.rb ?? 0.02],
      [hk, wk, s.rk ?? 0.01],
      [hw, s.w, s.rw ?? 0.05],
      [hs, ws, s.rs ?? 0.025],
      [ht, wt, s.rt ?? 0.05],
      // level across the centre line (no ridge or valley crease down the middle of the hood)
      [s.ht + (s.crown ?? 0.012), wt * 0.38, wt * 0.3],
      [s.ht + (s.crown ?? 0.012), 0, 0],
    ],
  };
};

/** A cabin (glass) section: belt, the side glass leaning in, the roof edge, the roof centre. */
export const cab = (x: number, yb: number, yt: number, wb: number, wt: number, crown = 0.012, r = 0.035): Station => ({
  x,
  p: [
    [yb, 0, 0],
    [yb, wb, 0.004],
    [yb + (yt - yb) * 0.12, wb + 0.004, 0.01],
    [yb + (yt - yb) * 0.55, (wb + wt) / 2 + 0.008, 0.06],
    [yt - Math.min(0.03, (yt - yb) * 0.3), wt + 0.012, 0.02],
    [yt, wt - 0.02, r],
    [yt + crown, (wt - 0.02) * 0.38, wt * 0.3],
    [yt + crown, 0, 0],
  ],
});

// ------------------------------------------------------------------ interpolation

/** Monotone cubic (Fritsch-Carlson) through the stations, per control value. */
export class Profile {
  readonly xs: number[];
  private readonly v: number[][];
  private readonly m: number[][];
  readonly k: number;
  constructor(stations: Station[]) {
    const st = [...stations].sort((a, b) => a.x - b.x);
    this.k = st[0]!.p.length;
    this.xs = st.map((s) => s.x);
    this.v = st.map((s) => s.p.flat());
    const n = st.length;
    const nv = this.k * 3;
    this.m = st.map(() => new Array<number>(nv).fill(0));
    for (let j = 0; j < nv; j += 1) {
      const d: number[] = [];
      for (let i = 0; i + 1 < n; i += 1) d.push((this.v[i + 1]![j]! - this.v[i]![j]!) / (this.xs[i + 1]! - this.xs[i]!));
      for (let i = 0; i < n; i += 1) {
        if (i === 0) this.m[i]![j] = d[0] ?? 0;
        else if (i === n - 1) this.m[i]![j] = d[n - 2] ?? 0;
        else {
          const a = d[i - 1]!;
          const b = d[i]!;
          this.m[i]![j] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
        }
      }
    }
  }
  get x0(): number {
    return this.xs[0]!;
  }
  get x1(): number {
    return this.xs[this.xs.length - 1]!;
  }
  /** Control points at x (clamped to the ends). */
  at(x: number, out: Ctrl[] = []): Ctrl[] {
    const xs = this.xs;
    let i = 0;
    if (x <= xs[0]!) x = xs[0]!;
    if (x >= xs[xs.length - 1]!) {
      x = xs[xs.length - 1]!;
      i = xs.length - 2;
    } else while (i < xs.length - 2 && x > xs[i + 1]!) i += 1;
    const h = xs[i + 1]! - xs[i]!;
    const t = h > 0 ? (x - xs[i]!) / h : 0;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const a = this.v[i]!;
    const b = this.v[i + 1]!;
    const ma = this.m[i]!;
    const mb = this.m[i + 1]!;
    for (let p = 0; p < this.k; p += 1) {
      const c = (out[p] ??= [0, 0, 0]);
      for (let q = 0; q < 3; q += 1) {
        const j = p * 3 + q;
        c[q] = h00 * a[j]! + h10 * h * ma[j]! + h01 * b[j]! + h11 * h * mb[j]!;
      }
    }
    out.length = this.k;
    return out;
  }
}

/** A rounded polyline through control points: [h, z] pairs and their (weighted) arc parameter 0..1. */
export interface Poly {
  h: Float64Array;
  z: Float64Array;
  s: Float64Array;
  /** Index of the first sample of each control corner (corner c = control point c). */
  corner: number[];
}

export const polyCount = (k: number, fil = F): number => 2 + (k - 2) * fil;

export const fillet = (ctrl: Ctrl[], out?: Poly, fil = F): Poly => {
  const k = ctrl.length;
  const n = polyCount(k, fil);
  const o: Poly = out ?? { h: new Float64Array(n), z: new Float64Array(n), s: new Float64Array(n), corner: [] };
  o.corner.length = 0;
  let j = 0;
  o.h[j] = ctrl[0]![0];
  o.z[j] = ctrl[0]![1];
  o.corner.push(0);
  j += 1;
  for (let c = 1; c < k - 1; c += 1) {
    const [ph, pz, r0] = ctrl[c]!;
    const [ah, az] = ctrl[c - 1]!;
    const [bh, bz] = ctrl[c + 1]!;
    const l1 = Math.hypot(ah - ph, az - pz) || 1e-6;
    const l2 = Math.hypot(bh - ph, bz - pz) || 1e-6;
    const r = Math.max(0.0015, r0);
    const t1 = Math.min(r, l1 * 0.48) / l1;
    const t2 = Math.min(r, l2 * 0.48) / l2;
    const q0h = ph + (ah - ph) * t1;
    const q0z = pz + (az - pz) * t1;
    const q2h = ph + (bh - ph) * t2;
    const q2z = pz + (bz - pz) * t2;
    o.corner.push(j);
    for (let f = 0; f < fil; f += 1) {
      const t = fil > 1 ? f / (fil - 1) : 0.5;
      const u = 1 - t;
      o.h[j] = u * u * q0h + 2 * u * t * ph + t * t * q2h;
      o.z[j] = u * u * q0z + 2 * u * t * pz + t * t * q2z;
      j += 1;
    }
  }
  o.h[j] = ctrl[k - 1]![0];
  o.z[j] = ctrl[k - 1]![1];
  o.corner.push(j);
  // arc parameter: the underside (to the first corner) counts for little - it is never seen,
  // so it gets few texels
  let acc = 0;
  o.s[0] = 0;
  for (let i = 1; i < n; i += 1) {
    const d = Math.hypot(o.h[i]! - o.h[i - 1]!, o.z[i]! - o.z[i - 1]!);
    acc += i <= o.corner[1]! ? d * 0.12 : d;
    o.s[i] = acc;
  }
  for (let i = 0; i < n; i += 1) o.s[i] = acc > 0 ? o.s[i]! / acc : 0;
  return o;
};

/** Point (and in-plane outward normal) on a polyline at arc parameter s. */
const sampleS = (p: Poly, s: number, out: { h: number; z: number; nh: number; nz: number }): void => {
  const n = p.s.length;
  let i = 1;
  while (i < n - 1 && p.s[i]! < s) i += 1;
  const s0 = p.s[i - 1]!;
  const s1 = p.s[i]!;
  const t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
  out.h = p.h[i - 1]! + (p.h[i]! - p.h[i - 1]!) * t;
  out.z = p.z[i - 1]! + (p.z[i]! - p.z[i - 1]!) * t;
  const th = p.h[i]! - p.h[i - 1]!;
  const tz = p.z[i]! - p.z[i - 1]!;
  const l = Math.hypot(th, tz) || 1;
  out.nh = -tz / l;
  out.nz = th / l;
};

// ------------------------------------------------------------------ the atlas

/** Where each surface's paint lives in the livery atlas (u0, v0, u1, v1). */
export const BLOCK = {
  body: [0, 0, 1, 0.58] as const,
  lid: [0, 0.58, 1, 0.68] as const,
  front: [0, 0.68, 0.5, 0.92] as const,
  rear: [0.5, 0.68, 1, 0.92] as const,
  palette: [0, 0.92, 1, 1] as const,
};
/** Cap blocks are planar: |z| over this half width, height over this. */
const CAP_W = 0.62;
const CAP_H = 0.62;
const PAL_COLS = 16;
const PAL_ROWS = 2;

/** One paint: sRGB colour and surface properties. */
export interface Mat {
  /** sRGB bytes. */
  r: number;
  g: number;
  b: number;
  /** Roughness, metalness, clearcoat, emission (0..1 each). */
  rough: number;
  metal: number;
  clear: number;
  glow: number;
}
export const mat = (hex: number, rough = 0.35, metal = 0.2, clear = 1, glow = 0): Mat => ({
  r: (hex >> 16) & 255,
  g: (hex >> 8) & 255,
  b: hex & 255,
  rough,
  metal,
  clear,
  glow,
});

/** The surface point handed to a paint function. */
export interface Pt {
  surf: 'body' | 'lid' | 'front' | 'rear';
  x: number;
  /** Height above ground. */
  h: number;
  /** Half width |z|. */
  z: number;
  /** Outward normal (x forward, y up, z out to this side). */
  nx: number;
  ny: number;
  nz: number;
  /** Arc parameter round the section (0 bottom centre .. 1 top centre); caps: 0. */
  s: number;
  /** Body only: |z| minus the glass cabin's base half width here (9 outside the cabin's length). */
  cab: number;
}
export type Paint = (p: Pt) => Mat;

/** UV of a palette swatch (its centre). */
export const swatchUV = (i: number): [number, number] => {
  const [u0, v0, u1, v1] = BLOCK.palette;
  const c = i % PAL_COLS;
  const r = Math.floor(i / PAL_COLS) % PAL_ROWS;
  return [u0 + ((c + 0.5) / PAL_COLS) * (u1 - u0), v0 + ((r + 0.5) / PAL_ROWS) * (v1 - v0)];
};

// ------------------------------------------------------------------ the loft

/** Pushes a body point in to open a wheel well (new |z|, or null to leave it). */
export type Carve = (x: number, h: number, z: number, belowShoulder: boolean) => number | null;

export interface Surface {
  stations: Station[];
  block: readonly [number, number, number, number];
  /** Caps painted from their own planar blocks (body), or from one palette swatch (others). */
  caps: 'blocks' | number;
  /** Ring spacing along x (m). */
  step?: number;
  /** Samples per rounded corner (default 4; the far LOD uses 2). */
  fil?: number;
}

/** Wheel-well liner shade (multiplies the paint). */
const WELL = 0.07;

/**
 * Skin a surface into a mesh: position, uv (into its atlas block), colour (white, or
 * dark in a carved wheel well), creased normals.
 */
export const loft = (surf: Surface, carve?: Carve): BufferGeometry => {
  const prof = new Profile(surf.stations);
  const k = prof.k;
  const fil = surf.fil ?? F;
  const n = polyCount(k, fil);
  const step = surf.step ?? 0.04;
  // rings: evenly spaced, plus every authored station exactly
  const xsSet = new Set<number>(prof.xs);
  const len = prof.x1 - prof.x0;
  const cnt = Math.max(2, Math.ceil(len / step));
  for (let i = 0; i <= cnt; i += 1) xsSet.add(prof.x0 + (len * i) / cnt);
  const xs = [...xsSet].sort((a, b) => b - a); // front to back
  const [u0, v0, u1, v1] = surf.block;
  const uOf = (x: number): number => u0 + ((prof.x1 - x) / (len || 1)) * (u1 - u0);
  const ring = 2 * n - 2;
  const P: number[][] = []; // per ring: [x, y, z, u, v, shade] * ring
  const ctrl: Ctrl[] = [];
  let poly: Poly | undefined;
  for (const x of xs) {
    poly = fillet(prof.at(x, ctrl), poly, fil);
    const shoulder = poly.corner[4] ?? n;
    const r: number[] = [];
    const put = (i: number, side: number): void => {
      let z = poly!.z[i]!;
      const h = poly!.h[i]!;
      let shade = 1;
      const zz = carve ? carve(x, h, z, i < shoulder) : null;
      if (zz !== null && side !== 0) {
        z = zz;
        shade = WELL;
      }
      r.push(x, GROUND + h, z * side, uOf(x), v0 + poly!.s[i]! * (v1 - v0), shade);
    };
    for (let i = 0; i < n; i += 1) put(i, i === 0 || i === n - 1 ? 0 : 1);
    for (let i = n - 2; i >= 1; i -= 1) put(i, -1);
    P.push(r);
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const vert = (r: number[], i: number): void => {
    const o = i * 6;
    pos.push(r[o]!, r[o + 1]!, r[o + 2]!);
    uv.push(r[o + 3]!, r[o + 4]!);
    col.push(r[o + 5]!, r[o + 5]!, r[o + 5]!);
  };
  for (let a = 0; a + 1 < P.length; a += 1) {
    const A = P[a]!;
    const B = P[a + 1]!;
    for (let i = 0; i < ring; i += 1) {
      const i1 = (i + 1) % ring;
      vert(A, i);
      vert(B, i);
      vert(A, i1);
      vert(A, i1);
      vert(B, i);
      vert(B, i1);
    }
  }
  // caps: fans over the first and last rings
  const capUV = (z: number, h: number, front: boolean): [number, number] => {
    if (surf.caps !== 'blocks') return swatchUV(surf.caps);
    const [cu0, cv0, cu1, cv1] = front ? BLOCK.front : BLOCK.rear;
    return [cu0 + Math.min(1, Math.abs(z) / CAP_W) * (cu1 - cu0), cv0 + Math.min(1, Math.max(0, h / CAP_H)) * (cv1 - cv0)];
  };
  const cap = (r: number[], front: boolean): void => {
    let cy = 0;
    for (let i = 0; i < ring; i += 1) cy += r[i * 6 + 1]!;
    cy /= ring;
    const x = r[0]!;
    const cv = (y: number, z: number): void => {
      pos.push(x, y, z);
      const [u, v] = capUV(z, y - GROUND, front);
      uv.push(u, v);
      col.push(1, 1, 1);
    };
    for (let i = 0; i < ring; i += 1) {
      const i1 = (i + 1) % ring;
      const a = front ? i : i1;
      const b = front ? i1 : i;
      cv(cy, 0);
      cv(r[a * 6 + 1]!, r[a * 6 + 2]!);
      cv(r[b * 6 + 1]!, r[b * 6 + 2]!);
    }
  };
  cap(P[0]!, true);
  cap(P[P.length - 1]!, false);
  // winding: outward everywhere (signed volume positive), whatever the ring order came out as
  let vol = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i]!, ay = pos[i + 1]!, az = pos[i + 2]!;
    const bx = pos[i + 3]!, by = pos[i + 4]!, bz = pos[i + 5]!;
    const cx = pos[i + 6]!, cy = pos[i + 7]!, cz = pos[i + 8]!;
    vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  if (vol < 0) {
    for (const [arr, w] of [[pos, 3], [uv, 2], [col, 3]] as const) {
      for (let t = 0; t < arr.length; t += w * 3) {
        for (let q = 0; q < w; q += 1) {
          const tmp = arr[t + w + q]!;
          arr[t + w + q] = arr[t + 2 * w + q]!;
          arr[t + 2 * w + q] = tmp;
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return creased(g, 38);
};

// ------------------------------------------------------------------ the bake

export interface Livery {
  albedo: DataTexture;
  orm: DataTexture;
}

/**
 * Paint a car's atlas: every texel of the body, lid and cap blocks is a surface point
 * handed to `paint`; the palette row gets the swatches. Albedo is sRGB; ORM holds
 * clearcoat (R), roughness (G), metalness (B) and glow (A).
 */
export const bakeLivery = (body: Station[], lid: Station[] | null, palette: Mat[], paint: Paint, width: number): Livery => {
  const W = width;
  const H = width / 2;
  const al = new Uint8Array(W * H * 4);
  const orm = new Uint8Array(W * H * 4);
  const put = (i: number, j: number, m: Mat, ao = 1): void => {
    const o = (j * W + i) * 4;
    al[o] = m.r * ao;
    al[o + 1] = m.g * ao;
    al[o + 2] = m.b * ao;
    al[o + 3] = 255;
    orm[o] = m.clear * 255;
    orm[o + 1] = m.rough * 255;
    orm[o + 2] = m.metal * 255;
    orm[o + 3] = m.glow * 255;
  };
  const p: Pt = { surf: 'body', x: 0, h: 0, z: 0, nx: 0, ny: 1, nz: 0, s: 0, cab: 9 };
  const smp = { h: 0, z: 0, nh: 0, nz: 0 };
  const smpA = { h: 0, z: 0, nh: 0, nz: 0 };
  const smpB = { h: 0, z: 0, nh: 0, nz: 0 };
  const sides = (stations: Station[], block: readonly [number, number, number, number], surf: Pt['surf']): void => {
    const prof = new Profile(stations);
    const [u0, v0, u1, v1] = block;
    const i0 = Math.round(u0 * W);
    const i1 = Math.round(u1 * W);
    const j0 = Math.round(v0 * H);
    const j1 = Math.round(v1 * H);
    const len = prof.x1 - prof.x0;
    const c: Ctrl[] = [];
    const ca: Ctrl[] = [];
    const cb: Ctrl[] = [];
    let pp: Poly | undefined;
    let pa: Poly | undefined;
    let pb: Poly | undefined;
    const dx = 0.004;
    for (let i = i0; i < i1; i += 1) {
      const x = prof.x1 - ((i + 0.5 - i0) / (i1 - i0)) * len;
      pp = fillet(prof.at(x, c), pp);
      pa = fillet(prof.at(x + dx, ca), pa);
      pb = fillet(prof.at(x - dx, cb), pb);
      for (let j = j0; j < j1; j += 1) {
        const s = (j + 0.5 - j0) / (j1 - j0);
        sampleS(pp, s, smp);
        sampleS(pa, s, smpA);
        sampleS(pb, s, smpB);
        const dh = (smpA.h - smpB.h) / (2 * dx);
        const dz = (smpA.z - smpB.z) / (2 * dx);
        let nx = -(smp.nh * dh + smp.nz * dz);
        let ny = smp.nh;
        let nz = smp.nz;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        p.surf = surf;
        p.x = x;
        p.h = smp.h;
        p.z = smp.z;
        p.nx = nx;
        p.ny = ny;
        p.nz = nz;
        p.s = s;
        // a touch of baked occlusion low down and underneath
        const ao = 1 - 0.3 * Math.max(0, Math.min(1, (0.14 - smp.h) / 0.08)) - (ny < -0.5 ? 0.25 : 0);
        put(i, j, paint(p), ao);
      }
    }
  };
  sides(body, BLOCK.body, 'body');
  if (lid) sides(lid, BLOCK.lid, 'lid');
  const prof = new Profile(body);
  const caps = (front: boolean): void => {
    const [u0, v0, u1, v1] = front ? BLOCK.front : BLOCK.rear;
    const i0 = Math.round(u0 * W);
    const i1 = Math.round(u1 * W);
    const j0 = Math.round(v0 * H);
    const j1 = Math.round(v1 * H);
    for (let i = i0; i < i1; i += 1) {
      for (let j = j0; j < j1; j += 1) {
        p.surf = front ? 'front' : 'rear';
        p.x = front ? prof.x1 : prof.x0;
        p.z = ((i + 0.5 - i0) / (i1 - i0)) * CAP_W;
        p.h = ((j + 0.5 - j0) / (j1 - j0)) * CAP_H;
        p.nx = front ? 1 : -1;
        p.ny = 0;
        p.nz = 0;
        p.s = 0;
        put(i, j, paint(p));
      }
    }
  };
  caps(true);
  caps(false);
  {
    const [u0, v0, u1, v1] = BLOCK.palette;
    const i0 = Math.round(u0 * W);
    const i1 = Math.round(u1 * W);
    const j0 = Math.round(v0 * H);
    const j1 = Math.round(v1 * H);
    for (let i = i0; i < i1; i += 1) {
      for (let j = j0; j < j1; j += 1) {
        const c = Math.floor(((i - i0) / (i1 - i0)) * PAL_COLS);
        const r = Math.floor(((j - j0) / (j1 - j0)) * PAL_ROWS);
        const m = palette[r * PAL_COLS + c];
        if (m) put(i, j, m);
      }
    }
  }
  const tex = (data: Uint8Array, srgb: boolean): DataTexture => {
    const t = new DataTexture(data, W, H, RGBAFormat, UnsignedByteType);
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: tex(al, true), orm: tex(orm, false) };
};
