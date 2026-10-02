import { ARENA } from './constants.js';
import { set, type V3 } from './math.js';

/**
 * THE ARENA AS A DISTANCE FIELD.
 *
 * The playable volume is the union of
 *   A: an octagonal prism (side walls, back walls, 45-degree corners, floor,
 *      ceiling) with EVERY edge rounded by `ARENA.round` - the curves a car
 *      drives up - built as "everything within R of an inset prism", which
 *      makes its distance exact and cheap;
 *   B: two goal boxes behind the back walls.
 *
 * A plain max() of the two would be wrong exactly where it matters (a ball
 * grazing a post would be pushed back out of the goal), so the union is
 * resolved properly: the nearest solid point is the nearest point of A's
 * boundary that is not inside a goal, or of a goal's boundary that is not
 * inside A, or a point on the post/crossbar edges where the two meet.
 *
 * `arenaQuery` returns the distance from p to the nearest wall (positive
 * inside the playable space) and the unit normal pointing back INTO it.
 */

const R = ARENA.round;
const X0 = ARENA.halfX - R;
const Y0 = ARENA.halfY - R;
const C0 = ARENA.corner - R * Math.SQRT2;
const ZLO = R;
const ZHI = ARENA.height - R;
/** First-quadrant octagon corners (inset). */
const X1 = C0 - Y0;
const Y1 = C0 - X0;

const GW = ARENA.goal.halfWidth;
const GH = ARENA.goal.height;
const GY_BACK = ARENA.halfY + ARENA.goal.depth;
const GY_FRONT = ARENA.halfY - 1200;

/** Scratch, so nothing allocates. */
const n2 = { x: 0, y: 0 };
const c2 = { x: 0, y: 0 };

/** Distance from (px,py) to segment a-b; writes the closest point to c2. */
const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const ex = bx - ax;
  const ey = by - ay;
  let t = ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + ex * t;
  const cy = ay + ey * t;
  c2.x = cx;
  c2.y = cy;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Signed 2D distance to the inset octagon (negative inside). Writes the
 * closest boundary point to c2 and the outward normal to n2 (both unfolded).
 */
const octagon = (x: number, y: number): number => {
  const sx = x < 0 ? -1 : 1;
  const sy = y < 0 ? -1 : 1;
  const ax = x * sx;
  const ay = y * sy;

  let best = segDist2(ax, ay, X0, 0, X0, Y1);
  let bcx = c2.x;
  let bcy = c2.y;
  let nx = 1;
  let ny = 0;
  let d = segDist2(ax, ay, X0, Y1, X1, Y0);
  if (d < best) {
    best = d;
    bcx = c2.x;
    bcy = c2.y;
    nx = Math.SQRT1_2;
    ny = Math.SQRT1_2;
  }
  d = segDist2(ax, ay, X1, Y0, 0, Y0);
  if (d < best) {
    best = d;
    bcx = c2.x;
    bcy = c2.y;
    nx = 0;
    ny = 1;
  }
  const inside = ax <= X0 && ay <= Y0 && ax + ay <= C0;
  if (!inside && best > 1e-6) {
    // Outside: the normal points from the closest point to p (round at the vertices).
    nx = (ax - bcx) / best;
    ny = (ay - bcy) / best;
  }
  c2.x = bcx * sx;
  c2.y = bcy * sy;
  n2.x = nx * sx;
  n2.y = ny * sy;
  return inside ? -best : best;
};

/**
 * Distance from p to A's boundary (positive inside A); inward normal to `n`,
 * closest boundary point to `c`.
 */
const queryA = (px: number, py: number, pz: number, n: V3, c: V3): number => {
  const s2 = octagon(px, py);
  const below = ZLO - pz;
  const above = pz - ZHI;
  if (s2 <= 0 && below <= 0 && above <= 0) {
    // Inside the inset prism: the nearest face wins.
    let f = s2;
    let ox = n2.x;
    let oy = n2.y;
    let oz = 0;
    if (below > f) {
      f = below;
      ox = 0;
      oy = 0;
      oz = -1;
    }
    if (above > f) {
      f = above;
      ox = 0;
      oy = 0;
      oz = 1;
    }
    const dA = R - f;
    set(n, -ox, -oy, -oz);
    set(c, px + ox * dA, py + oy * dA, pz + oz * dA);
    return dA;
  }
  const cx = s2 > 0 ? c2.x : px;
  const cy = s2 > 0 ? c2.y : py;
  const cz = pz < ZLO ? ZLO : pz > ZHI ? ZHI : pz;
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const f = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (f < 1e-9) {
    set(n, 0, 0, 1);
    set(c, px, py, pz - R);
    return R;
  }
  const ox = dx / f;
  const oy = dy / f;
  const oz = dz / f;
  set(n, -ox, -oy, -oz);
  set(c, cx + ox * R, cy + oy * R, cz + oz * R);
  return R - f;
};

/** Distance from p to goal box (side s = +-1) boundary, positive inside; front is open. */
const queryB = (px: number, py: number, pz: number, s: number, n: V3, c: V3): number => {
  const ly = py * s;
  const ax = px < 0 ? -px : px;
  const sx = px < 0 ? -1 : 1;
  const inside = ax <= GW && pz >= 0 && pz <= GH && ly <= GY_BACK && ly >= GY_FRONT;
  if (inside) {
    let d = GW - ax;
    let nx = -sx;
    let ny = 0;
    let nz = 0;
    if (pz < d) {
      d = pz;
      nx = 0;
      nz = 1;
    }
    if (GH - pz < d) {
      d = GH - pz;
      nx = 0;
      nz = -1;
    }
    if (GY_BACK - ly < d) {
      d = GY_BACK - ly;
      nx = 0;
      nz = 0;
      ny = -s;
    }
    set(n, nx, ny, nz);
    set(c, px - nx * d, py - ny * d, pz - nz * d);
    return d;
  }
  const cx = px < -GW ? -GW : px > GW ? GW : px;
  const cz = pz < 0 ? 0 : pz > GH ? GH : pz;
  const cly = ly < GY_FRONT ? GY_FRONT : ly > GY_BACK ? GY_BACK : ly;
  const cy = cly * s;
  const dx = cx - px;
  const dy = cy - py;
  const dz = cz - pz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-9) set(n, 0, 0, 1);
  else set(n, dx / d, dy / d, dz / d);
  set(c, cx, cy, cz);
  return -d;
};

const strictlyInB = (x: number, y: number, z: number, s: number): boolean => {
  const ly = y * s;
  const e = 0.5;
  return (x < 0 ? -x : x) < GW - e && z > e && z < GH - e && ly < GY_BACK - e && ly > GY_FRONT + e;
};

/**
 * The goal mouth edges (where A's back wall meets the goal box), for side +1:
 * each post follows the floor fillet near the ground, then runs straight up;
 * the crossbar joins them. Polylines of [x, y, z].
 */
const POST_STEPS = 8;
const postLine = (sx: number): number[] => {
  const pts: number[] = [];
  for (let i = 0; i <= POST_STEPS; i += 1) {
    const z = (R * i) / POST_STEPS;
    const y = Y0 + Math.sqrt(Math.max(0, R * R - (R - z) * (R - z)));
    pts.push(sx * GW, y, z);
  }
  pts.push(sx * GW, ARENA.halfY, GH);
  return pts;
};
const EDGES: readonly number[][] = [postLine(-1), postLine(1), [-GW, ARENA.halfY, GH, GW, ARENA.halfY, GH]];

const ec = { x: 0, y: 0, z: 0 };
/** Distance from p to an edge polyline (side s); closest point to ec. */
const edgeDist = (px: number, py: number, pz: number, line: number[], s: number): number => {
  let best = Infinity;
  for (let i = 0; i + 5 < line.length; i += 3) {
    const ax = line[i]!;
    const ay = line[i + 1]! * s;
    const az = line[i + 2]!;
    const ex = line[i + 3]! - ax;
    const ey = line[i + 4]! * s - ay;
    const ez = line[i + 5]! - az;
    let t = ((px - ax) * ex + (py - ay) * ey + (pz - az) * ez) / (ex * ex + ey * ey + ez * ez);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    const cz = az + ez * t;
    const dx = px - cx;
    const dy = py - cy;
    const dz = pz - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < best) {
      best = d;
      ec.x = cx;
      ec.y = cy;
      ec.z = cz;
    }
  }
  return best;
};

const nA = { x: 0, y: 0, z: 0 };
const cA = { x: 0, y: 0, z: 0 };
const nB = { x: 0, y: 0, z: 0 };
const cB = { x: 0, y: 0, z: 0 };
const nT = { x: 0, y: 0, z: 0 };
const cT = { x: 0, y: 0, z: 0 };

/**
 * Distance from p to the nearest wall (positive inside the playable space),
 * with the unit normal pointing into the playable space written to `normal`.
 */
export const arenaQuery = (p: V3, normal: V3): number => {
  const px = p.x;
  const py = p.y;
  const pz = p.z;
  const dA = queryA(px, py, pz, nA, cA);
  // Far from both goal mouths: A alone is exact.
  const ay = py < 0 ? -py : py;
  if (ay < ARENA.halfY - 700 || (px < 0 ? -px : px) > GW + 600 || pz > GH + 600) {
    set(normal, nA.x, nA.y, nA.z);
    return dA;
  }
  const s = py < 0 ? -1 : 1;
  const dB = queryB(px, py, pz, s, nB, cB);
  if (dA <= 0 && dB <= 0) {
    // Inside the wall: head for whichever interior is nearer.
    if (dA >= dB) set(normal, nA.x, nA.y, nA.z);
    else set(normal, nB.x, nB.y, nB.z);
    return dA >= dB ? dA : dB;
  }
  let best = Infinity;
  if (dA > 0 && !strictlyInB(cA.x, cA.y, cA.z, s)) {
    best = dA;
    set(normal, nA.x, nA.y, nA.z);
  }
  if (dB > 0 && dB < best && queryA(cB.x, cB.y, cB.z, nT, cT) <= 0.5) {
    best = dB;
    set(normal, nB.x, nB.y, nB.z);
  }
  for (let i = 0; i < EDGES.length; i += 1) {
    const d = edgeDist(px, py, pz, EDGES[i]!, s);
    if (d < best) {
      best = d;
      if (d > 1e-6) set(normal, (px - ec.x) / d, (py - ec.y) / d, (pz - ec.z) / d);
      else set(normal, 0, -s, 0);
    }
  }
  return best;
};

const rp = { x: 0, y: 0, z: 0 };
const rn = { x: 0, y: 0, z: 0 };

/**
 * Sphere-traced ray against the arena. Returns the hit distance (or -1 for no
 * hit within maxDist) and writes the surface normal at the hit to `normal`.
 */
export const arenaRaycast = (o: V3, dx: number, dy: number, dz: number, maxDist: number, normal: V3): number => {
  let t = 0;
  for (let i = 0; i < 32; i += 1) {
    set(rp, o.x + dx * t, o.y + dy * t, o.z + dz * t);
    const d = arenaQuery(rp, rn);
    if (d < 0.25) {
      set(normal, rn.x, rn.y, rn.z);
      return t < 0 ? 0 : t;
    }
    t += d;
    if (t > maxDist) return -1;
  }
  return -1;
};

/** True when the ball (center) has fully crossed a goal line. Returns +1/-1 for the goal at +Y/-Y, else 0. */
export const goalSide = (p: V3, radius: number): number => {
  if (p.y > ARENA.halfY + radius) return 1;
  if (p.y < -ARENA.halfY - radius) return -1;
  return 0;
};
