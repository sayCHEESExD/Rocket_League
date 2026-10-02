import {
  MAX_CARS,
  Phase,
  World,
  copyInput,
  createDecodedMeta,
  decodeSnapshot,
  emptyInput,
  type CarInput,
} from '@rlb/shared';

const HISTORY = 256;
/** Never replay more than this many ticks after a snapshot (a stalled tab must not freeze the page). */
const MAX_REPLAY = 45;
/** Corrections bigger than this snap instead of gliding (respawns, kickoffs). */
const SNAP_DISTANCE = 450;

/** Position + orientation of one body, as drawn. */
export class Pose {
  copy(o: Pose): this {
    this.px = o.px;
    this.py = o.py;
    this.pz = o.pz;
    this.qx = o.qx;
    this.qy = o.qy;
    this.qz = o.qz;
    this.qw = o.qw;
    return this;
  }
  px = 0;
  py = 0;
  pz = 0;
  qx = 0;
  qy = 0;
  qz = 0;
  qw = 1;
}

/** Visual offset that glides a correction out instead of teleporting. */
class Offset {
  x = 0;
  y = 0;
  z = 0;
  /** Rotation offset as a quaternion (identity = none). */
  qx = 0;
  qy = 0;
  qz = 0;
  qw = 1;
}

const capture = (p: Pose, pos: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }): void => {
  p.px = pos.x;
  p.py = pos.y;
  p.pz = pos.z;
  p.qx = q.x;
  p.qy = q.y;
  p.qz = q.z;
  p.qw = q.w;
};

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

/**
 * CLIENT PREDICTION, the Rocket League way.
 *
 * The client runs the same deterministic world as the server, AHEAD of it:
 * every snapshot is the true state at server tick S; the client rewinds to it
 * and replays its own inputs that the server has not applied yet, with every
 * other car assumed to keep doing what it was last seen doing. That makes the
 * local car respond on the frame the key goes down AND makes the ball react to
 * the local car's touches immediately, which is what aiming a shot needs.
 *
 * When a replay lands somewhere different from where the last prediction had
 * things (another player turned, a bump), the difference becomes a visual
 * offset that decays over a few frames - the simulation snaps, the picture
 * glides.
 */
export class Prediction {
  readonly auth = new World();
  readonly pred = new World();
  private readonly incoming = new World();
  readonly meta = createDecodedMeta();
  private readonly incomingMeta = createDecodedMeta();

  private readonly history: CarInput[] = Array.from({ length: HISTORY }, () => emptyInput());
  seq = 0;
  localSlot = -1;
  hasSnapshot = false;
  private fresh = false;
  /** Ticks the last replay covered (how far ahead of the server we run). */
  lead = 0;

  /** Phase timeline from the schema, so the replay knows when a countdown ends. */
  phase: number = Phase.Countdown;
  phaseEnd = 0;

  private readonly inputs: CarInput[] = Array.from({ length: MAX_CARS }, () => emptyInput());

  /** Poses at the previous and current tick (render interpolates), and the gliding offsets. */
  readonly prevCars: Pose[] = Array.from({ length: MAX_CARS }, () => new Pose());
  readonly curCars: Pose[] = Array.from({ length: MAX_CARS }, () => new Pose());
  private readonly carOffsets: Offset[] = Array.from({ length: MAX_CARS }, () => new Offset());
  readonly prevBall = new Pose();
  readonly curBall = new Pose();
  private readonly ballOffset = new Offset();
  private readonly oldCars: Pose[] = Array.from({ length: MAX_CARS }, () => new Pose());
  private readonly oldBall = new Pose();
  private readonly wasActive = new Uint8Array(MAX_CARS);

  /** Largest local-car correction seen recently (uu), for the debug overlay. */
  lastLocalCorrection = 0;

  onSnapshot(bytes: Uint8Array): void {
    if (!decodeSnapshot(bytes, this.incoming, this.incomingMeta)) return;
    if (this.hasSnapshot && this.incoming.tick <= this.auth.tick) return;
    this.auth.copyFrom(this.incoming);
    for (let i = 0; i < MAX_CARS; i += 1) {
      this.meta.ack[i] = this.incomingMeta.ack[i]!;
      copyInput(this.meta.inputs[i]!, this.incomingMeta.inputs[i]!);
    }
    if (!this.hasSnapshot) {
      this.pred.copyFrom(this.auth);
      this.captureAll(true);
    }
    this.hasSnapshot = true;
    this.fresh = true;
  }

  /** Forget everything (a reconnect into a new room). */
  reset(): void {
    this.hasSnapshot = false;
    this.fresh = false;
    this.seq = 0;
    this.localSlot = -1;
  }

  private flags(w: World): void {
    const t = w.tick;
    switch (this.phase) {
      case Phase.Countdown:
        w.carsFrozen = t < this.phaseEnd;
        w.ballFrozen = t < this.phaseEnd;
        break;
      case Phase.Play:
        w.carsFrozen = false;
        w.ballFrozen = false;
        break;
      case Phase.Goal:
        w.carsFrozen = this.phaseEnd > 0 && t >= this.phaseEnd;
        w.ballFrozen = true;
        break;
      default:
        w.carsFrozen = true;
        w.ballFrozen = true;
    }
  }

  private advance(w: World, local: CarInput | null): void {
    for (let i = 0; i < MAX_CARS; i += 1) copyInput(this.inputs[i]!, this.meta.inputs[i]!);
    if (local && this.localSlot >= 0) copyInput(this.inputs[this.localSlot]!, local);
    this.flags(w);
    w.advance(this.inputs);
  }

  /**
   * One client tick: record `input` under the next sequence number and move
   * the predicted world forward (rebuilding it from the newest snapshot when
   * one has arrived). Returns the sequence number to send it under.
   */
  step(input: CarInput): number {
    this.seq += 1;
    const seq = this.seq;
    copyInput(this.history[seq % HISTORY]!, input);
    if (!this.hasSnapshot) return seq;

    // shift current -> previous for render interpolation
    for (let i = 0; i < MAX_CARS; i += 1) {
      const a = this.prevCars[i]!;
      const b = this.curCars[i]!;
      a.px = b.px; a.py = b.py; a.pz = b.pz; a.qx = b.qx; a.qy = b.qy; a.qz = b.qz; a.qw = b.qw;
    }
    {
      const a = this.prevBall;
      const b = this.curBall;
      a.px = b.px; a.py = b.py; a.pz = b.pz; a.qx = b.qx; a.qy = b.qy; a.qz = b.qz; a.qw = b.qw;
    }

    if (!this.fresh) {
      this.advance(this.pred, input);
      this.captureAll(false);
      return seq;
    }
    this.fresh = false;

    // the old path, one tick on: where things WOULD have been drawn
    this.advance(this.pred, input);
    for (let i = 0; i < MAX_CARS; i += 1) {
      const c = this.pred.cars[i]!;
      this.wasActive[i] = c.active && !c.demolished ? 1 : 0;
      capture(this.oldCars[i]!, c.pos, c.quat);
    }
    capture(this.oldBall, this.pred.ball.pos, IDENTITY);

    // the new path: the snapshot plus every input the server has not applied yet
    this.pred.copyFrom(this.auth);
    let from = this.seq + 1;
    if (this.localSlot >= 0) {
      // the wire carries the ack's low 16 bits: widen it against our own counter
      const low = this.meta.ack[this.localSlot] ?? 0;
      const ack = low > 0 ? this.seq - ((this.seq - low) & 0xffff) : 0;
      from = ack > 0 ? ack + 1 : this.seq - 6;
    } else {
      from = this.seq - 4; // spectating: a short, fixed lead so remote cars do not lag
    }
    from = Math.max(from, this.seq - MAX_REPLAY + 1, this.seq - HISTORY + 1);
    let n = 0;
    for (let s = from; s <= this.seq; s += 1) {
      this.advance(this.pred, s > 0 ? this.history[s % HISTORY]! : null);
      n += 1;
    }
    this.lead = n;

    // corrections -> gliding offsets
    for (let i = 0; i < MAX_CARS; i += 1) {
      const c = this.pred.cars[i]!;
      const off = this.carOffsets[i]!;
      if (!this.wasActive[i] || !c.active || c.demolished) {
        this.clearOffset(off);
        continue;
      }
      const o = this.oldCars[i]!;
      const dx = o.px - c.pos.x;
      const dy = o.py - c.pos.y;
      const dz = o.pz - c.pos.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (i === this.localSlot) this.lastLocalCorrection = Math.max(this.lastLocalCorrection * 0.9, d);
      if (d > SNAP_DISTANCE) {
        this.clearOffset(off);
        continue;
      }
      off.x += dx;
      off.y += dy;
      off.z += dz;
      // rotation: offset = old * inverse(new), composed onto the existing offset
      const q = c.quat;
      // inv(new)
      const ix = -q.x, iy = -q.y, iz = -q.z, iw = q.w;
      // r = old * inv(new)
      const rx = o.qw * ix + o.qx * iw + o.qy * iz - o.qz * iy;
      const ry = o.qw * iy - o.qx * iz + o.qy * iw + o.qz * ix;
      const rz = o.qw * iz + o.qx * iy - o.qy * ix + o.qz * iw;
      const rw = o.qw * iw - o.qx * ix - o.qy * iy - o.qz * iz;
      // off = r * off
      const nx = rw * off.qx + rx * off.qw + ry * off.qz - rz * off.qy;
      const ny = rw * off.qy - rx * off.qz + ry * off.qw + rz * off.qx;
      const nz = rw * off.qz + rx * off.qy - ry * off.qx + rz * off.qw;
      const nw = rw * off.qw - rx * off.qx - ry * off.qy - rz * off.qz;
      const l = Math.hypot(nx, ny, nz, nw) || 1;
      off.qx = nx / l;
      off.qy = ny / l;
      off.qz = nz / l;
      off.qw = nw / l;
    }
    {
      const b = this.pred.ball.pos;
      const o = this.oldBall;
      const dx = o.px - b.x;
      const dy = o.py - b.y;
      const dz = o.pz - b.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > SNAP_DISTANCE) this.clearOffset(this.ballOffset);
      else {
        this.ballOffset.x += dx;
        this.ballOffset.y += dy;
        this.ballOffset.z += dz;
      }
    }
    this.captureAll(false);
    return seq;
  }

  private clearOffset(o: Offset): void {
    o.x = 0;
    o.y = 0;
    o.z = 0;
    o.qx = 0;
    o.qy = 0;
    o.qz = 0;
    o.qw = 1;
  }

  private captureAll(alsoPrev: boolean): void {
    for (let i = 0; i < MAX_CARS; i += 1) {
      const c = this.pred.cars[i]!;
      capture(this.curCars[i]!, c.pos, c.quat);
      // a car that just appeared or respawned must not interpolate from far away
      const p = this.prevCars[i]!;
      if (alsoPrev || Math.abs(p.px - c.pos.x) + Math.abs(p.py - c.pos.y) + Math.abs(p.pz - c.pos.z) > SNAP_DISTANCE) capture(p, c.pos, c.quat);
    }
    const b = this.pred.ball;
    capture(this.curBall, b.pos, IDENTITY);
    const p = this.prevBall;
    if (alsoPrev || Math.abs(p.px - b.pos.x) + Math.abs(p.py - b.pos.y) + Math.abs(p.pz - b.pos.z) > SNAP_DISTANCE) capture(p, b.pos, IDENTITY);
  }

  /** Let the offsets decay (call once per rendered frame). */
  decay(dt: number): void {
    const kp = Math.exp(-dt * 10);
    const kr = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < MAX_CARS; i += 1) {
      const o = this.carOffsets[i]!;
      o.x *= kp;
      o.y *= kp;
      o.z *= kp;
      // slerp towards identity (nlerp is fine for small angles)
      o.qx -= o.qx * kr;
      o.qy -= o.qy * kr;
      o.qz -= o.qz * kr;
      o.qw += (1 - o.qw) * kr;
      const l = Math.hypot(o.qx, o.qy, o.qz, o.qw) || 1;
      o.qx /= l;
      o.qy /= l;
      o.qz /= l;
      o.qw /= l;
    }
    const kb = Math.exp(-dt * 14);
    this.ballOffset.x *= kb;
    this.ballOffset.y *= kb;
    this.ballOffset.z *= kb;
  }

  /** Interpolated, offset pose of car i at fraction `alpha` between ticks. */
  carPose(i: number, alpha: number, out: Pose): Pose {
    const a = this.prevCars[i]!;
    const b = this.curCars[i]!;
    const o = this.carOffsets[i]!;
    out.px = a.px + (b.px - a.px) * alpha + o.x;
    out.py = a.py + (b.py - a.py) * alpha + o.y;
    out.pz = a.pz + (b.pz - a.pz) * alpha + o.z;
    // nlerp a->b
    let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw;
    if (a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw < 0) {
      bx = -bx; by = -by; bz = -bz; bw = -bw;
    }
    let qx = a.qx + (bx - a.qx) * alpha;
    let qy = a.qy + (by - a.qy) * alpha;
    let qz = a.qz + (bz - a.qz) * alpha;
    let qw = a.qw + (bw - a.qw) * alpha;
    const l = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= l; qy /= l; qz /= l; qw /= l;
    // apply offset rotation: off * q
    out.qx = o.qw * qx + o.qx * qw + o.qy * qz - o.qz * qy;
    out.qy = o.qw * qy - o.qx * qz + o.qy * qw + o.qz * qx;
    out.qz = o.qw * qz + o.qx * qy - o.qy * qx + o.qz * qw;
    out.qw = o.qw * qw - o.qx * qx - o.qy * qy - o.qz * qz;
    return out;
  }

  ballPose(alpha: number, out: Pose): Pose {
    const a = this.prevBall;
    const b = this.curBall;
    const o = this.ballOffset;
    out.px = a.px + (b.px - a.px) * alpha + o.x;
    out.py = a.py + (b.py - a.py) * alpha + o.y;
    out.pz = a.pz + (b.pz - a.pz) * alpha + o.z;
    return out;
  }
}
