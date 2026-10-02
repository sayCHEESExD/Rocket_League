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
if (fails.length) {
  console.error('SIM MATCH FAILED:', fails.join('; '));
  process.exit(1);
}
console.log('sim match ok');
