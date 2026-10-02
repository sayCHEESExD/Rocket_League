import { arenaQuery } from './arena.js';
import { BALL, GRAVITY } from './constants.js';
import { cross, dot, len, set, v3 } from './math.js';

export class BallState {
  readonly pos = v3(0, 0, BALL.restZ);
  readonly vel = v3();
  readonly angVel = v3();
  /** Index of the last car to touch it (-1 none), and its team. */
  lastTouch = -1;
  lastTouchTeam = -1;
  /** The touch before that, by a teammate of the scorer = assist. */
  prevTouch = -1;

  copyFrom(o: BallState): void {
    set(this.pos, o.pos.x, o.pos.y, o.pos.z);
    set(this.vel, o.vel.x, o.vel.y, o.vel.z);
    set(this.angVel, o.angVel.x, o.angVel.y, o.angVel.z);
    this.lastTouch = o.lastTouch;
    this.lastTouchTeam = o.lastTouchTeam;
    this.prevTouch = o.prevTouch;
  }
}

export const resetBall = (b: BallState): void => {
  set(b.pos, 0, 0, BALL.restZ);
  set(b.vel, 0, 0, 0);
  set(b.angVel, 0, 0, 0);
  b.lastTouch = -1;
  b.lastTouchTeam = -1;
  b.prevTouch = -1;
};

const n = v3();
const vPerp = v3();
const vPara = v3();
const vSpin = v3();
const s = v3();
const tmp = v3();

/**
 * One substep of free flight and world contact. Returns the normal speed of a
 * bounce this step (0 = none), for sounds and effects.
 *
 * The bounce is RLUtilities' model of Rocket League's ball: restitution on the
 * normal, a friction impulse on the contact patch's slip (sliding + spin) that
 * both slows the ball and turns slip into spin - which is what makes it roll
 * after a weak hit and kick up off walls after a strong one.
 */
export const stepBall = (b: BallState, dt: number): number => {
  b.vel.z += GRAVITY * dt;
  const drag = 1 - BALL.drag * dt;
  b.vel.x *= drag;
  b.vel.y *= drag;
  b.vel.z *= drag;
  const sp = len(b.vel);
  if (sp > BALL.maxSpeed) {
    const k = BALL.maxSpeed / sp;
    b.vel.x *= k;
    b.vel.y *= k;
    b.vel.z *= k;
  }
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  b.pos.z += b.vel.z * dt;
  // spin (the ball's rotation is presentation + bounce coupling)
  const w = len(b.angVel);
  if (w > BALL.maxAngSpeed) {
    const k = BALL.maxAngSpeed / w;
    b.angVel.x *= k;
    b.angVel.y *= k;
    b.angVel.z *= k;
  }

  let bounce = 0;
  for (let iter = 0; iter < 2; iter += 1) {
    const d = arenaQuery(b.pos, n);
    if (d >= BALL.radius) break;
    const pen = BALL.radius - d;
    b.pos.x += n.x * pen;
    b.pos.y += n.y * pen;
    b.pos.z += n.z * pen;
    const vn = dot(b.vel, n);
    if (vn >= 0) continue;
    set(vPerp, n.x * vn, n.y * vn, n.z * vn);
    set(vPara, b.vel.x - vPerp.x, b.vel.y - vPerp.y, b.vel.z - vPerp.z);
    // velocity of the contact patch due to spin: R * (w x -n) = R * (n x w)
    cross(vSpin, n, b.angVel);
    set(vSpin, vSpin.x * BALL.radius, vSpin.y * BALL.radius, vSpin.z * BALL.radius);
    set(s, vPara.x + vSpin.x, vPara.y + vSpin.y, vPara.z + vSpin.z);
    const sl = len(s);
    const ratio = -vn / Math.max(sl, 1e-4);
    const restitution = -vn < BALL.restSpeed ? 0 : BALL.restitution;
    const k = Math.min(1, 2 * ratio) * BALL.friction;
    // delta v
    const dPx = -(1 + restitution) * vPerp.x;
    const dPy = -(1 + restitution) * vPerp.y;
    const dPz = -(1 + restitution) * vPerp.z;
    const dSx = -k * s.x;
    const dSy = -k * s.y;
    const dSz = -k * s.z;
    // spin from the friction impulse
    set(tmp, dSx, dSy, dSz);
    cross(tmp, tmp, n);
    const a = BALL.spinCoupling * BALL.radius;
    b.angVel.x += a * tmp.x;
    b.angVel.y += a * tmp.y;
    b.angVel.z += a * tmp.z;
    b.vel.x += dPx + dSx;
    b.vel.y += dPy + dSy;
    b.vel.z += dPz + dSz;
    if (-vn > bounce) bounce = -vn;
  }
  return bounce;
};
