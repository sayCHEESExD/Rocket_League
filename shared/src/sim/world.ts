import { goalSide } from './arena.js';
import { BallState, resetBall, stepBall } from './ball.js';
import { CAR_INV_INERTIA, CarState, HULL_SAMPLES, applyCarImpulse, carAngularTerm, placeCar, stepCar, type CarStepEvents } from './car.js';
import { BALL, CAR, HIT, MAX_CARS, PAD, PADS, PHYS_DT, RESPAWN_SPOTS, SUBSTEPS, TICK_RATE } from './constants.js';
import { emptyInput, type CarInput } from './input.js';
import { cross, curve, dot, forwardOf, leftOf, len, qrot, qrotInv, set, upOf, v3, type V3 } from './math.js';

/** What happened during a tick, for sounds, effects and the match's books. */
export const EventKind = {
  BallHit: 1,
  Bump: 2,
  Demo: 3,
  Pad: 4,
  Jump: 5,
  DoubleJump: 6,
  Dodge: 7,
  BallBounce: 8,
  CarWall: 9,
  Land: 10,
} as const;
export type EventKind = (typeof EventKind)[keyof typeof EventKind];

export interface SimEvent {
  kind: number;
  car: number;
  other: number;
  value: number;
  x: number;
  y: number;
  z: number;
}

const MAX_EVENTS = 64;

const BALL_INV_I = 1 / (0.4 * BALL.mass * BALL.radius * BALL.radius);

/**
 * THE WHOLE SIMULATED PITCH: cars, ball, boost pads.
 *
 * Stepped by the server (authoritative) and by every client (prediction), so
 * it is deterministic given the same state and inputs and holds no references
 * to anything outside itself. `copyFrom` is how a client rewinds to a snapshot.
 */
export class World {
  readonly cars: CarState[] = Array.from({ length: MAX_CARS }, () => new CarState());
  readonly ball = new BallState();
  /** Ticks until each pad is back (0 = available). */
  readonly pads = new Int32Array(PADS.length);
  tick = 0;
  /** Physics substep counter (the hit model needs per-step gaps). */
  step = 0;
  carsFrozen = false;
  ballFrozen = false;
  /** Set when the ball crossed a line this tick: +1 the +Y goal, -1 the -Y goal. */
  goal = 0;

  readonly events: SimEvent[] = Array.from({ length: MAX_EVENTS }, () => ({ kind: 0, car: 0, other: 0, value: 0, x: 0, y: 0, z: 0 }));
  eventCount = 0;

  private readonly carEv: CarStepEvents = { jumped: false, doubleJumped: false, dodged: false, landed: false, wallHit: 0 };
  private readonly idle = emptyInput();

  copyFrom(o: World): void {
    for (let i = 0; i < MAX_CARS; i += 1) this.cars[i]!.copyFrom(o.cars[i]!);
    this.ball.copyFrom(o.ball);
    this.pads.set(o.pads);
    this.tick = o.tick;
    this.step = o.step;
    this.carsFrozen = o.carsFrozen;
    this.ballFrozen = o.ballFrozen;
    this.goal = o.goal;
  }

  emit(kind: number, car: number, other: number, value: number, p: V3): void {
    if (this.eventCount >= MAX_EVENTS) return;
    const e = this.events[this.eventCount]!;
    this.eventCount += 1;
    e.kind = kind;
    e.car = car;
    e.other = other;
    e.value = value;
    e.x = p.x;
    e.y = p.y;
    e.z = p.z;
  }

  /** Advance one tick. `inputs[i]` drives car i (missing = idle). */
  advance(inputs: readonly (CarInput | undefined)[]): void {
    this.eventCount = 0;
    this.goal = 0;
    for (let s = 0; s < SUBSTEPS; s += 1) this.substep(inputs, PHYS_DT);
    this.tick += 1;
    // pads and respawns on the tick
    for (let i = 0; i < this.pads.length; i += 1) {
      if (this.pads[i]! > 0) this.pads[i] = this.pads[i]! - 1;
    }
    if (!this.carsFrozen) this.pickupPads();
    for (let i = 0; i < MAX_CARS; i += 1) {
      const c = this.cars[i]!;
      if (!c.active || !c.demolished) continue;
      c.respawnTime -= 1;
      if (c.respawnTime <= 0) this.respawn(i);
    }
  }

  private substep(inputs: readonly (CarInput | undefined)[], dt: number): void {
    this.step += 1;
    const ev = this.carEv;
    for (let i = 0; i < MAX_CARS; i += 1) {
      const c = this.cars[i]!;
      if (!c.active) continue;
      stepCar(c, inputs[i] ?? this.idle, dt, ev, this.carsFrozen);
      if (ev.jumped) this.emit(EventKind.Jump, i, -1, 0, c.pos);
      if (ev.doubleJumped) this.emit(EventKind.DoubleJump, i, -1, 0, c.pos);
      if (ev.dodged) this.emit(EventKind.Dodge, i, -1, 0, c.pos);
      if (ev.landed) this.emit(EventKind.Land, i, -1, 0, c.pos);
      if (ev.wallHit > 400) this.emit(EventKind.CarWall, i, -1, ev.wallHit, c.pos);
    }
    if (!this.ballFrozen) {
      const bounce = stepBall(this.ball, dt);
      if (bounce > 250) this.emit(EventKind.BallBounce, -1, -1, bounce, this.ball.pos);
    }
    this.collideCars();
    if (!this.ballFrozen) {
      for (let i = 0; i < MAX_CARS; i += 1) {
        const c = this.cars[i]!;
        if (c.active && !c.demolished) this.collideCarBall(i, c);
      }
      if (this.goal === 0) this.goal = goalSide(this.ball.pos, BALL.radius);
    }
  }

  // ------------------------------------------------------------- car vs ball
  private readonly local = v3();
  private readonly nrm = v3();
  private readonly cp = v3();
  private readonly rc = v3();
  private readonly rb = v3();
  private readonly vrel = v3();
  private readonly t1 = v3();
  private readonly t2 = v3();
  private readonly fwd = v3();

  private collideCarBall(i: number, c: CarState): void {
    const b = this.ball;
    const L = this.local;
    set(this.t1, b.pos.x - c.pos.x, b.pos.y - c.pos.y, b.pos.z - c.pos.z);
    if (this.t1.x * this.t1.x + this.t1.y * this.t1.y + this.t1.z * this.t1.z > 260 * 260) return;
    qrotInv(L, c.quat, this.t1);
    L.x -= CAR.offset.x;
    L.y -= CAR.offset.y;
    L.z -= CAR.offset.z;
    const hx = CAR.half.x;
    const hy = CAR.half.y;
    const hz = CAR.half.z;
    const qx = L.x < -hx ? -hx : L.x > hx ? hx : L.x;
    const qy = L.y < -hy ? -hy : L.y > hy ? hy : L.y;
    const qz = L.z < -hz ? -hz : L.z > hz ? hz : L.z;
    let dx = L.x - qx;
    let dy = L.y - qy;
    let dz = L.z - qz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= BALL.radius) return;
    let pen: number;
    let cx = qx;
    let cy = qy;
    let cz = qz;
    if (d > 1e-6) {
      dx /= d;
      dy /= d;
      dz /= d;
      pen = BALL.radius - d;
    } else {
      // centre inside the box: out through the nearest face
      const px = hx - Math.abs(L.x);
      const py = hy - Math.abs(L.y);
      const pz = hz - Math.abs(L.z);
      dx = 0;
      dy = 0;
      dz = 0;
      if (px <= py && px <= pz) {
        dx = Math.sign(L.x) || 1;
        cx = dx * hx;
        pen = BALL.radius + px;
      } else if (py <= pz) {
        dy = Math.sign(L.y) || 1;
        cy = dy * hy;
        pen = BALL.radius + py;
      } else {
        dz = Math.sign(L.z) || 1;
        cz = dz * hz;
        pen = BALL.radius + pz;
      }
    }
    // to world
    set(this.t1, dx, dy, dz);
    qrot(this.nrm, c.quat, this.t1);
    const n = this.nrm;
    set(this.t1, cx + CAR.offset.x, cy + CAR.offset.y, cz + CAR.offset.z);
    qrot(this.rc, c.quat, this.t1);
    set(this.cp, c.pos.x + this.rc.x, c.pos.y + this.rc.y, c.pos.z + this.rc.z);

    // Psyonix's extra impulse, from the velocities BEFORE the contact resolves
    const relVx = b.vel.x - c.vel.x;
    const relVy = b.vel.y - c.vel.y;
    const relVz = b.vel.z - c.vel.z;
    const relSpeed = Math.min(Math.sqrt(relVx * relVx + relVy * relVy + relVz * relVz), HIT.maxDeltaVel);
    const fresh = c.lastBallHit < this.step - 1;

    // separate (the ball is six times lighter, so it moves most)
    const mc = CAR.mass;
    const mb = BALL.mass;
    const share = mc / (mc + mb);
    b.pos.x += n.x * pen * share;
    b.pos.y += n.y * pen * share;
    b.pos.z += n.z * pen * share;
    c.pos.x -= n.x * pen * (1 - share);
    c.pos.y -= n.y * pen * (1 - share);
    c.pos.z -= n.z * pen * (1 - share);

    // the physical contact (restitution 0, high friction)
    set(this.rb, this.cp.x - b.pos.x, this.cp.y - b.pos.y, this.cp.z - b.pos.z);
    cross(this.t1, b.angVel, this.rb);
    cross(this.t2, c.angVel, this.rc);
    set(
      this.vrel,
      b.vel.x + this.t1.x - c.vel.x - this.t2.x,
      b.vel.y + this.t1.y - c.vel.y - this.t2.y,
      b.vel.z + this.t1.z - c.vel.z - this.t2.z,
    );
    const vn = dot(this.vrel, n);
    if (vn < 0) {
      const invMb = 1 / mb;
      const invMc = 1 / mc;
      cross(this.t1, this.rb, n);
      const angB = dot(this.t1, this.t1) * BALL_INV_I;
      const angC = carAngularTerm(c.quat, this.rc, n) / mc;
      const jn = (-(1 + HIT.restitution) * vn) / (invMb + invMc + angB + angC);
      let jx = n.x * jn;
      let jy = n.y * jn;
      let jz = n.z * jn;
      const tx = this.vrel.x - n.x * vn;
      const ty = this.vrel.y - n.y * vn;
      const tz = this.vrel.z - n.z * vn;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-3) {
        set(this.t2, tx / tl, ty / tl, tz / tl);
        cross(this.t1, this.rb, this.t2);
        const angBt = dot(this.t1, this.t1) * BALL_INV_I;
        const angCt = carAngularTerm(c.quat, this.rc, this.t2) / mc;
        const jt = Math.min(HIT.friction * jn, tl / (invMb + invMc + angBt + angCt));
        jx -= this.t2.x * jt;
        jy -= this.t2.y * jt;
        jz -= this.t2.z * jt;
      }
      b.vel.x += jx * invMb;
      b.vel.y += jy * invMb;
      b.vel.z += jz * invMb;
      set(this.t2, jx, jy, jz);
      cross(this.t1, this.rb, this.t2);
      b.angVel.x += this.t1.x * BALL_INV_I;
      b.angVel.y += this.t1.y * BALL_INV_I;
      b.angVel.z += this.t1.z * BALL_INV_I;
      applyCarImpulse(c, this.rc, -jx, -jy, -jz, invMc);
    }

    if (fresh && relSpeed > 0) {
      let hx2 = b.pos.x - c.pos.x;
      let hy2 = b.pos.y - c.pos.y;
      let hz2 = (b.pos.z - c.pos.z) * HIT.zScale;
      let hl = Math.sqrt(hx2 * hx2 + hy2 * hy2 + hz2 * hz2) || 1;
      hx2 /= hl;
      hy2 /= hl;
      hz2 /= hl;
      forwardOf(this.fwd, c.quat);
      const f = (hx2 * this.fwd.x + hy2 * this.fwd.y + hz2 * this.fwd.z) * (1 - HIT.forwardScale);
      hx2 -= this.fwd.x * f;
      hy2 -= this.fwd.y * f;
      hz2 -= this.fwd.z * f;
      hl = Math.sqrt(hx2 * hx2 + hy2 * hy2 + hz2 * hz2) || 1;
      const k = (relSpeed * curve(HIT.factor, relSpeed)) / hl;
      b.vel.x += hx2 * k;
      b.vel.y += hy2 * k;
      b.vel.z += hz2 * k;
      const sp = len(b.vel);
      if (sp > BALL.maxSpeed) {
        const s = BALL.maxSpeed / sp;
        b.vel.x *= s;
        b.vel.y *= s;
        b.vel.z *= s;
      }
      if (b.lastTouch !== i) b.prevTouch = b.lastTouch;
      b.lastTouch = i;
      b.lastTouchTeam = c.team;
      this.emit(EventKind.BallHit, i, -1, relSpeed, this.cp);
    }
    c.lastBallHit = this.step;
  }

  // ------------------------------------------------------------- car vs car
  private readonly sp = v3();
  private readonly sl = v3();
  private readonly bestP = v3();
  private readonly bestN = v3();
  private readonly ra = v3();
  private readonly rb2 = v3();

  private collideCars(): void {
    for (let i = 0; i < MAX_CARS; i += 1) {
      const a = this.cars[i]!;
      if (!a.active || a.demolished) continue;
      for (let j = i + 1; j < MAX_CARS; j += 1) {
        const b = this.cars[j]!;
        if (!b.active || b.demolished) continue;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dz = b.pos.z - a.pos.z;
        if (dx * dx + dy * dy + dz * dz > 170 * 170) continue;
        this.collidePair(i, a, j, b);
      }
    }
  }

  /** Deepest of `other`'s hull samples inside `box`'s hitbox: depth (>0) with point/normal (normal pushes `other` out). */
  private deepestIn(box: CarState, other: CarState): number {
    let deepest = 0;
    for (let k = 0; k < HULL_SAMPLES.length; k += 1) {
      qrot(this.sp, other.quat, HULL_SAMPLES[k]!);
      this.sp.x += other.pos.x - box.pos.x;
      this.sp.y += other.pos.y - box.pos.y;
      this.sp.z += other.pos.z - box.pos.z;
      qrotInv(this.sl, box.quat, this.sp);
      const lx = this.sl.x - CAR.offset.x;
      const ly = this.sl.y - CAR.offset.y;
      const lz = this.sl.z - CAR.offset.z;
      const px = CAR.half.x - Math.abs(lx);
      const py = CAR.half.y - Math.abs(ly);
      const pz = CAR.half.z - Math.abs(lz);
      if (px <= 0 || py <= 0 || pz <= 0) continue;
      const m = Math.min(px, py, pz);
      if (m <= deepest) continue;
      deepest = m;
      if (m === px) set(this.t1, Math.sign(lx) || 1, 0, 0);
      else if (m === py) set(this.t1, 0, Math.sign(ly) || 1, 0);
      else set(this.t1, 0, 0, Math.sign(lz) || 1);
      qrot(this.bestN, box.quat, this.t1);
      set(this.bestP, this.sp.x + box.pos.x, this.sp.y + box.pos.y, this.sp.z + box.pos.z);
    }
    return deepest;
  }

  private collidePair(i: number, a: CarState, j: number, b: CarState): void {
    // Centres almost on top of each other (a spawn on a spawn): no hull sample is
    // strictly inside the other box, so separate them sideways explicitly.
    const cdx = b.pos.x - a.pos.x;
    const cdy = b.pos.y - a.pos.y;
    const cdz = b.pos.z - a.pos.z;
    if (cdx * cdx + cdy * cdy + cdz * cdz < 40 * 40) {
      let nx = cdx;
      let ny = cdy;
      let l = Math.sqrt(nx * nx + ny * ny);
      if (l < 1e-3) {
        leftOf(this.t1, a.quat);
        nx = this.t1.x;
        ny = this.t1.y;
        l = Math.sqrt(nx * nx + ny * ny) || 1;
      }
      const push = (2 * CAR.half.y + 4 - l) * 0.5;
      a.pos.x -= (nx / l) * push;
      a.pos.y -= (ny / l) * push;
      b.pos.x += (nx / l) * push;
      b.pos.y += (ny / l) * push;
      return;
    }
    // b's points in a's box (normal pushes b away from a), or a's in b's (flip it)
    let pen = this.deepestIn(a, b);
    let flip = false;
    const pen2 = this.deepestIn(b, a);
    if (pen2 > pen) {
      pen = pen2;
      flip = true;
    } else if (pen > 0) {
      // recompute a-in-b was last; restore a's result
      this.deepestIn(a, b);
    }
    if (pen <= 0) return;
    // n: from a towards b
    const n = this.nrm;
    if (flip) set(n, -this.bestN.x, -this.bestN.y, -this.bestN.z);
    else set(n, this.bestN.x, this.bestN.y, this.bestN.z);
    a.pos.x -= n.x * pen * 0.5;
    a.pos.y -= n.y * pen * 0.5;
    a.pos.z -= n.z * pen * 0.5;
    b.pos.x += n.x * pen * 0.5;
    b.pos.y += n.y * pen * 0.5;
    b.pos.z += n.z * pen * 0.5;

    // bumps and demolitions: whoever is driving into the other with their front
    if (this.tryBump(i, a, j, b, n, 1)) return;
    if (this.tryBump(j, b, i, a, n, -1)) return;

    // plain contact
    set(this.ra, this.bestP.x - a.pos.x, this.bestP.y - a.pos.y, this.bestP.z - a.pos.z);
    set(this.rb2, this.bestP.x - b.pos.x, this.bestP.y - b.pos.y, this.bestP.z - b.pos.z);
    cross(this.t1, b.angVel, this.rb2);
    cross(this.t2, a.angVel, this.ra);
    const vn =
      (b.vel.x + this.t1.x - a.vel.x - this.t2.x) * n.x +
      (b.vel.y + this.t1.y - a.vel.y - this.t2.y) * n.y +
      (b.vel.z + this.t1.z - a.vel.z - this.t2.z) * n.z;
    if (vn >= 0) return;
    const inv = 1 / CAR.mass;
    const denom = 2 * inv + carAngularTerm(a.quat, this.ra, n) * inv + carAngularTerm(b.quat, this.rb2, n) * inv;
    const jn = (-(1 + CAR.carCarRestitution) * vn) / denom;
    applyCarImpulse(b, this.rb2, n.x * jn, n.y * jn, n.z * jn, inv);
    applyCarImpulse(a, this.ra, -n.x * jn, -n.y * jn, -n.z * jn, inv);
  }

  private readonly up = v3();

  /** `atk` hits `vic`; `sign` orients n (a->b) to point from atk to vic. */
  private tryBump(ai: number, atk: CarState, vi: number, vic: CarState, n: V3, sign: number): boolean {
    if (atk.bumpCooldown > 0) return false;
    const nx = n.x * sign;
    const ny = n.y * sign;
    const nz = n.z * sign;
    const toward = atk.vel.x * nx + atk.vel.y * ny + atk.vel.z * nz;
    const away = vic.vel.x * nx + vic.vel.y * ny + vic.vel.z * nz;
    if (toward <= away || toward < 300) return false;
    // contact must be on the attacker's front bumper
    set(this.t1, this.bestP.x - atk.pos.x, this.bestP.y - atk.pos.y, this.bestP.z - atk.pos.z);
    qrotInv(this.sl, atk.quat, this.t1);
    if (this.sl.x < CAR.offset.x + CAR.half.x * 0.55) return false;
    atk.bumpCooldown = CAR.bumpCooldown;
    if (atk.supersonic && atk.team !== vic.team) {
      vic.demolished = true;
      vic.respawnTime = Math.round(CAR.demoRespawn * TICK_RATE);
      vic.boosting = false;
      this.emit(EventKind.Demo, ai, vi, toward, vic.pos);
      return true;
    }
    forwardOf(this.fwd, atk.quat);
    const scale = curve(vic.onGround ? CAR.bumpGround : CAR.bumpAir, toward);
    if (vic.onGround) upOf(this.up, vic.quat);
    else set(this.up, 0, 0, 1);
    const upAmt = CAR.bumpUp * Math.min(1, toward / 1400);
    vic.vel.x += this.fwd.x * scale + this.up.x * upAmt;
    vic.vel.y += this.fwd.y * scale + this.up.y * upAmt;
    vic.vel.z += this.fwd.z * scale + this.up.z * upAmt;
    // the attacker loses a little
    atk.vel.x *= 0.85;
    atk.vel.y *= 0.85;
    atk.vel.z *= 0.85;
    this.emit(EventKind.Bump, ai, vi, toward, this.bestP);
    return true;
  }

  // ------------------------------------------------------------- pads / respawn
  private pickupPads(): void {
    for (let i = 0; i < MAX_CARS; i += 1) {
      const c = this.cars[i]!;
      if (!c.active || c.demolished || c.boost >= CAR.boostMax || c.pos.z > PAD.height) continue;
      for (let p = 0; p < PADS.length; p += 1) {
        if (this.pads[p]! > 0) continue;
        const pad = PADS[p]!;
        const r = pad[2] ? PAD.bigRadius : PAD.smallRadius;
        const dx = c.pos.x - pad[0];
        const dy = c.pos.y - pad[1];
        if (dx * dx + dy * dy > r * r) continue;
        c.boost = Math.min(CAR.boostMax, c.boost + (pad[2] ? PAD.bigAmount : PAD.smallAmount));
        this.pads[p] = Math.round((pad[2] ? PAD.bigRespawn : PAD.smallRespawn) * TICK_RATE);
        set(this.t1, pad[0], pad[1], 0);
        this.emit(EventKind.Pad, i, p, pad[2] ? 1 : 0, this.t1);
      }
    }
  }

  respawn(i: number): void {
    const c = this.cars[i]!;
    const s = c.team === 0 ? 1 : -1;
    // the first free respawn spot (deterministic: same choice on every machine)
    let spot = RESPAWN_SPOTS[i % RESPAWN_SPOTS.length]!;
    for (let k = 0; k < RESPAWN_SPOTS.length; k += 1) {
      const cand = RESPAWN_SPOTS[(i + k) % RESPAWN_SPOTS.length]!;
      let free = true;
      for (let j = 0; j < MAX_CARS && free; j += 1) {
        const o = this.cars[j]!;
        if (j === i || !o.active || o.demolished) continue;
        if (Math.hypot(o.pos.x - cand[0] * s, o.pos.y - cand[1] * s) < 220) free = false;
      }
      if (free) {
        spot = cand;
        break;
      }
    }
    placeCar(c, spot[0] * s, spot[1] * s, c.team === 0 ? spot[2] : spot[2] + Math.PI);
    c.boost = CAR.kickoffBoost;
  }

  resetBall(): void {
    resetBall(this.ball);
  }

  /** Everything not an engine detail (for the kickoff). */
  resetPads(): void {
    this.pads.fill(0);
  }

  /** Inverse inertia constants, exported for tests. */
  static readonly carInvInertia = CAR_INV_INERTIA;
}
