// Bot quality: a headless 3v3 for N minutes; counts touches, shots, goals per bot.
import { Match } from '../server/dist/game/Match.js';
import { MatchState, PlayerState } from '../server/dist/rooms/state/GameState.js';
import { EventKind, TICK_RATE } from '../shared/dist/index.js';
const rows = new Map(); const state = new MatchState(); let goals = 0, shots = 0, saves = 0;
const match = new Match(state, {
  player: (id) => rows.get(id),
  addBot: (id, team, car) => { const r = new PlayerState(); r.id = id; r.bot = true; r.team = team; r.car = car; rows.set(id, r); return r; },
  removeBot: (id) => rows.delete(id), snapshot() {},
  goal: () => goals++, feed: (f) => { if (f.kind === 'shot') shots++; if (f.kind === 'save') saves++; }, ended() {},
});
match.balanceBots(); match.startMatch();
const touches = new Array(16).fill(0);
const minutes = Number(process.argv[2] ?? 5);
let playTicks = 0;
for (let t = 0; t < minutes * 60 * TICK_RATE; t++) {
  match.step();
  if (state.phase === 2) playTicks++;
  const w = match.world;
  for (let k = 0; k < w.eventCount; k++) if (w.events[k].kind === EventKind.BallHit) touches[w.events[k].car]++;
}
const total = touches.reduce((a, b) => a + b, 0);
console.log(`play ${(playTicks / TICK_RATE / 60).toFixed(1)} min: touches ${total} (${(total / (playTicks / TICK_RATE / 60)).toFixed(0)}/min), shots ${shots}, saves ${saves}, goals ${goals}, score ${state.blue}-${state.orange} (match ${state.matchNo})`);
console.log('per car', touches.slice(0, 6).join(' '));
