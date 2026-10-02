import { mat, type Mat, type Pt, type Station } from './loft.js';
import type { Parts } from './parts.js';
import type { WheelSpec } from './wheels.js';

/** A glass cabin section: windscreen base / side glass / roof edge (heights above ground, half widths). */
export interface CabSpec {
  x: number;
  yb: number;
  yt: number;
  wb: number;
  wt: number;
  crown?: number;
}

export interface CarModel {
  id: number;
  name: string;
  tagline: string;
  body: Station[];
  cabin: CabSpec[];
  /** The painted roof panel over the glass, between these x. */
  roof: [number, number];
  palette: Record<string, Mat>;
  paint(p: Pt, c: Record<string, Mat>): Mat;
  wheels: WheelSpec;
  /** Brake caliper colour (palette name). */
  caliper: string;
  /** Window pillars (palette name). */
  pillar: string;
  parts(p: Parts): void;
  /** Driver: hip position (x, height) and scale. */
  seat: { x: number; h: number; scale: number };
  nozzles: [number, number, number][];
}

// ------------------------------------------------------------------ geometry helpers for paint

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Point in polygon, flat [x0, y0, x1, y1, ...]. */
export const inPoly = (x: number, y: number, poly: number[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i]!, yi = poly[i + 1]!, xj = poly[j]!, yj = poly[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Distance from (px, py) to the segment a-b. */
export const seg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
};

/** Distance to a polyline [x0, y0, x1, y1, ...]. */
export const line = (px: number, py: number, pts: number[]): number => {
  let d = 9;
  for (let i = 0; i + 3 < pts.length; i += 2) d = Math.min(d, seg(px, py, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!));
  return d;
};

const hash3 = (a: number, b: number, c: number): number => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** 3D Voronoi: the nearest cell's hash and the gap to the second nearest (0 = on an edge). */
export const voronoi = (x: number, y: number, z: number, out: { id: number; edge: number }): void => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let a = -1; a <= 1; a += 1)
    for (let b = -1; b <= 1; b += 1)
      for (let c = -1; c <= 1; c += 1) {
        const cx = ix + a + hash3(ix + a, iy + b, iz + c);
        const cy = iy + b + hash3(iy + b, iz + c, ix + a + 17);
        const cz = iz + c + hash3(iz + c, ix + a, iy + b + 31);
        const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = hash3(ix + a + 5, iy + b + 9, iz + c + 13);
        } else if (d < d2) d2 = d;
      }
  out.id = id;
  out.edge = Math.sqrt(d2) - Math.sqrt(d1);
};

/** 2D Voronoi (nine cells: a third of the 3D cost). */
export const voronoi2 = (x: number, y: number, out: { id: number; edge: number }): void => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let a = -1; a <= 1; a += 1)
    for (let b = -1; b <= 1; b += 1) {
      const cx = ix + a + hash3(ix + a, iy + b, 7);
      const cy = iy + b + hash3(iy + b, ix + a, 19);
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash3(ix + a + 5, iy + b + 9, 13);
      } else if (d < d2) d2 = d;
    }
  out.id = id;
  out.edge = Math.sqrt(d2) - Math.sqrt(d1);
};

/** Distance (side view) from a point to a wheel centre at (wx, r). */
export const wheelDist = (p: Pt, wx: number, r: number): number => Math.hypot(p.x - wx, p.h - r);

// ------------------------------------------------------------------ shared paints

export const satin = (hex = 0x141619): Mat => mat(hex, 0.4, 0, 0.3);
export const gloss = (hex: number): Mat => mat(hex, 0.12, 0.25, 1);
export const chrome = (): Mat => mat(0xdfe4ec, 0.1, 1, 0.6);
export const led = (hex: number): Mat => mat(hex, 0.2, 0, 0, 1);
export const grille = (): Mat => mat(0x050506, 0.9, 0, 0);
export const carbon = (): Mat => mat(0x202328, 0.35, 0.35, 0.9);

/** Horizontal bars: `bar` for the first 42 % of each `pitch`. */
export const slats = (v: number, pitch: number, bar: Mat, gap: Mat, fill = 0.42): Mat => ((((v / pitch) % 1) + 1) % 1 < fill ? bar : gap);

/** A honeycomb mesh on (u, v). */
export const honey = (u: number, v: number, cell: number, wire: Mat, hole: Mat): Mat => {
  const a = u / cell;
  const b = v / (cell * 0.866);
  const row = Math.floor(b);
  const fa = (((a + (row % 2) * 0.5) % 1) + 1) % 1;
  const fb = ((b % 1) + 1) % 1;
  return fa < 0.16 || fb < 0.2 ? wire : hole;
};
