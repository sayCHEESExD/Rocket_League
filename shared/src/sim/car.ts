import { arenaQuery, arenaRaycast } from './arena.js';
import { CAR, GRAVITY } from './constants.js';
import type { CarInput } from './input.js';
import {
  clamp,
  cross,
  curve,
  dot,
  forwardOf,
  leftOf,
  len,
  q4,
  qIntegrate,
  qrot,
  qrotInv,
  set,
  upOf,
  v3,
  type Q4,
  type V3,
} from './math.js';

/** Everything that defines one car's physical and gameplay state. */
export class CarState {
  readonly pos = v3();
  readonly vel = v3();
  readonly quat = q4();
  readonly angVel = v3();
  /** Ground normal under the wheels at the last step (how fast the surface is turning). */
  readonly gn = v3(0, 0, 1);
  team = 0;
  active = false;

  boost = 0;
  boosting = false;
  boostTime = 0;
  /** 0..1, rises while the powerslide button is held. */
  handbrake = 0;

  /** Wheels touching (0..4) and whether it counts as driving (3+). */
  wheels = 0;
  onGround = false;
  /** Seconds continuously on the ground (resets the jump after a short pad). */
  groundTime = 0;

  jumpHeld = false;
  isJumping = false;
  jumpTime = 0;
  hasJumped = false;
  hasDoubleJumped = false;
  hasFlipped = false;
  airTimeSinceJump = 0;
  flipping = false;
  flipTime = 0;
  flipX = 0;
  flipY = 0;
  /** On its roof against a surface (jump rights it). */
  onRoof = false;
  autoFlipTime = 0;
  autoFlipDir = 0;

  supersonic = false;
  demolished = false;
  respawnTime = 0;
  /** Physics step of the last ball touch (the extra impulse needs a gap). */
  lastBallHit = -10;
  bumpCooldown = 0;

  copyFrom(o: CarState): void {
    set(this.pos, o.pos.x, o.pos.y, o.pos.z);
    set(this.vel, o.vel.x, o.vel.y, o.vel.z);
    this.quat.x = o.quat.x;
    this.quat.y = o.quat.y;
    this.quat.z = o.quat.z;
    this.quat.w = o.quat.w;
    set(this.angVel, o.angVel.x, o.angVel.y, o.angVel.z);
    set(this.gn, o.gn.x, o.gn.y, o.gn.z);
    this.team = o.team;
    this.active = o.active;
    this.boost = o.boost;
    this.boosting = o.boosting;
    this.boostTime = o.boostTime;
    this.handbrake = o.handbrake;
    this.wheels = o.wheels;
    this.onGround = o.onGround;
    this.groundTime = o.groundTime;
    this.jumpHeld = o.jumpHeld;
    this.isJumping = o.isJumping;
    this.jumpTime = o.jumpTime;
    this.hasJumped = o.hasJumped;
    this.hasDoubleJumped = o.hasDoubleJumped;
    this.hasFlipped = o.hasFlipped;
    this.airTimeSinceJump = o.airTimeSinceJump;
    this.flipping = o.flipping;
    this.flipTime = o.flipTime;
    this.flipX = o.flipX;
    this.flipY = o.flipY;
    this.onRoof = o.onRoof;
    this.autoFlipTime = o.autoFlipTime;
    this.autoFlipDir = o.autoFlipDir;
    this.supersonic = o.supersonic;
    this.demolished = o.demolished;
    this.respawnTime = o.respawnTime;
    this.lastBallHit = o.lastBallHit;
    this.bumpCooldown = o.bumpCooldown;
  }
}

/** Box inertia per unit mass, inverted (local axes). */
const HX = CAR.half.x * 2;
const HY = CAR.half.y * 2;
const HZ = CAR.half.z * 2;
export const CAR_INV_INERTIA = {
  x: 12 / (HY * HY + HZ * HZ),
  y: 12 / (HX * HX + HZ * HZ),
  z: 12 / (HX * HX + HY * HY),
};

/** Collision samples on the hitbox: corners, edge midpoints and face centres (local, offset applied). */
export const HULL_SAMPLES: readonly V3[] = (() => {
  const out: V3[] = [];
  for (const sx of [-1, 0, 1])
    for (const sy of [-1, 0, 1])
      for (const sz of [-1, 0, 1]) {
        if (sx === 0 && sy === 0 && sz === 0) continue;
        out.push(v3(CAR.offset.x + sx * CAR.half.x, CAR.offset.y + sy * CAR.half.y, CAR.offset.z + sz * CAR.half.z));
      }
  return out;
})();
const HULL_RADIUS = Math.sqrt(CAR.half.x ** 2 + CAR.half.y ** 2 + CAR.half.z ** 2) + 4;

// scratch
const fwd = v3();
const left = v3();
const up = v3();
const tmp = v3();
const tmp2 = v3();
const wp = v3();
const hitN = v3();
const nAvg = v3();
const fwdS = v3();
const sideS = v3();
const acc = v3();
const angAcc = v3();
const wLocal = v3();
const rel = v3();

/** Apply an impulse (as a velocity change per unit mass, world) at world offset r from the centre of mass. */
export const applyCarImpulse = (c: CarState, r: V3, jx: number, jy: number, jz: number, massScale: number): void => {
  c.vel.x += jx * massScale;
  c.vel.y += jy * massScale;
  c.vel.z += jz * massScale;
  // angular: w += Iinv * (r x j)
  set(tmp, jx, jy, jz);
  cross(tmp2, r, tmp);
  qrotInv(tmp2, c.quat, tmp2);
  tmp2.x *= CAR_INV_INERTIA.x * massScale;
  tmp2.y *= CAR_INV_INERTIA.y * massScale;
  tmp2.z *= CAR_INV_INERTIA.z * massScale;
  qrot(tmp2, c.quat, tmp2);
  c.angVel.x += tmp2.x;
  c.angVel.y += tmp2.y;
  c.angVel.z += tmp2.z;
};

/** n . ((Iinv (r x n)) x r) per unit mass: the angular part of an impulse denominator. */
export const carAngularTerm = (q: Q4, r: V3, n: V3): number => {
  cross(tmp, r, n);
  qrotInv(tmp, q, tmp);
  tmp.x *= CAR_INV_INERTIA.x;
  tmp.y *= CAR_INV_INERTIA.y;
  tmp.z *= CAR_INV_INERTIA.z;
  qrot(tmp, q, tmp);
  cross(tmp2, tmp, r);
  return dot(n, tmp2);
};

/** Events a step can raise, read by the world. */
export interface CarStepEvents {
  jumped: boolean;
  doubleJumped: boolean;
  dodged: boolean;
  landed: boolean;
  wallHit: number;
}

/**
 * Advance one car by one physics substep.
 *
 * `frozen` holds the car still (kickoff countdown) while the input edge state
 * keeps tracking, so a held jump at "GO" does not fire.
 */
export const stepCar = (c: CarState, inp: CarInput, dt: number, ev: CarStepEvents, frozen: boolean): void => {
  ev.jumped = false;
  ev.doubleJumped = false;
  ev.dodged = false;
  ev.landed = false;
  ev.wallHit = 0;
  if (!c.active || c.demolished) return;
  if (frozen) {
    c.jumpHeld = inp.jump;
    set(c.vel, 0, 0, 0);
    set(c.angVel, 0, 0, 0);
    c.boosting = false;
    return;
  }

  forwardOf(fwd, c.quat);
  leftOf(left, c.quat);
  upOf(up, c.quat);

  const jumpPressed = inp.jump && !c.jumpHeld;
  c.jumpHeld = inp.jump;
  c.bumpCooldown = Math.max(0, c.bumpCooldown - dt);
  c.handbrake = inp.handbrake
    ? Math.min(1, c.handbrake + CAR.powerslideRise * dt)
    : Math.max(0, c.handbrake - CAR.powerslideFall * dt);

  set(acc, 0, 0, GRAVITY);
  set(angAcc, 0, 0, 0);

  // ------------------------------------------------------------ wheels
  let wheels = 0;
  let firm = 0;
  set(nAvg, 0, 0, 0);
  for (let i = 0; i < CAR.wheels.length; i += 1) {
    const w = CAR.wheels[i]!;
    set(tmp, w.x, w.y, w.z);
    qrot(rel, c.quat, tmp);
    set(wp, c.pos.x + rel.x, c.pos.y + rel.y, c.pos.z + rel.z);
    const restLen = CAR.rideHeight + w.z;
    const t = arenaRaycast(wp, -up.x, -up.y, -up.z, restLen + CAR.wheelTravel, hitN);
    if (t < 0) continue;
    wheels += 1;
    if (t <= restLen + 3) firm += 1;
    nAvg.x += hitN.x;
    nAvg.y += hitN.y;
    nAvg.z += hitN.z;
    // Spring + damper along the car's up axis, applied at the wheel.
    const preload = -GRAVITY / 4 / CAR.springK;
    const compression = restLen + preload - t;
    // velocity of the wheel point along up
    cross(tmp, c.angVel, rel);
    const vUp = dot(c.vel, up) + dot(tmp, up);
    let f = CAR.springK * compression - CAR.springC * vUp;
    if (compression <= 0 && f > 0) f = 0;
    if (f < 0) f = 0;
    if (f > 0) {
      acc.x += up.x * f;
      acc.y += up.y * f;
      acc.z += up.z * f;
      // torque per unit mass: r x a, in local frame -> angular accel
      set(tmp, up.x * f, up.y * f, up.z * f);
      cross(tmp2, rel, tmp);
      qrotInv(tmp2, c.quat, tmp2);
      angAcc.x += tmp2.x * CAR_INV_INERTIA.x;
      angAcc.y += tmp2.y * CAR_INV_INERTIA.y;
      angAcc.z += tmp2.z * CAR_INV_INERTIA.z;
    }
  }
  const wasGround = c.onGround;
  c.wheels = wheels;
  // Hysteresis: once driving, any three wheels in reach keep it driving (a ramp lifts the
  // front before the rear, and dropping out of ground mode there would bounce the car off it).
  c.onGround = (firm >= 3 || (wasGround && wheels >= 3)) && !(c.isJumping && c.jumpTime > 0);
  if (c.onGround && !wasGround) ev.landed = true;
  if (wheels > 0) {
    const l = len(nAvg);
    set(nAvg, nAvg.x / l, nAvg.y / l, nAvg.z / l);
  }

  if (c.onGround && !c.isJumping) {
    c.groundTime += dt;
    if (c.groundTime > 1 / 40) {
      c.hasJumped = false;
      c.hasDoubleJumped = false;
      c.hasFlipped = false;
      c.airTimeSinceJump = 0;
    }
    c.onRoof = false;
  } else {
    c.groundTime = 0;
  }

  // ------------------------------------------------------------- boost
  if (inp.boost && c.boost > 0 && !c.boosting) {
    c.boosting = true;
    c.boostTime = 0;
  }
  if (c.boosting) {
    c.boostTime += dt;
    if ((!inp.boost && c.boostTime >= CAR.boostMinTime) || c.boost <= 0) c.boosting = false;
  }
  if (c.boosting) {
    c.boost = Math.max(0, c.boost - CAR.boostPerSecond * dt);
    const a = c.onGround ? CAR.boostAccelGround : CAR.boostAccelAir;
    acc.x += fwd.x * a;
    acc.y += fwd.y * a;
    acc.z += fwd.z * a;
  }

  // ------------------------------------------------------------ driving
  if (wheels > 0) {
    const factor = wheels / 4;
    // surface frame
    const fn = dot(fwd, nAvg);
    set(fwdS, fwd.x - nAvg.x * fn, fwd.y - nAvg.y * fn, fwd.z - nAvg.z * fn);
    const fl = len(fwdS) || 1;
    set(fwdS, fwdS.x / fl, fwdS.y / fl, fwdS.z / fl);
    cross(sideS, nAvg, fwdS); // points left
    const vf = dot(c.vel, fwdS);
    const vs = dot(c.vel, sideS);
    const throttle = c.boosting ? 1 : inp.throttle;

    // longitudinal
    let along = 0;
    if (Math.abs(throttle) > 0.001) {
      if (vf * throttle >= 0 || Math.abs(vf) < 25) {
        along = throttle * CAR.throttleAccel * curve(CAR.driveCurve, Math.abs(vf));
      } else {
        along = -Math.sign(vf) * Math.min(CAR.brakeAccel, Math.abs(vf) / dt);
      }
    } else {
      along = -Math.sign(vf) * Math.min(CAR.coastDecel, Math.abs(vf) / dt);
    }
    // the powerslide drags a little
    if (c.handbrake > 0 && Math.abs(throttle) < 0.001) along -= Math.sign(vf) * Math.min(300 * c.handbrake, Math.abs(vf) / dt);
    acc.x += fwdS.x * along * factor;
    acc.y += fwdS.y * along * factor;
    acc.z += fwdS.z * along * factor;

    // lateral grip
    const grip = CAR.gripAccel + (CAR.slideGripAccel - CAR.gripAccel) * c.handbrake;
    const lat = -clamp(vs / dt, -grip, grip);
    acc.x += sideS.x * lat * factor;
    acc.y += sideS.y * lat * factor;
    acc.z += sideS.z * lat * factor;

    // steering: drive the yaw rate about the surface normal
    const curv = curve(CAR.curvature, Math.abs(vf));
    let target = -inp.steer * curv * vf;
    if (c.handbrake > 0.01) {
      // Sliding, the car is partly sideways: rotation comes from the whole
      // surface speed, not just the forward part, or a drift would stall.
      const vt = Math.sqrt(vf * vf + vs * vs);
      const steerCurv = curve(CAR.curvature, vt);
      const base = Math.abs(steerCurv * vt);
      const bonus = c.handbrake * CAR.slideYawBonus * Math.min(1, vt / 600);
      const dir = Math.abs(vf) > 80 ? Math.sign(vf) : throttle < 0 ? -1 : 1;
      const slideTarget = -inp.steer * dir * Math.min(CAR.slideYawMax, base + bonus);
      target += (slideTarget - target) * c.handbrake;
    }
    const current = dot(c.angVel, nAvg);
    const k = Math.min(1, CAR.yawResponse * dt) * factor;
    const dw = (target - current) * k;
    c.angVel.x += nAvg.x * dw;
    c.angVel.y += nAvg.y * dw;
    c.angVel.z += nAvg.z * dw;

    if (c.onGround && wasGround) {
      // Hug the surface. On a curve (floor -> wall) the ground turns under the
      // car every step; following it with the velocity and the tilt directly,
      // instead of bouncing off it through the springs, is what lets a car
      // carry its speed up the wall the way it does in Rocket League.
      const vn = dot(c.vel, nAvg);
      if (vn < 0) {
        // Only the into-surface speed that the TURNING of the surface explains
        // (the car was moving along the old surface, the new one tilted into
        // it) is kept as speed; a landing, a slam, gravity and the sticky
        // force are absorbed as before.
        const explained = Math.max(0, dot(c.vel, c.gn) - vn);
        const keep = Math.min(-vn, explained);
        c.vel.x -= nAvg.x * vn;
        c.vel.y -= nAvg.y * vn;
        c.vel.z -= nAvg.z * vn;
        if (keep > 0) {
          const after = len(c.vel);
          if (after > 1e-6) {
            const k = Math.sqrt(after * after + keep * keep) / after;
            c.vel.x *= k;
            c.vel.y *= k;
            c.vel.z *= k;
          }
        }
      }
      // tilt: feed forward the surface's own rotation, then close the gap
      cross(tmp2, c.gn, nAvg);
      const ff = 1 / dt;
      cross(tmp, up, nAvg); // axis * sin(angle) taking up onto the surface normal
      const along2 = dot(c.angVel, nAvg);
      const k2 = Math.min(1, CAR.alignResponse * dt);
      const px = c.angVel.x - nAvg.x * along2;
      const py = c.angVel.y - nAvg.y * along2;
      const pz = c.angVel.z - nAvg.z * along2;
      c.angVel.x += (tmp2.x * ff + tmp.x * CAR.alignRate - px) * k2;
      c.angVel.y += (tmp2.y * ff + tmp.y * CAR.alignRate - py) * k2;
      c.angVel.z += (tmp2.z * ff + tmp.z * CAR.alignRate - pz) * k2;
    }
    set(c.gn, nAvg.x, nAvg.y, nAvg.z);

    // sticky force into the surface (off while jumping)
    if (!c.isJumping) {
      let sticky = CAR.sticky;
      if (Math.abs(inp.throttle) < 0.01 && !c.boosting) sticky += 1 - Math.abs(nAvg.z);
      const s = -GRAVITY * sticky * factor;
      acc.x -= nAvg.x * s;
      acc.y -= nAvg.y * s;
      acc.z -= nAvg.z * s;
    }
  }

  // ------------------------------------------------------------- jumping
  if (c.onGround && !c.isJumping && jumpPressed) {
    c.isJumping = true;
    c.jumpTime = 0;
    c.hasJumped = true;
    c.hasDoubleJumped = false;
    c.hasFlipped = false;
    c.airTimeSinceJump = 0;
    c.vel.x += up.x * CAR.jumpImpulse;
    c.vel.y += up.y * CAR.jumpImpulse;
    c.vel.z += up.z * CAR.jumpImpulse;
    c.onGround = false;
    c.groundTime = 0;
    ev.jumped = true;
  } else if (c.isJumping) {
    c.jumpTime += dt;
    if ((inp.jump || c.jumpTime < CAR.jumpMinTime) && c.jumpTime < CAR.jumpMaxTime) {
      acc.x += up.x * CAR.jumpAccel;
      acc.y += up.y * CAR.jumpAccel;
      acc.z += up.z * CAR.jumpAccel;
    } else {
      c.isJumping = false;
    }
  } else if (!c.onGround && jumpPressed) {
    if (c.onRoof && wheels === 0) {
      // turtle: kick it back over
      c.vel.x += up.x * -CAR.autoFlipImpulse;
      c.vel.y += up.y * -CAR.autoFlipImpulse;
      c.vel.z += up.z * -CAR.autoFlipImpulse;
      c.autoFlipTime = CAR.autoFlipTime;
      c.autoFlipDir = left.z > 0 ? 1 : -1;
      c.onRoof = false;
    } else {
      const window = c.hasJumped ? c.airTimeSinceJump < CAR.doubleJumpWindow : true;
      if (window && !c.hasDoubleJumped && !c.hasFlipped) {
        const sx = inp.pitch;
        const sy = inp.yaw + inp.roll;
        if (Math.abs(sx) + Math.abs(sy) >= CAR.dodgeDeadzone) startDodge(c, sx, clamp(sy, -1, 1));
        else {
          c.hasDoubleJumped = true;
          c.vel.x += up.x * CAR.jumpImpulse;
          c.vel.y += up.y * CAR.jumpImpulse;
          c.vel.z += up.z * CAR.jumpImpulse;
          ev.doubleJumped = true;
        }
        if (c.hasFlipped) ev.dodged = true;
      }
    }
  }
  if (c.hasJumped && !c.onGround) c.airTimeSinceJump += dt;

  // ------------------------------------------------------------- air control
  qrotInv(wLocal, c.quat, c.angVel);
  if (c.flipping) {
    c.flipTime += dt;
    if (c.flipTime < CAR.flipTorqueTime) {
      // the flip owns pitch and roll; yaw stays the player's
      wLocal.y = c.flipX * CAR.flipSpin;
      wLocal.x = c.flipY * CAR.flipSpin;
      wLocal.z += (-CAR.airTorque.yaw * inp.yaw - CAR.airDamp.yaw * (1 - Math.abs(inp.yaw)) * wLocal.z) * dt;
    } else {
      c.flipping = false;
    }
    if (c.flipTime < CAR.flipZDampEnd && (c.flipTime < CAR.flipZDampStart || c.vel.z < 0)) {
      c.vel.z *= Math.pow(1 - CAR.flipZDamp, dt * 120);
    }
  } else if (c.autoFlipTime > 0) {
    c.autoFlipTime -= dt;
    wLocal.x = c.autoFlipDir * CAR.autoFlipSpin;
  } else if (!c.onGround) {
    const p = inp.pitch;
    const y = inp.yaw;
    const r = inp.roll;
    wLocal.x += (CAR.airTorque.roll * r - CAR.airDamp.roll * wLocal.x) * dt;
    wLocal.y += (CAR.airTorque.pitch * p - CAR.airDamp.pitch * (1 - Math.abs(p)) * wLocal.y) * dt;
    wLocal.z += (-CAR.airTorque.yaw * y - CAR.airDamp.yaw * (1 - Math.abs(y)) * wLocal.z) * dt;
    if (!c.boosting && Math.abs(inp.throttle) > 0.01 && wheels === 0) {
      acc.x += fwd.x * CAR.airThrottleAccel * inp.throttle;
      acc.y += fwd.y * CAR.airThrottleAccel * inp.throttle;
      acc.z += fwd.z * CAR.airThrottleAccel * inp.throttle;
    }
  }
  // suspension torques
  wLocal.x += angAcc.x * dt;
  wLocal.y += angAcc.y * dt;
  wLocal.z += angAcc.z * dt;
  qrot(c.angVel, c.quat, wLocal);

  // ------------------------------------------------------------- integrate
  c.vel.x += acc.x * dt;
  c.vel.y += acc.y * dt;
  c.vel.z += acc.z * dt;
  const speed = len(c.vel);
  if (speed > CAR.maxSpeed) {
    const s = CAR.maxSpeed / speed;
    c.vel.x *= s;
    c.vel.y *= s;
    c.vel.z *= s;
  }
  const maxW = c.flipping || c.autoFlipTime > 0 ? CAR.flipSpin * 1.02 : c.onGround ? CAR.maxGroundAngSpeed : CAR.maxAngSpeed;
  const w = len(c.angVel);
  if (w > maxW) {
    const s = maxW / w;
    c.angVel.x *= s;
    c.angVel.y *= s;
    c.angVel.z *= s;
  }
  c.pos.x += c.vel.x * dt;
  c.pos.y += c.vel.y * dt;
  c.pos.z += c.vel.z * dt;
  qIntegrate(c.quat, c.angVel, dt);

  const sp = Math.min(speed, CAR.maxSpeed);
  if (sp >= CAR.supersonicStart) c.supersonic = true;
  else if (sp < CAR.supersonicKeep) c.supersonic = false;

  collideHull(c, ev, c.onGround && wasGround);
};

const dodgeFwd = v3();
const startDodge = (c: CarState, sx: number, sy: number): void => {
  const l = Math.sqrt(sx * sx + sy * sy) || 1;
  const dx = sx / l;
  const dy = sy / l;
  forwardOf(dodgeFwd, c.quat);
  const fl = Math.sqrt(dodgeFwd.x * dodgeFwd.x + dodgeFwd.y * dodgeFwd.y);
  let f2x = 1;
  let f2y = 0;
  if (fl > 1e-3) {
    f2x = dodgeFwd.x / fl;
    f2y = dodgeFwd.y / fl;
  }
  // right of forward (z up, right-handed)
  const r2x = f2y;
  const r2y = -f2x;
  const fwdSpeed = c.vel.x * f2x + c.vel.y * f2y;
  const ratio = Math.min(1, Math.abs(fwdSpeed) / CAR.maxSpeed);
  const backwards = Math.abs(fwdSpeed) < 100 ? dx < 0 : dx >= 0 !== fwdSpeed > 0;
  let ix = dx * CAR.flipImpulse;
  let iy = dy * CAR.flipImpulse;
  ix *= ((backwards ? CAR.flipBackScale : 1) - 1) * ratio + 1;
  iy *= (CAR.flipSideScale - 1) * ratio + 1;
  if (backwards) ix *= CAR.flipBackScaleX;
  c.vel.x += f2x * ix + r2x * iy;
  c.vel.y += f2y * ix + r2y * iy;
  c.flipping = true;
  c.flipTime = 0;
  c.hasFlipped = true;
  c.isJumping = false;
  c.flipX = dx;
  c.flipY = dy;
};

// ------------------------------------------------------------------ hull vs world
const hs = v3();
const hn = v3();
const best = v3();
const bestN = v3();
const r = v3();
const vp = v3();
const center = v3();

const collideHull = (c: CarState, ev: CarStepEvents, driving: boolean): void => {
  set(tmp, CAR.offset.x, CAR.offset.y, CAR.offset.z);
  qrot(center, c.quat, tmp);
  center.x += c.pos.x;
  center.y += c.pos.y;
  center.z += c.pos.z;
  if (arenaQuery(center, hn) > HULL_RADIUS) return;

  for (let iter = 0; iter < 3; iter += 1) {
    let deepest = 0;
    for (let i = 0; i < HULL_SAMPLES.length; i += 1) {
      // While driving, the wheels own the ground: the underbody only collides on a landing or a crash.
      if (driving && HULL_SAMPLES[i]!.z < CAR.offset.z - CAR.half.z + 0.01) continue;
      qrot(hs, c.quat, HULL_SAMPLES[i]!);
      hs.x += c.pos.x;
      hs.y += c.pos.y;
      hs.z += c.pos.z;
      const d = arenaQuery(hs, hn);
      if (d < deepest) {
        deepest = d;
        set(best, hs.x, hs.y, hs.z);
        set(bestN, hn.x, hn.y, hn.z);
      }
    }
    if (deepest >= 0) return;
    const pen = -deepest;
    c.pos.x += bestN.x * pen;
    c.pos.y += bestN.y * pen;
    c.pos.z += bestN.z * pen;
    set(r, best.x - c.pos.x, best.y - c.pos.y, best.z - c.pos.z);
    cross(vp, c.angVel, r);
    vp.x += c.vel.x;
    vp.y += c.vel.y;
    vp.z += c.vel.z;
    const vn = dot(vp, bestN);
    upOf(up, c.quat);
    if (dot(up, bestN) < -0.5) c.onRoof = true;
    if (vn >= 0) continue;
    if (-vn > ev.wallHit) ev.wallHit = -vn;
    const denom = 1 + carAngularTerm(c.quat, r, bestN);
    const e = -vn > 200 ? CAR.worldRestitution : 0;
    const jn = (-(1 + e) * vn) / denom;
    // friction
    const tx = vp.x - bestN.x * vn;
    const ty = vp.y - bestN.y * vn;
    const tz = vp.z - bestN.z * vn;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    let jx = bestN.x * jn;
    let jy = bestN.y * jn;
    let jz = bestN.z * jn;
    if (tl > 1e-3) {
      set(tmp, tx / tl, ty / tl, tz / tl);
      const dt2 = 1 + carAngularTerm(c.quat, r, tmp);
      // the underbody scraping a ramp it is driving over must not brake the car
      const mu = dot(up, bestN) > 0.6 && c.wheels >= 2 ? 0 : CAR.worldFriction;
      const jt = Math.min(mu * jn, tl / dt2);
      jx -= tmp.x * jt;
      jy -= tmp.y * jt;
      jz -= tmp.z * jt;
    }
    applyCarImpulse(c, r, jx, jy, jz, 1);
  }
};

/** Place a car resting on the floor at (x, y) facing yaw. */
export const placeCar = (c: CarState, x: number, y: number, yaw: number): void => {
  set(c.pos, x, y, CAR.rideHeight);
  set(c.vel, 0, 0, 0);
  set(c.angVel, 0, 0, 0);
  set(c.gn, 0, 0, 1);
  const h = yaw * 0.5;
  c.quat.x = 0;
  c.quat.y = 0;
  c.quat.z = Math.sin(h);
  c.quat.w = Math.cos(h);
  c.boosting = false;
  c.boostTime = 0;
  c.handbrake = 0;
  c.wheels = 4;
  c.onGround = true;
  c.groundTime = 1;
  c.isJumping = false;
  c.jumpTime = 0;
  c.hasJumped = false;
  c.hasDoubleJumped = false;
  c.hasFlipped = false;
  c.airTimeSinceJump = 0;
  c.flipping = false;
  c.flipTime = 0;
  c.onRoof = false;
  c.autoFlipTime = 0;
  c.supersonic = false;
  c.demolished = false;
  c.respawnTime = 0;
  c.bumpCooldown = 0;
};
