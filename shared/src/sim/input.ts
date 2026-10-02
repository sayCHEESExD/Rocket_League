/**
 * One tick of a car's controls. Analog axes are -1..1, quantised to int8 on
 * the wire so the server and every predicting client see the SAME numbers.
 *
 *   throttle  +1 forward, -1 reverse
 *   steer     +1 right
 *   pitch     +1 nose DOWN (stick forward, like Rocket League's W), also the dodge's forward axis
 *   yaw       +1 right
 *   roll      +1 roll right
 */
export interface CarInput {
  throttle: number;
  steer: number;
  pitch: number;
  yaw: number;
  roll: number;
  jump: boolean;
  boost: boolean;
  handbrake: boolean;
}

export const emptyInput = (): CarInput => ({
  throttle: 0,
  steer: 0,
  pitch: 0,
  yaw: 0,
  roll: 0,
  jump: false,
  boost: false,
  handbrake: false,
});

export const copyInput = (o: CarInput, a: CarInput): CarInput => {
  o.throttle = a.throttle;
  o.steer = a.steer;
  o.pitch = a.pitch;
  o.yaw = a.yaw;
  o.roll = a.roll;
  o.jump = a.jump;
  o.boost = a.boost;
  o.handbrake = a.handbrake;
  return o;
};

const q = (v: number): number => {
  const n = Math.round((Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0) * 127);
  return n;
};

/** Pack to six bytes: five int8 axes + a button byte. Values are written as plain numbers (-127..127, 0..7). */
export const packInput = (i: CarInput, out: number[], at: number): void => {
  out[at] = q(i.throttle);
  out[at + 1] = q(i.steer);
  out[at + 2] = q(i.pitch);
  out[at + 3] = q(i.yaw);
  out[at + 4] = q(i.roll);
  out[at + 5] = (i.jump ? 1 : 0) | (i.boost ? 2 : 0) | (i.handbrake ? 4 : 0);
};

const dq = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.max(-127, Math.min(127, Math.round(v))) : 0;
  return n / 127;
};

/** Unpack (and sanitise: this arrives from a client). */
export const unpackInput = (src: ArrayLike<unknown>, at: number, o: CarInput): CarInput => {
  o.throttle = dq(src[at]);
  o.steer = dq(src[at + 1]);
  o.pitch = dq(src[at + 2]);
  o.yaw = dq(src[at + 3]);
  o.roll = dq(src[at + 4]);
  const b = typeof src[at + 5] === 'number' ? (src[at + 5] as number) | 0 : 0;
  o.jump = (b & 1) !== 0;
  o.boost = (b & 2) !== 0;
  o.handbrake = (b & 4) !== 0;
  return o;
};

/** Round an input to its wire form in place (the client predicts with exactly what it sends). */
export const quantiseInput = (i: CarInput): CarInput => {
  i.throttle = q(i.throttle) / 127;
  i.steer = q(i.steer) / 127;
  i.pitch = q(i.pitch) / 127;
  i.yaw = q(i.yaw) / 127;
  i.roll = q(i.roll) / 127;
  return i;
};

export const INPUT_BYTES = 6;
