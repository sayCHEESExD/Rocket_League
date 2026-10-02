/**
 * The lobby and its playlists, end to end against a running server
 * (`npm run dev`): join the lobby, walk, get bounded, queue for 1v1 / 3v3,
 * receive a seat reservation, take it, and land in a match room of the right
 * size on the team the lobby picked; the live-matches board lists it; the 16th
 * person is refused from a full lobby.
 */
import { Client } from 'colyseus.js';

const URL = process.env.SERVER ?? 'ws://localhost:2880';
let failures = 0;
const check = (ok, message) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms, step = 50) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return fn();
};

const join = async (name, roomId) => {
  const c = new Client(URL);
  const opts = { identity: { displayName: name, avatarUrl: '' }, car: 2 };
  // a fresh lobby of our own (a browser tab may be sitting in the shared one)
  const room = roomId ? await c.joinById(roomId, opts) : await c.create('lobby', opts);
  const found = [];
  room.onMessage('matchFound', (m) => found.push(m));
  room.onMessage('*', () => undefined);
  return { c, room, found };
};

console.log('\nLobby');
const a = await join('Alpha');
const lobbyId = a.room.roomId;
const b = await join('Bravo', lobbyId);
await until(() => a.room.state.players?.size === 2, 3000);
check(a.room.state.players.size === 2, 'two people in one lobby, each sees both');
check(a.room.state.queues.size === 3, 'three playlists: ' + [...a.room.state.queues.keys()].join(', '));

const start = a.room.state.players.get(a.room.sessionId);
const gx = start.x + 1.2;
const gz = start.z;
a.room.send('move', [gx, 0, gz, 1, 1]);
await sleep(300);
const me = () => b.room.state.players.get(a.room.sessionId);
check(Math.abs(me().x - gx) < 0.01 && me().anim === 1, 'a walk is relayed to the others');
a.room.send('move', [200, 0, 0, 0, 1]);
await sleep(300);
check(Math.abs(me().x - gx) < 0.01, 'a teleport (faster than a sprint) is refused');

console.log('\n1v1');
a.room.send('queue', '1v1');
b.room.send('queue', '1v1');
await until(() => a.found.length && b.found.length, 5000);
check(a.found.length === 1 && b.found.length === 1, 'a full 1v1 queue starts at once: both get a seat reservation');
const fa = a.found[0];
const fb = b.found[0];
check(fa && fb && fa.mode === '1v1' && fa.team !== fb.team && fa.arena === fb.arena, 'same playlist and arena, opposite teams');
let matchA;
let matchB;
if (fa && fb) {
  matchA = await a.c.consumeSeatReservation(fa.reservation);
  matchA.onMessage('*', () => undefined);
  await until(() => matchA.state.match, 2000);
  await sleep(400);
  check(matchA.state.match.phase === 1 && matchA.state.match.phaseEnd === 0, 'the first kickoff waits for every reserved player (no countdown with one of two in)');
  matchB = await b.c.consumeSeatReservation(fb.reservation);
  await until(() => matchA.state.match.phaseEnd > 0, 2000);
  check(matchA.state.match.phaseEnd > 0, 'both in: the countdown (with room for the intro) starts');
  for (const r of [matchA, matchB]) r.onMessage('*', () => undefined);
  await until(() => matchA.state.players && [...matchA.state.players.values()].filter((p) => !p.bot).length === 2 && [...matchA.state.players.values()].filter((p) => p.car >= 0).length === 2, 3000);
  check(matchA.roomId === matchB.roomId, 'both reservations land in the same match room');
  const humans = [...matchA.state.players.values()].filter((p) => !p.bot);
  const pa = matchA.state.players.get(matchA.sessionId);
  check(humans.length === 2 && [...matchA.state.players.values()].filter((p) => p.car >= 0).length === 2, '1v1: two cars, no bots');
  check(pa && pa.team === fa.team && pa.name === 'Alpha' && pa.body === 2, 'seated on the lobby\'s team, with their name and car');
  let refused = false;
  try {
    await new Client(URL).joinById(matchA.roomId, {});
  } catch {
    refused = true;
  }
  check(refused, 'a 1v1 room holds two people');
  await sleep(2600);
  const board = [...a.room.state.matches];
  check(board.some((m) => m.roomId === matchA.roomId && m.mode === '1v1' && m.blueNames.includes('Alpha') !== m.orangeNames.includes('Alpha')), 'the lobby board lists the live 1v1 with both teams');
}

console.log('\n3v3 with one player');
const c3 = await join('Charlie', lobbyId);
c3.room.send('queue', '3v3');
await sleep(800);
const q = a.room.state.queues.get('3v3');
check(q.count === 1 && q.needed === 6 && q.startsIn > 5, `a lone player waits for company (${q.count}/${q.needed}, starts in ${q.startsIn.toFixed(1)} s)`);
await until(() => c3.found.length, 13000, 200);
check(c3.found.length === 1, 'after the fill wait the match starts anyway');
if (c3.found[0]) {
  const m3 = await c3.c.consumeSeatReservation(c3.found[0].reservation);
  m3.onMessage('*', () => undefined);
  await until(() => m3.state.players && [...m3.state.players.values()].filter((p) => p.car >= 0).length === 6, 3000);
  const cars = [...(m3.state.players?.values() ?? [])].filter((p) => p.car >= 0);
  check(cars.length === 6 && cars.filter((p) => p.bot).length === 5, '3v3: six cars, five of them bots');
  m3.leave();
}

console.log('\nCapacity');
const crowd = [];
for (let i = 0; i < 12; i += 1) crowd.push(await join(`P${i}`, lobbyId));
let sixteenth = false;
try {
  await join('Sixteen', lobbyId);
} catch {
  sixteenth = true;
}
check(sixteenth, 'a lobby holds 15 (the 16th is refused)');

for (const p of [a, b, c3, ...crowd]) p.room.leave();
matchA?.leave();
matchB?.leave();
await sleep(300);
console.log(failures === 0 ? '\nlobby OK' : `\n${failures} lobby check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
