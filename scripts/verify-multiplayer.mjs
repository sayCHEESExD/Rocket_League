// Multiplayer check against a RUNNING server (npm run dev):
//   15 clients join one room, drive with random inputs for a while; the 16th is refused;
//   malformed inputs must not crash anything; reports snapshot rate, bandwidth and tick cost.
import { Client } from 'colyseus.js';

const URL = process.env.SERVER ?? 'ws://localhost:2880';
const HTTP = URL.replace(/^ws/, 'http');
const N = Number(process.env.N ?? 15);
const SECONDS = Number(process.env.SECONDS ?? 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.error('FAIL', m); process.exitCode = 1; };

const clients = [];
let roomId = '';
for (let i = 0; i < N; i += 1) {
  const c = new Client(URL);
  const opts = { identity: { displayName: `Tester ${i + 1}`, avatarUrl: '' } };
  const room = roomId ? await c.joinById(roomId, opts) : await c.create('rocketleague', opts);
  roomId = room.roomId;
  const s = { room, snaps: 0, bytes: 0, seq: 0, t0: 0 };
  room.onMessage('snap', (b) => { s.snaps += 1; s.bytes += b.byteLength; });
  for (const t of ['goal', 'feed', 'matchEnd', 'pong']) room.onMessage(t, () => {});
  clients.push(s);
}
console.log(`joined ${clients.length} clients into ${roomId}`);
await sleep(800);
const humans = [...clients[0].room.state.players.values()].filter((p) => !p.bot);
const cars = new Set(humans.map((p) => p.car));
if (humans.length !== N) fail(`expected ${N} humans in state, saw ${humans.length}`);
if (cars.size !== N || cars.has(-1)) fail(`every human needs its own car (got ${[...cars].join(',')})`);
const teams = [0, 1].map((t) => humans.filter((p) => p.team === t).length);
if (Math.abs(teams[0] - teams[1]) > 1) fail(`teams unbalanced ${teams}`);
console.log(`teams ${teams[0]} v ${teams[1]}, bots ${[...clients[0].room.state.players.values()].filter((p) => p.bot).length}`);

// 16th must be refused
if (N >= 15) {
  try {
    await new Client(URL).joinById(roomId, {});
    fail('a 16th player got in');
  } catch {
    console.log('16th player refused: ok');
  }
}

// drive: random-ish inputs at ~60 Hz, plus junk from one client
for (const s of clients) s.t0 = Date.now();
const start = Date.now();
const timer = setInterval(() => {
  const t = (Date.now() - start) / 1000;
  clients.forEach((s, i) => {
    s.seq += 1;
    const steer = Math.round(Math.sin(t * 0.7 + i) * 127);
    const jump = Math.sin(t * 2 + i * 3) > 0.95 ? 1 : 0;
    const boost = Math.sin(t * 0.5 + i) > 0.3 ? 2 : 0;
    s.room.send('in', [s.seq, 1, 127, steer, 0, steer, 0, jump | boost]);
  });
}, 1000 / 60);
// forgeries from the last client
const bad = clients[N - 1].room;
const junk = [null, 'x', [], [1], [1, 99], [-5, 1, 1, 1, 1, 1, 1, 1], [1e12, 1, 'a', {}, NaN, 1e9, -1e9, 255], { a: 1 }, [2, 1, 1e308, -1e308, 0, 0, 0, 7]];
for (const j of junk) bad.send('in', j);
bad.send('setIdentity', { displayName: 'x'.repeat(500), avatarUrl: 'javascript:alert(1)' });
bad.send('setAvatar', { appearance: { hatId: { evil: true } }, proportions: { height: 1e9 } });
bad.send('quickChat', 9999);
await sleep(SECONDS * 1000);
clearInterval(timer);

const secs = (Date.now() - clients[0].t0) / 1000;
const rates = clients.map((s) => s.snaps / secs);
const kbps = clients.map((s) => s.bytes / secs / 1024);
console.log(`snapshots/s per client: min ${Math.min(...rates).toFixed(1)} max ${Math.max(...rates).toFixed(1)}`);
console.log(`download per client: ${Math.max(...kbps).toFixed(1)} KB/s (avg snapshot ${(clients[0].bytes / clients[0].snaps).toFixed(0)} B)`);
if (Math.min(...rates) < (N > 8 ? 18 : 27)) fail('snapshot rate too low');
const nameRow = [...clients[0].room.state.players.values()].find((p) => p.id === bad.sessionId);
if (!nameRow || nameRow.name.length > 24) fail(`identity not sanitised: ${nameRow?.name?.length}`);
if (nameRow && nameRow.avatarUrl) fail('portrait from a foreign origin accepted');
const health = await (await fetch(`${HTTP}/health`)).json();
console.log('health', JSON.stringify(health));
const room = health.ticks?.find((r) => r.id === roomId);
if (room) {
  console.log(`server tick: avg ${room.tickMs} ms, worst ${room.tickMax} ms (budget 16.7 ms) with ${room.clients} clients`);
  if (room.tickMs > 6) fail('tick too expensive');
}
for (const s of clients) await s.room.leave();
await sleep(500);
console.log(process.exitCode ? 'MULTIPLAYER CHECK FAILED' : 'multiplayer check passed');
process.exit();
