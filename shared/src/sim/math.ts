/**
 * Tiny allocation-free vector / quaternion helpers for the simulation.
 *
 * The sim runs on the server AND on every client (prediction replays it many
 * times a frame), so nothing in a hot path allocates: callers pass `out`.
 * Coordinates are Rocket League's: Z up, the goals at -Y (blue) and +Y (orange),
 * units are "uu" (about a centimetre). Car local frame: +X forward, +Y left, +Z up.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Q4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const q4 = (x = 0, y = 0, z = 0, w = 1): Q4 => ({ x, y, z, w });

export const set = (o: V3, x: number, y: number, z: number): V3 => {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
};
export const copy = (o: V3, a: V3): V3 => {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  return o;
};
export const add = (o: V3, a: V3, b: V3): V3 => set(o, a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (o: V3, a: V3, b: V3): V3 => set(o, a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (o: V3, a: V3, s: number): V3 => set(o, a.x * s, a.y * s, a.z * s);
/** o = a + b * s */
export const addScaled = (o: V3, a: V3, b: V3, s: number): V3 => set(o, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (o: V3, a: V3, b: V3): V3 =>
  set(o, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const lenSq = (a: V3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const dist = (a: V3, b: V3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};
export const normalize = (o: V3, a: V3): V3 => {
  const l = len(a);
  if (l < 1e-9) return set(o, 0, 0, 0);
  return scale(o, a, 1 / l);
};
export const clampLen = (o: V3, max: number): V3 => {
  const l = len(o);
  if (l > max) scale(o, o, max / l);
  return o;
};
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ------------------------------------------------------------ quaternions

export const qcopy = (o: Q4, a: Q4): Q4 => {
  o.x = a.x;
  o.y = a.y;
  o.z = a.z;
  o.w = a.w;
  return o;
};

export const qnormalize = (q: Q4): Q4 => {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (l < 1e-12) {
    q.x = 0;
    q.y = 0;
    q.z = 0;
    q.w = 1;
    return q;
  }
  const s = 1 / l;
  q.x *= s;
  q.y *= s;
  q.z *= s;
  q.w *= s;
  return q;
};

/** o = a * b */
export const qmul = (o: Q4, a: Q4, b: Q4): Q4 => {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  o.x = x;
  o.y = y;
  o.z = z;
  o.w = w;
  return o;
};

export const qFromAxisAngle = (o: Q4, ax: number, ay: number, az: number, angle: number): Q4 => {
  const h = angle * 0.5;
  const s = Math.sin(h);
  o.x = ax * s;
  o.y = ay * s;
  o.z = az * s;
  o.w = Math.cos(h);
  return o;
};

/** Yaw about world Z (0 = facing +X). */
export const qFromYaw = (o: Q4, yaw: number): Q4 => qFromAxisAngle(o, 0, 0, 1, yaw);

/** o = rotate v by q (o may alias v). */
export const qrot = (o: V3, q: Q4, v: V3): V3 => {
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return set(
    o,
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
};

/** o = rotate v by inverse(q). */
export const qrotInv = (o: V3, q: Q4, v: V3): V3 => {
  const cx = -q.x;
  const cy = -q.y;
  const cz = -q.z;
  const tx = 2 * (cy * v.z - cz * v.y);
  const ty = 2 * (cz * v.x - cx * v.z);
  const tz = 2 * (cx * v.y - cy * v.x);
  return set(
    o,
    v.x + q.w * tx + (cy * tz - cz * ty),
    v.y + q.w * ty + (cz * tx - cx * tz),
    v.z + q.w * tz + (cx * ty - cy * tx),
  );
};

/** Local axes of a rotation. */
export const forwardOf = (o: V3, q: Q4): V3 =>
  set(o, 1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y + q.w * q.z), 2 * (q.x * q.z - q.w * q.y));
export const leftOf = (o: V3, q: Q4): V3 =>
  set(o, 2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x));
export const upOf = (o: V3, q: Q4): V3 =>
  set(o, 2 * (q.x * q.z + q.w * q.y), 2 * (q.y * q.z - q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y));

/** Integrate an angular velocity (world space, rad/s) into q over dt. */
export const qIntegrate = (q: Q4, w: V3, dt: number): Q4 => {
  const ang = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z) * dt;
  if (ang < 1e-12) return q;
  const s = Math.sin(ang * 0.5) / (ang / dt);
  const dx = w.x * s;
  const dy = w.y * s;
  const dz = w.z * s;
  const dw = Math.cos(ang * 0.5);
  // q = d * q (world-space rotation applied on the left)
  const x = dw * q.x + dx * q.w + dy * q.z - dz * q.y;
  const y = dw * q.y - dx * q.z + dy * q.w + dz * q.x;
  const z = dw * q.z + dx * q.y - dy * q.x + dz * q.w;
  const ww = dw * q.w - dx * q.x - dy * q.y - dz * q.z;
  q.x = x;
  q.y = y;
  q.z = z;
  q.w = ww;
  return qnormalize(q);
};

/** Piecewise-linear lookup over sorted [x, y] pairs; clamps at both ends. */
export const curve = (points: readonly (readonly [number, number])[], x: number): number => {
  const first = points[0]!;
  if (x <= first[0]) return first[1];
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i]!;
    if (x <= b[0]) {
      const a = points[i - 1]!;
      return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    }
  }
  return points[points.length - 1]![1];
};
