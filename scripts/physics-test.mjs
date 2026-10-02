// Headless physics playtest: scripted scenarios on the shared sim, measured
// against Rocket League's known numbers. `npm run test:physics`.
import {
  World,
  emptyInput,
  placeCar,
  upOf,
  forwardOf,
  v3,
  TICK_RATE,
  quantizeWorld,
  encodeSnapshot,
  decodeSnapshot,
  createDecodedMeta,
} from '../shared/dist/index.js';

const results = [];
const check = (name, value, lo, hi, unit = '') => {
  const ok = value >= lo && value <= hi;
  results.push({ name, value, ok, range: `${lo}..${hi}`, unit });
};

const fresh = () => {
  const w = new World();
  const c = w.cars[0];
  c.active = true;
  c.team = 0;
  placeCar(c, 0, -2000, Math.PI / 2);
  c.boost = 100;
  w.ballFrozen = true;
  w.ball.pos.z = -10000; // out of the way unless a test wants it
  return { w, c };
};

const run = (w, ticks, inputFn, onTick) => {
  const inp = emptyInput();
  for (let t = 0; t < ticks; t += 1) {
    Object.assign(inp, emptyInput());
    inputFn?.(inp, t);
    w.advance([inp]);
    onTick?.(t);
  }
};
const speed = (c) => Math.hypot(c.vel.x, c.vel.y, c.vel.z);
const up = v3();
const fw = v3();

// 1. settle at rest
{
  const { w, c } = fresh();
  c.pos.z += 40; // drop from a little height
  let zs = [];
  run(w, 120, null, (t) => {
    if (t > 60) zs.push(c.pos.z);
  });
  const mean = zs.reduce((a, b) => a + b, 0) / zs.length;
  const jitter = Math.max(...zs) - Math.min(...zs);
  check('rest: ride height', mean, 30, 40, 'uu');
  check('rest: settle drift (last second)', jitter, 0, 1.0, 'uu');
  check('rest: on ground', c.onGround ? 1 : 0, 1, 1);
}

// 2. throttle only
{
  const { w, c } = fresh();
  let t1000 = -1;
  run(w, 6 * TICK_RATE, (i) => (i.throttle = 1), (t) => {
    if (t1000 < 0 && speed(c) >= 1000) t1000 = t / TICK_RATE;
  });
  check('throttle: time to 1000', t1000, 0.8, 1.6, 's');
  check('throttle: top speed', speed(c), 1380, 1420, 'uu/s');
}

// 3. boost from standstill
{
  const { w, c } = fresh();
  let tSuper = -1;
  run(w, 4 * TICK_RATE, (i) => {
    i.throttle = 1;
    i.boost = true;
  }, (t) => {
    if (tSuper < 0 && c.supersonic) tSuper = t / TICK_RATE;
  });
  check('boost: time to supersonic', tSuper, 1.4, 2.6, 's');
  check('boost: top speed', speed(c), 2280, 2300.1, 'uu/s');
}
// 3b. boost tank: a held boost lasts ~8 s (pads switched off)
{
  const { w, c } = fresh();
  w.pads.fill(1e6);
  let empty = -1;
  run(w, 12 * TICK_RATE, (i) => {
    i.throttle = 1;
    i.steer = 0.35;
    i.boost = true;
  }, (t) => {
    w.pads.fill(1e6);
    if (empty < 0 && c.boost <= 0) empty = t / TICK_RATE;
  });
  check('boost: a full tank lasts (s)', empty, 7, 9.5, 's');
}

// 4. turning circle at ~1000
{
  const { w, c } = fresh();
  placeCar(c, 0, 0, 0);
  run(w, 3 * TICK_RATE, (i, t) => {
    i.throttle = speed(c) < 1000 ? 1 : 0.0;
  });
  // hold ~1000 and steer
  const pts = [];
  run(w, 3 * TICK_RATE, (i) => {
    i.throttle = speed(c) < 1000 ? 0.8 : 0.0;
    i.steer = 1;
  }, () => pts.push([c.pos.x, c.pos.y, speed(c)]));
  // radius from 3 points spread on the path
  const a = pts[60], b = pts[90], d = pts[120];
  const area = Math.abs((b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1])) / 2;
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bd = Math.hypot(d[0] - b[0], d[1] - b[1]);
  const da = Math.hypot(a[0] - d[0], a[1] - d[1]);
  const radius = (ab * bd * da) / (4 * area);
  check('steer: radius at ~1000 uu/s (RL ~425)', radius, 340, 520, 'uu');
  check('steer: speed held', b[2], 900, 1100, 'uu/s');
}

// 5. single jump (full hold) and double jump
{
  const { w, c } = fresh();
  const z0 = c.pos.z;
  let peak = 0;
  run(w, 90, (i, t) => (i.jump = t < 14), () => (peak = Math.max(peak, c.pos.z - z0)));
  check('jump: full-hold height (RL ~230)', peak, 190, 280, 'uu');
  run(w, 120);
  check('jump: landed again', c.onGround ? 1 : 0, 1, 1);
}
{
  const { w, c } = fresh();
  const z0 = c.pos.z;
  let peak = 0;
  run(w, 150, (i, t) => (i.jump = t < 12 || (t >= 16 && t < 20)), () => (peak = Math.max(peak, c.pos.z - z0)));
  check('double jump height (RL ~480)', peak, 400, 580, 'uu');
}

// 6. ground front flip: speed gain and landing on wheels
{
  const { w, c } = fresh();
  run(w, 90, (i) => (i.throttle = 1));
  const v0 = speed(c);
  let landedUp = -2;
  let gain = 0;
  let flipT = -1;
  run(w, 150, (i, t) => {
    i.throttle = 1;
    if (t < 4) i.jump = true;
    if (t >= 8 && t < 11) {
      i.jump = true;
      i.pitch = 1;
    }
  }, (t) => {
    gain = Math.max(gain, speed(c) - v0);
    if (t > 12 && c.onGround && landedUp === -2) {
      upOf(up, c.quat);
      landedUp = up.z;
      flipT = t / TICK_RATE;
    }
  });
  check('flip: speed gain (RL ~500)', gain, 380, 620, 'uu/s');
  check('flip: lands on wheels (up.z)', landedUp, 0.7, 1.01);
  check('flip: time to land', flipT, 0.5, 1.4, 's');
}

// 6c. a jump while driving and boosting leaves the ground level (no pitch input)
{
  const { w, c } = fresh();
  placeCar(c, 0, -4000, Math.PI / 2);
  run(w, 60, (i) => {
    i.throttle = 1;
    i.boost = true;
  });
  let worst = 0;
  run(w, 36, (i, t) => {
    i.throttle = 1;
    i.boost = true;
    i.jump = t < 12;
  }, () => {
    forwardOf(fw, c.quat);
    upOf(up, c.quat);
    worst = Math.max(worst, Math.abs(fw.z), Math.abs(1 - up.z));
  });
  check('jump: stays level with throttle + boost (max tilt)', worst, 0, 0.05);
}

// 6b. a landing never adds speed
{
  const { w, c } = fresh();
  placeCar(c, 0, -4600, Math.PI / 2);
  run(w, 150, (i) => (i.throttle = 1));
  let lastAir = 0;
  let maxAfter = 0;
  let landedAt = -1;
  run(w, 150, (i, t) => {
    i.throttle = 1;
    i.jump = t < 10;
  }, (t) => {
    const vh = Math.hypot(c.vel.x, c.vel.y);
    if (landedAt < 0 && t > 12 && c.onGround) landedAt = t;
    if (landedAt < 0) lastAir = vh;
    else if (t < landedAt + 20) maxAfter = Math.max(maxAfter, vh);
  });
  check('landing: no free speed (gain at touchdown)', maxAfter - lastAir, -300, 15, 'uu/s');
}

// 7. ball bounce
{
  const w = new World();
  w.ball.pos.z = 1000;
  const peaks = [];
  let prevVz = 0;
  for (let t = 0; t < 600; t += 1) {
    w.advance([]);
    if (prevVz > 0 && w.ball.vel.z <= 0) peaks.push(w.ball.pos.z);
    prevVz = w.ball.vel.z;
  }
  check('ball: first rebound height (RL ~ 0.6^2 of drop ~ 390)', peaks[0] ?? 0, 300, 460, 'uu');
  check('ball: settles (z after 10s)', w.ball.pos.z, 90, 96, 'uu');
}

// 8. ball roll
{
  const w = new World();
  w.ball.vel.x = 1200;
  let dist = 0;
  const x0 = w.ball.pos.x;
  for (let t = 0; t < 3 * TICK_RATE; t += 1) w.advance([]);
  dist = Math.abs(w.ball.pos.x - x0);
  check('ball: roll speed after 3s (from 1200)', Math.hypot(w.ball.vel.x, w.ball.vel.y), 500, 1150, 'uu/s');
  check('ball: still on the floor', w.ball.pos.z, 88, 100, 'uu');
}

// 9. wall climb
for (const [label, boost] of [['wall: climbs at 1400', false], ['wall: climbs at 2300', true]]) {
  const { w, c } = fresh();
  placeCar(c, 0, 0, 0); // facing +X towards the side wall at 4096
  let maxZ = 0;
  let onWallTicks = 0;
  let vIn = 0;
  let vOut = 0;
  run(w, 6 * TICK_RATE, (i) => {
    i.throttle = 1;
    i.boost = boost;
  }, () => {
    maxZ = Math.max(maxZ, c.pos.z);
    upOf(up, c.quat);
    if (c.onGround && Math.abs(up.x) > 0.9) onWallTicks += 1;
    if (!vIn && c.pos.x > 3780) vIn = speed(c);
    if (!vOut && up.x < -0.95) vOut = speed(c);
  });
  check(label + ' (max z)', maxZ, 700, 2300, 'uu');
  check(label + ' (ticks driving on wall)', onWallTicks, 20, 1e9);
  check(label + ' (speed kept through the curve)', vOut / vIn, 0.85, 1.05);
}

// 10. car hits a resting ball
for (const target of [1400, 2300]) {
  const { w, c } = fresh();
  w.ballFrozen = false;
  placeCar(c, 0, -3500, Math.PI / 2);
  w.ball.pos.x = 0;
  w.ball.pos.y = 0;
  w.ball.pos.z = 93.15;
  let hitSpeed = 0;
  let carAtHit = 0;
  run(w, 5 * TICK_RATE, (i) => {
    i.throttle = 1;
    i.boost = target > 1500 && speed(c) < 2290;
  }, () => {
    const bs = Math.hypot(w.ball.vel.x, w.ball.vel.y, w.ball.vel.z);
    if (bs > hitSpeed) {
      hitSpeed = bs;
      if (carAtHit === 0) carAtHit = speed(c);
    }
  });
  check(`hit: ball speed from car at ${target}`, hitSpeed, target === 1400 ? 1700 : 2900, target === 1400 ? 2700 : 4300, 'uu/s');
}

// 11. kickoff timing: diagonal boost to the ball
{
  const { w, c } = fresh();
  w.ballFrozen = false;
  w.ball.pos.z = 93.15;
  w.ball.pos.x = 0;
  w.ball.pos.y = 0;
  placeCar(c, -2048, -2560, Math.PI / 4);
  let tHit = -1;
  run(w, 4 * TICK_RATE, (i) => {
    i.throttle = 1;
    i.boost = true;
    // steer a touch towards the ball
    forwardOf(fw, c.quat);
    const tx = -c.pos.x, ty = -c.pos.y;
    const crossz = fw.x * ty - fw.y * tx;
    i.steer = Math.max(-1, Math.min(1, -crossz / 600));
  }, (t) => {
    if (tHit < 0 && w.ball.lastTouch === 0) tHit = t / TICK_RATE;
  });
  check('kickoff: diagonal arrival (RL ~2.3s)', tHit, 1.9, 2.9, 's');
}

// 12. goal detection
{
  const w = new World();
  w.ball.pos.y = 4000;
  w.ball.pos.z = 300;
  w.ball.vel.y = 3000;
  let goal = 0;
  for (let t = 0; t < 120 && !goal; t += 1) {
    w.advance([]);
    goal = w.goal;
  }
  check('goal: straight shot scores (+1)', goal, 1, 1);
}
{
  // a shot at the post bounces out
  const w = new World();
  w.ball.pos.x = 893 + 60;
  w.ball.pos.y = 4000;
  w.ball.pos.z = 300;
  w.ball.vel.y = 3000;
  let goal = 0;
  for (let t = 0; t < 120 && !goal; t += 1) {
    w.advance([]);
    goal = w.goal;
  }
  check('goal: post hit does not score', goal, 0, 0);
  check('goal: post hit bounces back (vy<0)', w.ball.vel.y < 0 ? 1 : 0, 1, 1);
}
{
  // a ball through the middle near the post still scores
  const w = new World();
  w.ball.pos.x = 893 - 100;
  w.ball.pos.y = 4500;
  w.ball.pos.z = 100;
  w.ball.vel.y = 2000;
  let goal = 0;
  for (let t = 0; t < 120 && !goal; t += 1) {
    w.advance([]);
    goal = w.goal;
  }
  check('goal: inside the post scores', goal, 1, 1);
}

// 13. aerial control sanity: hold pitch up after jump -> nose rises
{
  const { w, c } = fresh();
  run(w, 10, (i) => (i.jump = true));
  run(w, 20, (i) => (i.pitch = -1));
  forwardOf(fw, c.quat);
  check('air: pitch back raises the nose (fwd.z)', fw.z, 0.3, 1.01);
}

// 14. snapshot round trip is exact after quantize
{
  const { w, c } = fresh();
  w.ballFrozen = false;
  w.ball.pos.z = 500;
  run(w, 30, (i) => {
    i.throttle = 1;
    i.boost = true;
  });
  quantizeWorld(w);
  const bytes = encodeSnapshot(w, []);
  const w2 = new World();
  const meta = createDecodedMeta();
  decodeSnapshot(bytes, w2, meta);
  // step both identically and compare
  const inp = [Object.assign(emptyInput(), { throttle: 1, steer: 0.5, boost: true })];
  for (let t = 0; t < 120; t += 1) {
    w.advance(inp);
    quantizeWorld(w);
    w2.advance(inp);
    quantizeWorld(w2);
  }
  const d = Math.hypot(w.cars[0].pos.x - w2.cars[0].pos.x, w.cars[0].pos.y - w2.cars[0].pos.y) + Math.abs(w.ball.pos.z - w2.ball.pos.z);
  check('net: replay from snapshot is exact', d, 0, 1e-9);
  check('net: snapshot bytes (1 car)', bytes.byteLength, 0, 400);
}

// 15. ceiling: drive up the wall, does not stick to the ceiling for long
{
  const { w, c } = fresh();
  placeCar(c, 0, 0, 0);
  let ceilingTicks = 0;
  run(w, 8 * TICK_RATE, (i) => {
    i.throttle = 1;
    i.boost = true;
  }, () => {
    if (c.pos.z > 2150 && c.onGround) ceilingTicks += 1;
  });
  check('ceiling: no long ceiling drive (ticks)', ceilingTicks, 0, 120);
}

// 16. powerslide: a 180 at speed is quicker and tighter than plain steering
{
  const turn = (slide) => {
    const { w, c } = fresh();
    placeCar(c, 0, -3000, Math.PI / 2);
    run(w, 70, (i) => (i.throttle = 1));
    let t180 = -1;
    run(w, 4 * TICK_RATE, (i, t) => {
      i.throttle = 1;
      i.steer = 1;
      i.handbrake = slide;
    }, (t) => {
      forwardOf(fw, c.quat);
      if (t180 < 0 && fw.y < -0.98) t180 = t / TICK_RATE;
    });
    return t180;
  };
  const plain = turn(false);
  const slide = turn(true);
  check('powerslide: 180 time with slide', slide, 0.5, 1.4, 's');
  check('powerslide: faster than plain steering', plain - slide, 0.1, 5, 's');
}

// 17. fast aerial: jump, jump, boost and pull back -> height in 1.2 s
{
  const { w, c } = fresh();
  let peakAt12 = 0;
  run(w, 120, (i, t) => {
    i.boost = t > 4;
    i.jump = t < 10 || (t >= 13 && t < 16);
    i.pitch = t < 12 ? -1 : t < 17 ? 0 : t < 30 ? -0.8 : -0.25;
  }, (t) => {
    if (t <= 72) peakAt12 = Math.max(peakAt12, c.pos.z);
  });
  check('aerial: height after 1.2 s (RL fast aerial ~1000)', peakAt12, 750, 1500, 'uu');
}

// 18. bumps and demolitions
for (const [label, boost] of [['bump: at ~1400', false], ['demo: supersonic', true]]) {
  const w = new World();
  w.ballFrozen = true;
  w.ball.pos.z = -1e4;
  const a = w.cars[0];
  const b = w.cars[1];
  a.active = b.active = true;
  a.team = 0;
  b.team = 1;
  placeCar(a, 0, -3500, Math.PI / 2);
  placeCar(b, boost ? 3000 : 0, boost ? 3500 : 0, 0);
  if (boost) placeCar(a, -3500, -4000, Math.atan2(7500, 6500));
  a.boost = 100;
  let bumped = 0;
  let demo = false;
  const inp = [Object.assign(emptyInput(), { throttle: 1, boost }), emptyInput()];
  for (let t = 0; t < 6 * TICK_RATE && !demo && !bumped; t += 1) {
    w.advance(inp);
    for (let k = 0; k < w.eventCount; k += 1) {
      if (w.events[k].kind === 2) bumped = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      if (w.events[k].kind === 3) demo = true;
    }
  }
  if (boost) check(label, demo ? 1 : 0, 1, 1);
  else check(label + ' (victim speed)', bumped, 800, 1700, 'uu/s');
}

// 19. two cars spawned on the same spot push apart
{
  const w = new World();
  w.ballFrozen = true;
  w.ball.pos.z = -1e4;
  const a = w.cars[0];
  const b = w.cars[1];
  a.active = b.active = true;
  placeCar(a, 500, 500, 0);
  placeCar(b, 500, 500, 0);
  for (let t = 0; t < 30; t += 1) w.advance([]);
  check('overlap: identical spawns separate (uu apart)', Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y), 80, 400, 'uu');
}

// 20. the enclosure: random max-speed shots never escape, tunnel or go NaN
{
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let escapes = 0;
  let nan = 0;
  let maxZ = 0;
  let ceilingHits = 0;
  for (let n = 0; n < 300; n += 1) {
    const w = new World();
    const b = w.ball;
    b.pos.x = (rnd() - 0.5) * 7000;
    b.pos.y = (rnd() - 0.5) * 9000;
    b.pos.z = 150 + rnd() * 1700;
    const u = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    const sp = 3000 + rnd() * 3000;
    b.vel.x = Math.cos(a) * r * sp;
    b.vel.y = Math.sin(a) * r * sp;
    b.vel.z = Math.abs(u) * sp * (rnd() < 0.7 ? 1 : -1);
    for (let t = 0; t < 6 * TICK_RATE; t += 1) {
      w.advance([]);
      if (!Number.isFinite(b.pos.x + b.pos.y + b.pos.z)) nan += 1;
      if (b.pos.z > 2300 - 91 - 5) ceilingHits += 1;
      maxZ = Math.max(maxZ, b.pos.z);
      const inGoal = Math.abs(b.pos.x) < 893 + 5 && b.pos.z < 642 + 5 && Math.abs(b.pos.y) < 5120 + 880 + 5;
      const inArena = Math.abs(b.pos.x) < 4096 + 2 && Math.abs(b.pos.y) < 5120 + 2 && b.pos.z > 0 && b.pos.z < 2300 + 2;
      if (!inGoal && !inArena) {
        escapes += 1;
        break;
      }
      if (w.goal) break;
    }
  }
  check('enclosure: escapes in 300 random shots', escapes, 0, 0);
  check('enclosure: NaN positions', nan, 0, 0);
  check('enclosure: ball reaches the ceiling and stays under it (max z)', maxZ, 2100, 2300 - 91 + 1, 'uu');
  check('enclosure: ceiling contacts happened', ceilingHits, 1, 1e9);
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  const v = typeof r.value === 'number' ? r.value.toFixed(3) : r.value;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(52)} ${String(v).padStart(10)} ${r.unit.padEnd(5)} [${r.range}]`);
}
console.log(failed ? `\n${failed} of ${results.length} FAILED` : `\nall ${results.length} passed`);
process.exit(failed ? 1 : 0);
