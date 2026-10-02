import { ARENA, MAX_CARS, TICK_RATE, type World } from '@rlb/shared';
import { Vector3 } from 'three';

const KEEP = 300; // snapshots (10 s at 30 Hz)

interface Frame {
  tick: number;
  ball: Float32Array; // x y z
  cars: Float32Array; // per car: active, demolished, team, boosting, supersonic, x y z, qx qy qz qw, speed
}
const CAR_F = 13;

/**
 * GOAL REPLAYS from the server's own snapshots - so the replay shows what
 * really happened, not what this client predicted - interpolated to the
 * frame rate, the last stretch in slow motion, with a two-shot director: a
 * camera chasing the ball, then a low goal-line camera for the finish.
 */
export class Replay {
  private readonly frames: Frame[] = [];
  private head = 0;
  private count = 0;
  active = false;
  private goalTick = 0;
  private side = 1;
  private t = 0;
  /** Game-time window played. */
  private readonly before = 3.3;
  private readonly after = 0.45;
  private readonly slowFrom = 1.25;
  private readonly slow = 0.55;
  readonly ballPos = new Vector3();
  private readonly chase = new Vector3();
  private chaseInit = false;
  /** Fired once when the replay reaches the goal tick. */
  exploded = false;

  constructor() {
    for (let i = 0; i < KEEP; i += 1) this.frames.push({ tick: -1, ball: new Float32Array(3), cars: new Float32Array(MAX_CARS * CAR_F) });
  }

  record(w: World): void {
    const f = this.frames[this.head]!;
    this.head = (this.head + 1) % KEEP;
    this.count = Math.min(KEEP, this.count + 1);
    f.tick = w.tick;
    f.ball[0] = w.ball.pos.x;
    f.ball[1] = w.ball.pos.y;
    f.ball[2] = w.ball.pos.z;
    for (let i = 0; i < MAX_CARS; i += 1) {
      const c = w.cars[i]!;
      const o = i * CAR_F;
      f.cars[o] = c.active ? 1 : 0;
      f.cars[o + 1] = c.demolished ? 1 : 0;
      f.cars[o + 2] = c.team;
      f.cars[o + 3] = c.boosting ? 1 : 0;
      f.cars[o + 4] = c.supersonic ? 1 : 0;
      f.cars[o + 5] = c.pos.x;
      f.cars[o + 6] = c.pos.y;
      f.cars[o + 7] = c.pos.z;
      f.cars[o + 8] = c.quat.x;
      f.cars[o + 9] = c.quat.y;
      f.cars[o + 10] = c.quat.z;
      f.cars[o + 11] = c.quat.w;
      f.cars[o + 12] = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    }
  }

  start(goalTick: number, side: number): void {
    this.goalTick = goalTick;
    this.side = side;
    this.t = 0;
    this.active = true;
    this.exploded = false;
    this.chaseInit = false;
  }

  stop(): void {
    this.active = false;
  }

  /** Current replay time in game seconds relative to the goal. */
  private gameTime(): number {
    const fast = this.before - this.slowFrom;
    if (this.t < fast) return -this.before + this.t;
    return -this.slowFrom + (this.t - fast) * this.slow;
  }

  advance(dt: number): void {
    this.t += dt;
    if (this.gameTime() > this.after) this.active = false;
  }

  get slowMotion(): boolean {
    return this.t >= this.before - this.slowFrom;
  }

  /** Sample at the current replay time. Writes interpolated car poses into `cars` and returns false if no data. */
  sample(cars: Float32Array, ball: Vector3): boolean {
    const tick = this.goalTick + this.gameTime() * TICK_RATE;
    let a: Frame | null = null;
    let b: Frame | null = null;
    for (let k = 0; k < this.count; k += 1) {
      const f = this.frames[(this.head - 1 - k + KEEP * 2) % KEEP]!;
      if (f.tick < 0) continue;
      if (f.tick >= tick) b = f;
      else {
        a = f;
        break;
      }
    }
    if (!a && !b) return false;
    a ??= b!;
    b ??= a;
    const span = b.tick - a.tick;
    const u = span > 0 ? (tick - a.tick) / span : 0;
    ball.set(a.ball[0]! + (b.ball[0]! - a.ball[0]!) * u, a.ball[1]! + (b.ball[1]! - a.ball[1]!) * u, a.ball[2]! + (b.ball[2]! - a.ball[2]!) * u);
    for (let i = 0; i < MAX_CARS; i += 1) {
      const o = i * CAR_F;
      for (let k = 0; k < 5; k += 1) cars[o + k] = u < 0.5 ? a.cars[o + k]! : b.cars[o + k]!;
      for (let k = 5; k < 8; k += 1) cars[o + k] = a.cars[o + k]! + (b.cars[o + k]! - a.cars[o + k]!) * u;
      // nlerp quaternion
      let bx = b.cars[o + 8]!, by = b.cars[o + 9]!, bz = b.cars[o + 10]!, bw = b.cars[o + 11]!;
      const ax = a.cars[o + 8]!, ay = a.cars[o + 9]!, az = a.cars[o + 10]!, aw = a.cars[o + 11]!;
      if (ax * bx + ay * by + az * bz + aw * bw < 0) {
        bx = -bx; by = -by; bz = -bz; bw = -bw;
      }
      let qx = ax + (bx - ax) * u, qy = ay + (by - ay) * u, qz = az + (bz - az) * u, qw = aw + (bw - aw) * u;
      const l = Math.hypot(qx, qy, qz, qw) || 1;
      qx /= l; qy /= l; qz /= l; qw /= l;
      cars[o + 8] = qx;
      cars[o + 9] = qy;
      cars[o + 10] = qz;
      cars[o + 11] = qw;
      cars[o + 12] = a.cars[o + 12]!;
    }
    this.ballPos.copy(ball);
    if (!this.exploded && tick >= this.goalTick) this.exploded = true;
    return true;
  }

  /** Director: where the replay camera is and looks (sim uu). Returns the horizontal FOV. */
  camera(dt: number, ball: Vector3, pos: Vector3, at: Vector3): number {
    const s = this.side;
    if (!this.slowMotion) {
      // chase: behind the ball as seen from the goal, raised
      const gx = 0;
      const gy = s * ARENA.halfY;
      let dx = ball.x - gx;
      let dy = ball.y - gy;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const want = new Vector3(ball.x + dx * 900, ball.y + dy * 900, Math.max(260, ball.z + 320));
      if (!this.chaseInit) {
        this.chase.copy(want);
        this.chaseInit = true;
      }
      this.chase.lerp(want, Math.min(1, dt * 2.5));
      pos.copy(this.chase);
      at.copy(ball);
      return 92;
    }
    // finish: low, beside the post, looking out along the goal line at the ball
    pos.set((ball.x >= 0 ? 1 : -1) * (ARENA.goal.halfWidth + 900), s * (ARENA.halfY - 350), 180);
    at.set(ball.x * 0.7, ball.y, Math.max(120, ball.z));
    return 70;
  }
}

export const REPLAY_CAR_FIELDS = CAR_F;
