import type { CarState } from './car.js';
import { MAX_CARS, PADS, SUBSTEPS } from './constants.js';
import { emptyInput, type CarInput } from './input.js';
import type { World } from './world.js';

/**
 * THE WIRE FORMAT OF THE WORLD, and the quantisation that makes prediction exact.
 *
 * The server calls `quantizeWorld` on its own state after every tick, so the
 * state it continues from is exactly what a client decodes from a snapshot. A
 * client that replays the same inputs from a snapshot therefore reproduces the
 * server bit for bit (same JS engine maths permitting), and every correction it
 * shows is a real disagreement - another player's input it guessed wrong - not
 * rounding noise. Every quantiser here is idempotent: Q(Q(x)) = Q(x).
 *
 * Floats that must stay smooth at low speed (positions, velocities, spin,
 * orientation) are float32; timers are whole physics steps; boost is 1/100.
 */

const PHYS_HZ = 60 * SUBSTEPS;
const f = Math.fround;
const qt = (t: number): number => Math.min(255, Math.max(0, Math.round(t * PHYS_HZ))) / PHYS_HZ;
const qBoost = (b: number): number => Math.round(Math.max(0, Math.min(100, b)) * 100) / 100;
const qUnit = (v: number, n: number): number => Math.round(Math.max(-1, Math.min(1, v)) * n) / n;
/** Car velocity: 1/8 uu/s steps (cars never exceed 2300 by more than a bump). */
const VEL_K = 8;
const qVel = (v: number): number => Math.round(Math.max(-4095, Math.min(4095, v)) * VEL_K) / VEL_K;
/** Car spin: 1/2000 rad/s steps. */
const ANG_K = 2000;
const qAng = (v: number): number => Math.round(Math.max(-16, Math.min(16, v)) * ANG_K) / ANG_K;

const quantizeCar = (c: CarState, step: number): void => {
  c.pos.x = f(c.pos.x);
  c.pos.y = f(c.pos.y);
  c.pos.z = f(c.pos.z);
  c.vel.x = qVel(c.vel.x);
  c.vel.y = qVel(c.vel.y);
  c.vel.z = qVel(c.vel.z);
  c.quat.x = qUnit(c.quat.x, 32767);
  c.quat.y = qUnit(c.quat.y, 32767);
  c.quat.z = qUnit(c.quat.z, 32767);
  c.quat.w = qUnit(c.quat.w, 32767);
  c.angVel.x = qAng(c.angVel.x);
  c.angVel.y = qAng(c.angVel.y);
  c.angVel.z = qAng(c.angVel.z);
  c.gn.x = qUnit(c.gn.x, 32767);
  c.gn.y = qUnit(c.gn.y, 32767);
  c.gn.z = qUnit(c.gn.z, 32767);
  c.boost = qBoost(c.boost);
  c.handbrake = Math.round(Math.max(0, Math.min(1, c.handbrake)) * 255) / 255;
  c.boostTime = qt(c.boostTime);
  c.groundTime = qt(c.groundTime);
  c.jumpTime = qt(c.jumpTime);
  c.airTimeSinceJump = qt(c.airTimeSinceJump);
  c.flipTime = qt(c.flipTime);
  c.autoFlipTime = qt(c.autoFlipTime);
  c.bumpCooldown = qt(c.bumpCooldown);
  c.flipX = qUnit(c.flipX, 127);
  c.flipY = qUnit(c.flipY, 127);
  c.respawnTime = Math.max(0, Math.min(65535, Math.round(c.respawnTime)));
  c.lastBallHit = step - Math.min(255, Math.max(0, step - c.lastBallHit));
};

/** Snap the whole world onto the wire grid, in place (server, after every tick). */
export const quantizeWorld = (w: World): void => {
  w.step = w.tick * SUBSTEPS;
  for (let i = 0; i < MAX_CARS; i += 1) {
    const c = w.cars[i]!;
    if (c.active) quantizeCar(c, w.step);
  }
  const b = w.ball;
  b.pos.x = f(b.pos.x);
  b.pos.y = f(b.pos.y);
  b.pos.z = f(b.pos.z);
  b.vel.x = f(b.vel.x);
  b.vel.y = f(b.vel.y);
  b.vel.z = f(b.vel.z);
  b.angVel.x = f(b.angVel.x);
  b.angVel.y = f(b.angVel.y);
  b.angVel.z = f(b.angVel.z);
};

const FLAG = {
  boosting: 1,
  onGround: 2,
  jumpHeld: 4,
  isJumping: 8,
  hasJumped: 16,
  hasDoubleJumped: 32,
  hasFlipped: 64,
  flipping: 128,
  onRoof: 256,
  supersonic: 512,
  demolished: 1024,
  autoFlipNeg: 2048,
} as const;

const HEADER = 1 + 4 + 1 + 1;
const BALL_BYTES = 36 + 3;
/** Pads: a count, then (index, ticks) for each pad that is recharging. */
const padBytes = (w: World): number => {
  let n = 0;
  for (let p = 0; p < PADS.length; p += 1) if (w.pads[p]! > 0) n += 1;
  return 1 + n * 3;
};
const CAR_BYTES = 1 + 1 + 2 + 12 + 6 + 8 + 6 + 6 + 2 + 2 + 1 + 1 + 7 + 2 + 2 + 1 + 6;

export const SNAPSHOT_VERSION = 6;

/** Per-car extras the snapshot carries beside the physics. */
export interface SnapshotCarMeta {
  /** Last input sequence the server applied for this car's driver (sent as its low 16 bits). */
  ack: number;
  /** The input the server is currently applying (for other clients' extrapolation). */
  input: CarInput;
}

/**
 * Encode the world. `meta[i]` is car i's ack/input. Allocates one buffer per
 * call - the server encodes once per snapshot and broadcasts the same bytes.
 */
export const encodeSnapshot = (w: World, meta: readonly SnapshotCarMeta[]): Uint8Array => {
  let count = 0;
  for (let i = 0; i < MAX_CARS; i += 1) if (w.cars[i]!.active) count += 1;
  const buf = new ArrayBuffer(HEADER + BALL_BYTES + padBytes(w) + count * CAR_BYTES);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, SNAPSHOT_VERSION);
  o += 1;
  v.setUint32(o, w.tick, true);
  o += 4;
  v.setUint8(o, (w.carsFrozen ? 1 : 0) | (w.ballFrozen ? 2 : 0));
  o += 1;
  v.setUint8(o, count);
  o += 1;
  const b = w.ball;
  for (const x of [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.angVel.x, b.angVel.y, b.angVel.z]) {
    v.setFloat32(o, x, true);
    o += 4;
  }
  v.setInt8(o, b.lastTouch);
  v.setInt8(o + 1, b.lastTouchTeam);
  v.setInt8(o + 2, b.prevTouch);
  o += 3;
  const cooling = padBytes(w) - 1;
  v.setUint8(o, cooling / 3);
  o += 1;
  for (let p = 0; p < PADS.length; p += 1) {
    if (w.pads[p]! <= 0) continue;
    v.setUint8(o, p);
    v.setUint16(o + 1, Math.min(65535, w.pads[p]!), true);
    o += 3;
  }
  for (let i = 0; i < MAX_CARS; i += 1) {
    const c = w.cars[i]!;
    if (!c.active) continue;
    const m = meta[i];
    v.setUint8(o, i);
    v.setUint8(o + 1, c.team);
    v.setUint16(o + 2, (m?.ack ?? 0) & 0xffff, true);
    o += 4;
    v.setFloat32(o, c.pos.x, true);
    v.setFloat32(o + 4, c.pos.y, true);
    v.setFloat32(o + 8, c.pos.z, true);
    o += 12;
    v.setInt16(o, Math.round(c.vel.x * VEL_K), true);
    v.setInt16(o + 2, Math.round(c.vel.y * VEL_K), true);
    v.setInt16(o + 4, Math.round(c.vel.z * VEL_K), true);
    o += 6;
    v.setInt16(o, Math.round(c.quat.x * 32767), true);
    v.setInt16(o + 2, Math.round(c.quat.y * 32767), true);
    v.setInt16(o + 4, Math.round(c.quat.z * 32767), true);
    v.setInt16(o + 6, Math.round(c.quat.w * 32767), true);
    o += 8;
    v.setInt16(o, Math.round(c.angVel.x * ANG_K), true);
    v.setInt16(o + 2, Math.round(c.angVel.y * ANG_K), true);
    v.setInt16(o + 4, Math.round(c.angVel.z * ANG_K), true);
    o += 6;
    v.setInt16(o, Math.round(c.gn.x * 32767), true);
    v.setInt16(o + 2, Math.round(c.gn.y * 32767), true);
    v.setInt16(o + 4, Math.round(c.gn.z * 32767), true);
    o += 6;
    v.setUint16(o, Math.round(c.boost * 100), true);
    o += 2;
    let flags = 0;
    if (c.boosting) flags |= FLAG.boosting;
    if (c.onGround) flags |= FLAG.onGround;
    if (c.jumpHeld) flags |= FLAG.jumpHeld;
    if (c.isJumping) flags |= FLAG.isJumping;
    if (c.hasJumped) flags |= FLAG.hasJumped;
    if (c.hasDoubleJumped) flags |= FLAG.hasDoubleJumped;
    if (c.hasFlipped) flags |= FLAG.hasFlipped;
    if (c.flipping) flags |= FLAG.flipping;
    if (c.onRoof) flags |= FLAG.onRoof;
    if (c.supersonic) flags |= FLAG.supersonic;
    if (c.demolished) flags |= FLAG.demolished;
    if (c.autoFlipDir < 0) flags |= FLAG.autoFlipNeg;
    v.setUint16(o, flags, true);
    o += 2;
    v.setUint8(o, c.wheels);
    v.setUint8(o + 1, Math.round(c.handbrake * 255));
    o += 2;
    for (const t of [c.boostTime, c.groundTime, c.jumpTime, c.airTimeSinceJump, c.flipTime, c.autoFlipTime, c.bumpCooldown]) {
      v.setUint8(o, Math.min(255, Math.max(0, Math.round(t * PHYS_HZ))));
      o += 1;
    }
    v.setInt8(o, Math.round(c.flipX * 127));
    v.setInt8(o + 1, Math.round(c.flipY * 127));
    o += 2;
    v.setUint16(o, c.respawnTime, true);
    o += 2;
    v.setUint8(o, Math.min(255, Math.max(0, w.step - c.lastBallHit)));
    o += 1;
    const inp = m?.input;
    if (inp) {
      v.setInt8(o, Math.round(inp.throttle * 127));
      v.setInt8(o + 1, Math.round(inp.steer * 127));
      v.setInt8(o + 2, Math.round(inp.pitch * 127));
      v.setInt8(o + 3, Math.round(inp.yaw * 127));
      v.setInt8(o + 4, Math.round(inp.roll * 127));
      v.setUint8(o + 5, (inp.jump ? 1 : 0) | (inp.boost ? 2 : 0) | (inp.handbrake ? 4 : 0));
    }
    o += 6;
  }
  return new Uint8Array(buf);
};

export interface DecodedMeta {
  ack: number[];
  inputs: CarInput[];
}

export const createDecodedMeta = (): DecodedMeta => ({
  ack: new Array<number>(MAX_CARS).fill(0),
  inputs: Array.from({ length: MAX_CARS }, () => emptyInput()),
});

/**
 * Decode into `w` (every car not in the snapshot is deactivated) and `meta`.
 * Returns false for a buffer this build cannot read.
 */
export const decodeSnapshot = (bytes: Uint8Array, w: World, meta: DecodedMeta): boolean => {
  if (bytes.byteLength < HEADER) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  if (v.getUint8(o) !== SNAPSHOT_VERSION) return false;
  o += 1;
  w.tick = v.getUint32(o, true);
  w.step = w.tick * SUBSTEPS;
  o += 4;
  const fl = v.getUint8(o);
  w.carsFrozen = (fl & 1) !== 0;
  w.ballFrozen = (fl & 2) !== 0;
  o += 1;
  const count = v.getUint8(o);
  o += 1;
  if (bytes.byteLength < HEADER + BALL_BYTES + 1 + count * CAR_BYTES) return false;
  const b = w.ball;
  b.pos.x = v.getFloat32(o, true);
  b.pos.y = v.getFloat32(o + 4, true);
  b.pos.z = v.getFloat32(o + 8, true);
  b.vel.x = v.getFloat32(o + 12, true);
  b.vel.y = v.getFloat32(o + 16, true);
  b.vel.z = v.getFloat32(o + 20, true);
  b.angVel.x = v.getFloat32(o + 24, true);
  b.angVel.y = v.getFloat32(o + 28, true);
  b.angVel.z = v.getFloat32(o + 32, true);
  o += 36;
  b.lastTouch = v.getInt8(o);
  b.lastTouchTeam = v.getInt8(o + 1);
  b.prevTouch = v.getInt8(o + 2);
  o += 3;
  w.pads.fill(0);
  const cooling = v.getUint8(o);
  o += 1;
  if (bytes.byteLength < HEADER + BALL_BYTES + 1 + cooling * 3 + count * CAR_BYTES) return false;
  for (let k = 0; k < cooling; k += 1) {
    const p = v.getUint8(o);
    if (p < PADS.length) w.pads[p] = v.getUint16(o + 1, true);
    o += 3;
  }
  for (let i = 0; i < MAX_CARS; i += 1) w.cars[i]!.active = false;
  for (let k = 0; k < count; k += 1) {
    const i = v.getUint8(o);
    const c = w.cars[i];
    if (!c) return false;
    c.active = true;
    c.team = v.getUint8(o + 1);
    meta.ack[i] = v.getUint16(o + 2, true);
    o += 4;
    c.pos.x = v.getFloat32(o, true);
    c.pos.y = v.getFloat32(o + 4, true);
    c.pos.z = v.getFloat32(o + 8, true);
    c.vel.x = v.getInt16(o + 12, true) / VEL_K;
    c.vel.y = v.getInt16(o + 14, true) / VEL_K;
    c.vel.z = v.getInt16(o + 16, true) / VEL_K;
    c.quat.x = v.getInt16(o + 18, true) / 32767;
    c.quat.y = v.getInt16(o + 20, true) / 32767;
    c.quat.z = v.getInt16(o + 22, true) / 32767;
    c.quat.w = v.getInt16(o + 24, true) / 32767;
    c.angVel.x = v.getInt16(o + 26, true) / ANG_K;
    c.angVel.y = v.getInt16(o + 28, true) / ANG_K;
    c.angVel.z = v.getInt16(o + 30, true) / ANG_K;
    o += 32;
    c.gn.x = v.getInt16(o, true) / 32767;
    c.gn.y = v.getInt16(o + 2, true) / 32767;
    c.gn.z = v.getInt16(o + 4, true) / 32767;
    o += 6;
    c.boost = v.getUint16(o, true) / 100;
    o += 2;
    const flags = v.getUint16(o, true);
    o += 2;
    c.boosting = (flags & FLAG.boosting) !== 0;
    c.onGround = (flags & FLAG.onGround) !== 0;
    c.jumpHeld = (flags & FLAG.jumpHeld) !== 0;
    c.isJumping = (flags & FLAG.isJumping) !== 0;
    c.hasJumped = (flags & FLAG.hasJumped) !== 0;
    c.hasDoubleJumped = (flags & FLAG.hasDoubleJumped) !== 0;
    c.hasFlipped = (flags & FLAG.hasFlipped) !== 0;
    c.flipping = (flags & FLAG.flipping) !== 0;
    c.onRoof = (flags & FLAG.onRoof) !== 0;
    c.supersonic = (flags & FLAG.supersonic) !== 0;
    c.demolished = (flags & FLAG.demolished) !== 0;
    c.autoFlipDir = (flags & FLAG.autoFlipNeg) !== 0 ? -1 : 1;
    c.wheels = v.getUint8(o);
    c.handbrake = v.getUint8(o + 1) / 255;
    o += 2;
    c.boostTime = v.getUint8(o) / PHYS_HZ;
    c.groundTime = v.getUint8(o + 1) / PHYS_HZ;
    c.jumpTime = v.getUint8(o + 2) / PHYS_HZ;
    c.airTimeSinceJump = v.getUint8(o + 3) / PHYS_HZ;
    c.flipTime = v.getUint8(o + 4) / PHYS_HZ;
    c.autoFlipTime = v.getUint8(o + 5) / PHYS_HZ;
    c.bumpCooldown = v.getUint8(o + 6) / PHYS_HZ;
    o += 7;
    c.flipX = v.getInt8(o) / 127;
    c.flipY = v.getInt8(o + 1) / 127;
    o += 2;
    c.respawnTime = v.getUint16(o, true);
    o += 2;
    c.lastBallHit = w.step - v.getUint8(o);
    o += 1;
    const inp = meta.inputs[i]!;
    inp.throttle = v.getInt8(o) / 127;
    inp.steer = v.getInt8(o + 1) / 127;
    inp.pitch = v.getInt8(o + 2) / 127;
    inp.yaw = v.getInt8(o + 3) / 127;
    inp.roll = v.getInt8(o + 4) / 127;
    const bt = v.getUint8(o + 5);
    inp.jump = (bt & 1) !== 0;
    inp.boost = (bt & 2) !== 0;
    inp.handbrake = (bt & 4) !== 0;
    o += 6;
  }
  return true;
};
