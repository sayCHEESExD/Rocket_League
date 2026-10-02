// Headless 3v3 bot match on the real server Match logic: flow + bot sanity.
import { Match } from '../server/dist/game/Match.js';
import { MatchState, PlayerState } from '../server/dist/rooms/state/GameState.js';
import { Phase, TICK_RATE } from '../shared/dist/index.js';

const rows = new Map();
const log = [];
let snaps = 0, bytes = 0;
const state = new MatchState();
const match = new Match(state, {
  player: (id) => rows.get(id),
  addBot: (id, team, car) => { const r = new PlayerState(); r.id = id; r.bot = true; r.team = team; r.car = car; rows.set(id, r); return r; },
  removeBot: (id) => rows.delete(id),
  snapshot: (b) => { snaps++; bytes += b.byteLength; },
  goal: (g) => log.push(`${(match.tick / TICK_RATE).toFixed(1)}s GOAL ${g.team ? 'ORANGE' : 'BLUE'} by ${g.scorer}${g.assist ? ' (assist ' + g.assist + ')' : ''} ${g.speed.toFixed(0)}uu/s${g.ownGoal ? ' OWN GOAL' : ''}`),
  feed: (f) => log.push(`${(match.tick / TICK_RATE).toFixed(1)}s ${f.text} ${f.a}`),
  ended: (e) => log.push(`${(match.tick / TICK_RATE).toFixed(1)}s END ${e.blue}-${e.orange} mvp ${e.mvp}`),
});
match.balanceBots();
match.startMatch();
const minutes = Number(process.argv[2] ?? 6);
const t0 = performance.now();
let phases = {};
for (let t = 0; t < minutes * 60 * TICK_RATE; t++) { match.step(); phases[state.phase] = (phases[state.phase] ?? 0) + 1; }
const ms = performance.now() - t0;
console.log(log.slice(0, 60).join('\n'));
console.log(`\nticks ${match.tick} in ${ms.toFixed(0)}ms (${(ms / match.tick * 1000).toFixed(1)}us/tick), snapshots ${snaps}, avg ${(bytes / snaps).toFixed(0)} B, ${((bytes / snaps) * 30 / 1024).toFixed(1)} KB/s`);
console.log('score', state.blue, '-', state.orange, 'clock', state.clock.toFixed(1), 'phase ticks', JSON.stringify(phases));
for (const r of rows.values()) console.log(r.name.padEnd(10), 'team', r.team, 'score', r.score, 'g', r.goals, 'a', r.assists, 'sv', r.saves, 'sh', r.shots, 'demo', r.demos);
// CI gates: the match must actually have been played, and the flow must have cycled.
const fails = [];
if (!(phases[2] > minutes * 60 * TICK_RATE * 0.5)) fails.push('less than half the time in play');
if (!(phases[1] > 0)) fails.push('no kickoff countdown');
if (bytes / snaps > 2000) fails.push('snapshots unexpectedly large');

// A car stranded on its roof is put back on its wheels after ~5 s (and not before).
{
  const r2 = new Map();
  const st2 = new MatchState();
  const m2 = new Match(st2, {
    player: (id) => r2.get(id),
    addBot: (id, team, car) => { const r = new PlayerState(); r.id = id; r.bot = true; r.team = team; r.car = car; r2.set(id, r); return r; },
    removeBot: (id) => r2.delete(id),
    snapshot: () => undefined, goal: () => undefined, feed: () => undefined, ended: () => undefined,
  });
  m2.balanceBots();
  m2.startMatch();
  while (st2.phase !== Phase.Play) m2.step();
  m2.debug('', { bots: false });
  const car = m2.world.cars[0];
  // upside down (half a turn about the car's forward axis), resting on the floor far from the ball
  Object.assign(car.pos, { x: 2500, y: -3000, z: 40 });
  Object.assign(car.vel, { x: 0, y: 0, z: 0 });
  Object.assign(car.angVel, { x: 0, y: 0, z: 0 });
  Object.assign(car.quat, { x: 1, y: 0, z: 0, w: 0 });
  const upZ = () => 1 - 2 * (car.quat.x * car.quat.x + car.quat.y * car.quat.y);
  for (let t = 0; t < 4 * TICK_RATE; t++) m2.step();
  const at4 = upZ();
  for (let t = 0; t < 2 * TICK_RATE; t++) m2.step();
  const at6 = upZ();
  console.log(`stranded car: up.z after 4 s ${at4.toFixed(2)}, after 6 s ${at6.toFixed(2)}`);
  if (!(at4 < 0.45)) fails.push('a stranded car was reset too early (or never ended up stranded)');
  if (!(at6 > 0.9)) fails.push('a car on its roof was not put back on its wheels within ~5 s');
}
if (fails.length) {
  console.error('SIM MATCH FAILED:', fails.join('; '));
  process.exit(1);
}
console.log('sim match ok');
