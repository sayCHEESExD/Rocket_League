import { goalSide } from './arena.js';
import { BallState, stepBall } from './ball.js';
import { BALL, PHYS_DT } from './constants.js';

const scratch = new BallState();

/**
 * Where is the ball going, if nobody touches it? Flies a copy for up to
 * `seconds` and returns the goal it would enter (+1 the +Y goal, -1 the -Y
 * goal, 0 neither). Used for "shot on goal" and "save" bookkeeping.
 */
export const predictBallGoal = (ball: BallState, seconds: number): number => {
  scratch.copyFrom(ball);
  const steps = Math.ceil(seconds / PHYS_DT);
  for (let i = 0; i < steps; i += 1) {
    stepBall(scratch, PHYS_DT);
    const g = goalSide(scratch.pos, BALL.radius);
    if (g !== 0) return g;
  }
  return 0;
};
