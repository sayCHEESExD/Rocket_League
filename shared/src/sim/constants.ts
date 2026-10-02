/**
 * PHYSICS CONSTANTS, in Rocket League units (uu, seconds).
 *
 * Most values are the publicly documented Rocket League numbers (RocketSim /
 * RLUtilities research), because those are what make the car and the ball feel
 * like the real thing: the speeds, the jump timings and the hit model are what
 * players' hands already know. Anything that is OUR tuning rather than a known
 * value says so.
 */

/** Simulation tick (inputs, snapshots) and physics substeps per tick (RL runs physics at 120 Hz). */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
export const SUBSTEPS = 2;
export const PHYS_DT = TICK_DT / SUBSTEPS;

export const GRAVITY = -650;

// ------------------------------------------------------------------ arena
export const ARENA = {
  /** Half-width (side walls at x = +-). */
  halfX: 4096,
  /** Half-length (back walls at y = +-). */
  halfY: 5120,
  /** Raised from RL's 2044 for a little more aerial room. */
  height: 2300,
  /** Corner chamfer plane: |x| + |y| <= corner. */
  corner: 8064,
  /** Radius of every wall/floor/ceiling transition (the curves you drive up). */
  round: 256,
  goal: {
    halfWidth: 893,
    height: 642,
    depth: 880,
  },
} as const;

// ------------------------------------------------------------------- ball
export const BALL = {
  radius: 91.25,
  mass: 30,
  restZ: 93.15,
  maxSpeed: 6000,
  maxAngSpeed: 6,
  /** Linear drag per second (Bullet damping). */
  drag: 0.03,
  /** RLUtilities' bounce model. */
  restitution: 0.6,
  friction: 0.28,
  /** Spin gained from a bounce's friction. */
  spinCoupling: 0.0003,
  /** Below this normal speed a bounce does not bounce (kills resting jitter). OUR tuning. */
  restSpeed: 60,
} as const;

// -------------------------------------------------------------------- car
export const CAR = {
  mass: 180,
  /** Dominus-like hitbox half extents (fits the sporty bodies) (local X fwd, Y left, Z up) and offset from the car origin. */
  half: { x: 63.5, y: 42.0, z: 17.0 },
  offset: { x: 9.0, y: 0, z: 0 },
  /** Car origin height above the floor when resting on its wheels. OUR geometry. */
  rideHeight: 36,
  /** Suspension probes (local), cast along -up. */
  wheels: [
    { x: 51, y: 31, z: -6 },
    { x: 51, y: -31, z: -6 },
    { x: -34, y: 33, z: -6 },
    { x: -34, y: -33, z: -6 },
  ],
  /** Extra droop below the rest length that still counts as wheel contact. */
  wheelTravel: 14,
  /** Per-wheel spring (accel per uu of compression) and damping. OUR tuning. */
  springK: 110,
  springC: 9,
  maxSpeed: 2300,
  maxAngSpeed: 5.5,
  /** On the ground the car must be able to follow a ramp at full speed. OUR tuning. */
  maxGroundAngSpeed: 12,
  supersonicStart: 2200,
  supersonicKeep: 2100,

  // driving
  throttleAccel: 1600,
  /** Fraction of throttleAccel by forward speed. */
  driveCurve: [
    [0, 1],
    [1400, 0.1],
    [1410, 0],
  ] as const,
  brakeAccel: 3500,
  coastDecel: 525,
  airThrottleAccel: 66.67,
  /** Steering curvature (1/uu) by forward speed (RLUtilities). */
  curvature: [
    [0, 0.0069],
    [500, 0.00398],
    [1000, 0.00235],
    [1500, 0.001375],
    [1750, 0.0011],
    [2300, 0.00088],
  ] as const,
  /** How fast the yaw rate reaches its target, 1/s. OUR tuning (RL steering is near-instant). */
  yawResponse: 26,
  /** Lateral grip (max sideways accel the tyres can produce) and while powersliding. OUR tuning. */
  gripAccel: 5200,
  slideGripAccel: 850,
  /** Extra yaw rate a powerslide gives at speed (rad/s). OUR tuning. */
  slideYawBonus: 1.3,
  slideYawMax: 3.6,
  powerslideRise: 5,
  powerslideFall: 2,
  /** Tilt alignment to the surface while driving: rad/s per rad of misalignment, and how fast it takes hold. OUR tuning. */
  alignRate: 22,
  alignResponse: 60,
  /** Sticky force pressing the wheels into the surface, in g. */
  sticky: 0.5,

  // boost
  boostMax: 100,
  /** A full tank lasts 8 s of held boost (RL: 3 s - too short for this game). OUR tuning. */
  boostPerSecond: 12.5,
  boostMinTime: 0.1,
  /** Boost push, a little under RL's (991 / 1058) so the longer tank stays controllable. OUR tuning. */
  boostAccelGround: 880,
  boostAccelAir: 930,
  kickoffBoost: 100 / 3,

  // jumping
  jumpImpulse: 875 / 3,
  jumpAccel: 4375 / 3,
  jumpMinTime: 0.025,
  jumpMaxTime: 0.2,
  doubleJumpWindow: 1.25,
  dodgeDeadzone: 0.5,
  flipImpulse: 500,
  flipBackScale: 2.5,
  flipSideScale: 1.9,
  flipBackScaleX: 16 / 15,
  flipTorqueTime: 0.65,
  /** Flip spin rate. RL's is capped at 5.5 rad/s; ours a little faster so a ground flip lands on its wheels. OUR tuning. */
  flipSpin: 7.4,
  flipZDampStart: 0.15,
  flipZDampEnd: 0.21,
  flipZDamp: 0.35,

  // air control (RLUtilities): torque and damping, per local axis (roll, pitch, yaw)
  airTorque: { roll: 36.08, pitch: 12.15, yaw: 8.92 },
  airDamp: { roll: 4.47, pitch: 2.8, yaw: 1.89 },

  /** Righting when stuck on the roof: impulse and roll torque. */
  autoFlipImpulse: 200,
  autoFlipSpin: 4.2,
  autoFlipTime: 0.4,

  // collisions
  worldRestitution: 0.3,
  worldFriction: 0.3,
  carCarRestitution: 0.1,
  bumpCooldown: 0.25,
  bumpGround: [
    [0, 0],
    [1400, 1100],
    [2200, 1530],
  ] as const,
  bumpAir: [
    [0, 0],
    [1400, 1390],
    [2200, 1945],
  ] as const,
  bumpUp: 325,
  demoRespawn: 3,
} as const;

/** Car-ball contact (Bullet impulse + Psyonix's extra impulse). */
export const HIT = {
  friction: 2.0,
  restitution: 0,
  zScale: 0.35,
  forwardScale: 0.65,
  maxDeltaVel: 4600,
  factor: [
    [0, 0.65],
    [500, 0.65],
    [2300, 0.55],
    [4600, 0.3],
  ] as const,
} as const;

// ------------------------------------------------------------- boost pads
export const PAD = {
  bigRadius: 208,
  smallRadius: 144,
  height: 170,
  bigAmount: 100,
  smallAmount: 12,
  bigRespawn: 10,
  smallRespawn: 4,
} as const;

/** The standard soccar layout: [x, y, big]. */
export const PADS: readonly (readonly [number, number, boolean])[] = [
  [-3584, 0, true],
  [3584, 0, true],
  [-3072, -4096, true],
  [3072, -4096, true],
  [-3072, 4096, true],
  [3072, 4096, true],
  [0, -4240, false],
  [-1792, -4184, false],
  [1792, -4184, false],
  [-940, -3308, false],
  [940, -3308, false],
  [0, -2816, false],
  [-3584, -2484, false],
  [3584, -2484, false],
  [-1788, -2300, false],
  [1788, -2300, false],
  [-2048, -1036, false],
  [0, -1024, false],
  [2048, -1036, false],
  [-1024, 0, false],
  [1024, 0, false],
  [-2048, 1036, false],
  [0, 1024, false],
  [2048, 1036, false],
  [-1788, 2300, false],
  [1788, 2300, false],
  [-3584, 2484, false],
  [3584, 2484, false],
  [0, 2816, false],
  [-940, 3308, false],
  [940, 3308, false],
  [-1792, 4184, false],
  [1792, 4184, false],
  [0, 4240, false],
];

/**
 * Kickoff spots for the BLUE team (defending -Y), RL's five first, then three
 * more for bigger lobbies. Orange mirrors them. [x, y, yaw].
 */
export const KICKOFF_SPOTS: readonly (readonly [number, number, number])[] = [
  [-2048, -2560, Math.PI / 4],
  [2048, -2560, (3 * Math.PI) / 4],
  [-256, -3840, Math.PI / 2],
  [256, -3840, Math.PI / 2],
  [0, -4608, Math.PI / 2],
  [-1792, -4096, Math.PI / 2],
  [1792, -4096, Math.PI / 2],
  [-2560, -3200, Math.PI / 2],
];

/** Where a demolished car comes back (blue side; orange mirrors). */
export const RESPAWN_SPOTS: readonly (readonly [number, number, number])[] = [
  [-2304, -4608, Math.PI / 2],
  [-2688, -4608, Math.PI / 2],
  [2304, -4608, Math.PI / 2],
  [2688, -4608, Math.PI / 2],
];

/** Most cars a world holds (15 humans + headroom for bots). */
export const MAX_CARS = 16;
