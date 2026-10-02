import {
  ARENA,
  BallState,
  MAX_CARS,
  PHYS_DT,
  stepBall,
  forwardOf,
  leftOf,
  upOf,
  v3,
  type CarInput,
  type CarState,
  type World,
} from '@rlb/shared';

const fwd = v3();
const left = v3();
const up = v3();

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Where the ball will be over the next few seconds (shared by every bot, rebuilt every few ticks). */
const PATH_STEP = 1 / 30;
const PATH_N = 90;
const path = new Float32Array(PATH_N * 3);
let pathTick = -1;
let pathWorld: World | null = null;
const ghost = new BallState();
const buildPath = (w: World): void => {
  if (pathWorld === w && w.tick - pathTick < 3 && w.tick >= pathTick) return;
  pathWorld = w;
  pathTick = w.tick;
  ghost.copyFrom(w.ball);
  const sub = Math.round(PATH_STEP / PHYS_DT);
  for (let i = 0; i < PATH_N; i += 1) {
    for (let k = 0; k < sub; k += 1) stepBall(ghost, PHYS_DT);
    path[i * 3] = ghost.pos.x;
    path[i * 3 + 1] = ghost.pos.y;
    path[i * 3 + 2] = ghost.pos.z;
  }
};

/** Angle (radians, + = left) from the car's heading to a point, on the floor plane. */
const angleTo = (c: CarState, x: number, y: number): number => {
  forwardOf(fwd, c.quat);
  const dx = x - c.pos.x;
  const dy = y - c.pos.y;
  const fx = fwd.x;
  const fy = fwd.y;
  return Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy);
};

/**
 * A simple Rocket League bot. It plays by the same rules as a human - it only
 * ever produces a `CarInput` - so the server never moves a bot's car directly.
 *
 * Roles by time-to-ball: the quickest teammate attacks (lines up behind the
 * ball on the goal line and drives through it, flipping into it when close),
 * the next supports, the rest defend the goal. Kickoffs are boost + flip.
 */
export class BotBrain {
  private stuck = 0;
  private reverse = 0;
  private flipStage = 0;
  private flipTimer = 0;
  /** Dodge direction (car-local stick): forward, right. */
  private flipFwd = 1;
  private flipSide = 0;
  private wobble = (Math.random() - 0.5) * 0.2;
  private readonly skill = 0.75 + Math.random() * 0.25;

  /** Dev: hold still. */
  frozen = false;

  think(w: World, slot: number, kickoff: boolean, o: CarInput): void {
    const c = w.cars[slot]!;
    o.throttle = 0;
    o.steer = 0;
    o.pitch = 0;
    o.yaw = 0;
    o.roll = 0;
    o.jump = false;
    o.boost = false;
    o.handbrake = false;
    if (!c.active || c.demolished || this.frozen) return;

    const b = w.ball;
    const team = c.team;
    const attackY = team === 0 ? ARENA.halfY : -ARENA.halfY;
    const ownY = -attackY;
    const speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);

    // ---- flip in progress
    if (this.flipStage > 0) {
      this.flipTimer += 1;
      if (this.flipStage === 1) {
        o.jump = this.flipTimer < 5;
        if (this.flipTimer >= 7) {
          this.flipStage = 2;
          this.flipTimer = 0;
        }
      } else if (this.flipStage === 2) {
        o.jump = true;
        o.pitch = this.flipFwd;
        o.yaw = this.flipSide;
        this.flipStage = 3;
      } else {
        o.pitch = this.flipFwd;
        o.yaw = this.flipSide;
        o.throttle = 1;
        if (this.flipTimer > 50 || c.onGround) this.flipStage = 0;
      }
      return;
    }

    // ---- in the air: land on the wheels
    if (!c.onGround) {
      upOf(up, c.quat);
      forwardOf(fwd, c.quat);
      leftOf(left, c.quat);
      // pitch: nose level; roll: left side level
      o.pitch = clamp(fwd.z * 2.2, -1, 1);
      o.roll = clamp(left.z * 2.2, -1, 1);
      if (up.z < 0) o.roll = left.z >= 0 ? 1 : -1;
      o.throttle = 1;
      const a = angleTo(c, b.pos.x, b.pos.y);
      o.yaw = clamp(-a * 1.5, -1, 1);
      return;
    }

    // ---- roles
    const eta = (car: CarState): number => {
      const d = Math.hypot(b.pos.x - car.pos.x, b.pos.y - car.pos.y);
      const turn = Math.abs(angleTo(car, b.pos.x, b.pos.y));
      // being goal-side of the ball is worth a lot
      const goalSide = (car.pos.y - b.pos.y) * Math.sign(ownY) > 0 ? 0 : 0.8;
      return d / Math.max(900, Math.hypot(car.vel.x, car.vel.y)) + turn * 0.35 + goalSide;
    };
    const mine = eta(c);
    let rank = 0;
    for (let i = 0; i < MAX_CARS; i += 1) {
      if (i === slot) continue;
      const other = w.cars[i]!;
      if (!other.active || other.demolished || other.team !== team) continue;
      const e = eta(other);
      if (e < mine || (e === mine && i < slot)) rank += 1;
    }

    let tx: number;
    let ty: number;
    let wantBoost = false;
    const bx = b.pos.x;
    const by = b.pos.y;
    const dBall = Math.hypot(bx - c.pos.x, by - c.pos.y);

    if (kickoff) {
      if (rank === 0) {
        tx = bx;
        ty = by - Math.sign(attackY) * 40;
        wantBoost = true;
        if (dBall < 720 && speed > 1100 && Math.abs(angleTo(c, bx, by)) < 0.2) {
          this.flipStage = 1;
          this.flipTimer = 0;
          this.flipFwd = 1;
          this.flipSide = 0;
        }
      } else {
        tx = (rank % 2 === 0 ? -1 : 1) * 600;
        ty = ownY * 0.75;
        wantBoost = rank === 1;
      }
    } else if (rank === 0) {
      // ATTACK: find the earliest point on the ball's path we can reach while it is
      // low enough to hit, and arrive there from behind, on the line to their goal.
      buildPath(w);
      const reach = Math.max(1100, speed) * (0.85 + 0.15 * this.skill) + (c.boost > 20 ? 250 : 0);
      let k = PATH_N - 1;
      for (let i = 0; i < PATH_N; i += 1) {
        const px = path[i * 3]!;
        const py = path[i * 3 + 1]!;
        const pz = path[i * 3 + 2]!;
        const t = (i + 1) * PATH_STEP;
        const d = Math.hypot(px - c.pos.x, py - c.pos.y) - 120;
        if (pz < 260 && d / reach <= t + 0.05) {
          k = i;
          break;
        }
      }
      const ix = path[k * 3]!;
      const iy = path[k * 3 + 1]!;

      let gx = clamp(-ix, -ARENA.goal.halfWidth * 0.6, ARENA.goal.halfWidth * 0.6) - ix;
      let gy = attackY - iy;
      const gl = Math.hypot(gx, gy) || 1;
      gx /= gl;
      gy /= gl;
      const dI = Math.hypot(ix - c.pos.x, iy - c.pos.y);
      const behind = (c.pos.x - ix) * gx + (c.pos.y - iy) * gy;
      const offset = clamp(dI * 0.4, 0, 600);
      tx = ix - gx * offset;
      ty = iy - gy * offset;
      if (behind > 120) {
        // wrong side of the ball: loop round it, goal-side first
        const side = (c.pos.x - ix) * -gy + (c.pos.y - iy) * gx >= 0 ? 1 : -1;
        tx = ix - gx * 750 + -gy * side * 600;
        ty = iy - gy * 750 + gx * side * 600;
      }
      wantBoost = (dI > 800 && behind < 0) || (dI > 2500);
      // shoot: dodge into the ball when it is right there
      const db3 = Math.hypot(bx - c.pos.x, by - c.pos.y, (b.pos.z - c.pos.z) * 1.4);
      const ab = angleTo(c, bx, by);
      if (db3 < 300 * this.skill + 60 && b.pos.z < 230 && Math.abs(ab) < 0.7 && speed > 500 && behind < 60) {
        this.flipStage = 1;
        this.flipTimer = 0;
        this.flipFwd = clamp(Math.cos(ab) * 1.4, -1, 1);
        this.flipSide = clamp(-Math.sin(ab) * 1.6, -1, 1);
      }
      // pop a jump at a ball just overhead
      if (db3 < 330 && b.pos.z > 230 && b.pos.z < 480 && Math.abs(ab) < 0.5) o.jump = true;
    } else if (rank === 1) {
      // second man: shadow the play from goal-side, ready for the next touch
      tx = bx * 0.6;
      ty = by + (ownY - by) * 0.4;
      wantBoost = Math.hypot(tx - c.pos.x, ty - c.pos.y) > 2200;
    } else {
      tx = clamp(bx * 0.25, -700, 700);
      ty = ownY * 0.88;
      wantBoost = Math.hypot(tx - c.pos.x, ty - c.pos.y) > 3000;
    }

    tx = clamp(tx, -ARENA.halfX + 250, ARENA.halfX - 250);
    ty = clamp(ty, -ARENA.halfY + 150, ARENA.halfY - 150);

    const a = angleTo(c, tx, ty) + this.wobble * 0.3;
    const dist = Math.hypot(tx - c.pos.x, ty - c.pos.y);

    // ---- unstick
    if (this.reverse > 0) {
      this.reverse -= 1;
      o.throttle = -1;
      o.steer = clamp(a * 3, -1, 1);
      return;
    }
    if (speed < 120) this.stuck += 1;
    else this.stuck = 0;
    if (this.stuck > 90) {
      this.stuck = 0;
      this.reverse = 40;
    }

    o.steer = clamp(-a * 3.2, -1, 1);
    o.throttle = dist < 120 && rank > 0 ? 0 : 1;
    if (Math.abs(a) > 1.5 && speed > 550) o.handbrake = true;
    if (wantBoost && Math.abs(a) < 0.3 && speed < 2250 && c.boost > 0 && (kickoff || c.boost > 8)) o.boost = true;
    // occasionally drift the wobble so bots don't drive in perfect lines
    if (Math.random() < 0.01) this.wobble = (Math.random() - 0.5) * 0.25;
  }

  reset(): void {
    this.flipStage = 0;
    this.flipTimer = 0;
    this.reverse = 0;
    this.stuck = 0;
  }
}
