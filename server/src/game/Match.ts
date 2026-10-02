import {
  ARENAS,
  EMOTE,
  BALL,
  BallState,
  CAR,
  EventKind,
  INPUT_QUEUE_MAX,
  KICKOFF_SPOTS,
  MATCH,
  MAX_CARS,
  POINTS,
  Phase,
  SNAPSHOT_EVERY,
  TICK_RATE,
  World,
  copyInput,
  emptyInput,
  encodeSnapshot,
  placeCar,
  predictBallGoal,
  quantizeWorld,
  type CarInput,
  type FeedMessage,
  type GoalMessage,
  type MatchEndMessage,
  type SnapshotCarMeta,
} from '@rlb/shared';
import type { MatchState, PlayerState } from '../rooms/state/GameState.js';
import { BotBrain } from './BotBrain.js';

/** What the match needs from the room, so it never touches the network itself. */
export interface MatchHost {
  player(id: string): PlayerState | undefined;
  /** Create / remove a bot's replicated row. */
  addBot(id: string, team: number, car: number): PlayerState;
  removeBot(id: string): void;
  snapshot(bytes: Uint8Array): void;
  goal(message: GoalMessage): void;
  feed(message: FeedMessage): void;
  ended(message: MatchEndMessage): void;
  /** A single-match room (a playlist) finished its results screen: everyone goes back to the lobby. */
  finished?(): void;
}

/** How a room plays: a playlist fixes the team size and plays ONE match; an open room keeps going. */
export interface MatchOptions {
  /** Cars per team (bots fill); null: open room (max(3, the bigger human side)). */
  teamSize: number | null;
  /** Play again after the results (open rooms), or finish (playlists). */
  rematch: boolean;
  /** Arena index, or null for a random one that then rotates. */
  arena: number | null;
  /**
   * Humans the lobby reserved seats for (playlists): the first kickoff waits
   * for them all (or `WAIT_SECONDS`), so nobody's match starts while they are
   * still loading - then a longer first countdown leaves room for the intro.
   */
  expect?: number;
}

/** Longest a playlist's first kickoff waits for its reserved players. */
const WAIT_SECONDS = 10;
/** Extra seconds on a playlist's first countdown: the clients' intro flight plays in them. */
const INTRO_GRACE = 2.5;

interface Seat {
  id: string;
  bot: BotBrain | null;
  /** Queued inputs (humans): oldest first. */
  queue: { seq: number; input: CarInput }[];
  /** Highest seq received, and the seq of the input currently applied. */
  received: number;
  ack: number;
  /** Ticks without a fresh input (a hidden tab, a stalled connection). */
  starved: number;
  /** Tick of the last granted respawn request (-inf: never). */
  respawnAsked: number;
}

/** Fewest ticks between two granted respawn requests from one player. */
const RESPAWN_GAP = 10 * TICK_RATE;

const BOT_NAMES = [
  'Bolt', 'Turbo', 'Sprocket', 'Nitro', 'Piston', 'Gizmo', 'Blitz', 'Comet',
  'Rumble', 'Zippy', 'Dynamo', 'Rocket', 'Spark', 'Torque', 'Chomp', 'Vortex',
];

/**
 * THE AUTHORITATIVE MATCH: one world, up to sixteen cars (humans + bots), and
 * Rocket League's flow - kickoff countdown, play (the clock starts on the
 * first touch), goal, replay, kickoff again; overtime on a tie; results.
 *
 * Humans steer ONLY through queued inputs. Everything else - car and ball
 * motion, boost, touches, goals, the score and the clock - is decided here.
 */
export class Match {
  readonly world = new World();
  private readonly seats: (Seat | null)[] = new Array<Seat | null>(MAX_CARS).fill(null);
  private readonly inputs: CarInput[] = Array.from({ length: MAX_CARS }, () => emptyInput());
  private readonly meta: SnapshotCarMeta[] = Array.from({ length: MAX_CARS }, (_, i) => ({ ack: 0, input: this.inputs[i]! }));
  private readonly prevBall = new BallState();
  private botCounter = 0;
  /** Seconds since the last kickoff whistle (bots kick off differently). */
  private sincePlay = 0;
  private touchedSinceKickoff = false;
  private pendingEnd = false;
  /** Tick of each car's last touch (an assist must be a recent pass). */
  private readonly touchTick = new Array<number>(MAX_CARS).fill(-1e9);

  constructor(
    private readonly state: MatchState,
    private readonly host: MatchHost,
    private readonly options: MatchOptions = { teamSize: null, rematch: true, arena: null },
  ) {
    this.world.resetBall();
    // a playlist match is told its arena (the lobby preloads it); an open room picks one, then rotates
    this.state.arena = options.arena ?? Math.floor(Math.random() * ARENAS.length);
  }

  get tick(): number {
    return this.world.tick;
  }

  // ------------------------------------------------------------------ seats

  private humans(team?: number): number {
    let n = 0;
    for (const s of this.seats) if (s && !s.bot && (team === undefined || this.world.cars[this.seats.indexOf(s)]!.team === team)) n += 1;
    return n;
  }

  private teamCount(team: number): number {
    let n = 0;
    for (let i = 0; i < MAX_CARS; i += 1) if (this.seats[i] && this.world.cars[i]!.team === team) n += 1;
    return n;
  }

  /**
   * Seat a human: take over a bot on the emptier side, or a fresh car. Returns the car slot.
   * `want` (the team the lobby put them on) is honoured while that side has room.
   */
  addHuman(id: string, want = -1): { car: number; team: number } {
    const blueH = this.humans(0);
    const orangeH = this.humans(1);
    const cap = this.options.teamSize;
    const room = (t: number): boolean => cap === null || this.humans(t) < cap;
    let team = blueH < orangeH ? 0 : orangeH < blueH ? 1 : this.teamCount(0) <= this.teamCount(1) ? 0 : 1;
    if ((want === 0 || want === 1) && room(want)) team = want;
    else if (!room(team)) team = 1 - team;
    if (!room(team)) return { car: -1, team };
    let slot = -1;
    for (let i = 0; i < MAX_CARS; i += 1) {
      const s = this.seats[i];
      if (s?.bot && this.world.cars[i]!.team === team) {
        this.host.removeBot(s.id);
        slot = i;
        break;
      }
    }
    if (slot < 0) slot = this.seats.indexOf(null);
    if (slot < 0) return { car: -1, team };
    const fresh = !this.seats[slot] && !this.world.cars[slot]!.active;
    this.seats[slot] = { id, bot: null, queue: [], received: 0, ack: 0, starved: 0, respawnAsked: -1e9 };
    copyInput(this.inputs[slot]!, emptyInput());
    const car = this.world.cars[slot]!;
    car.team = team;
    if (fresh || !car.active) this.spawnFresh(slot);
    this.balanceBots();
    return { car: slot, team };
  }

  removeHuman(id: string): void {
    const slot = this.seats.findIndex((s) => s?.id === id);
    if (slot < 0) return;
    this.seats[slot] = null;
    this.world.cars[slot]!.active = false;
    this.balanceBots();
  }

  /** Fill (or trim) bots so both teams field the playlist's team size (open rooms: max(minTeamSize, the bigger human side)). */
  balanceBots(): void {
    const size = Math.min(MAX_CARS / 2, this.options.teamSize ?? Math.max(MATCH.minTeamSize, this.humans(0), this.humans(1)));
    for (let team = 0; team < 2; team += 1) {
      let count = this.teamCount(team);
      while (count > size) {
        const slot = this.seats.findIndex((s, i) => !!s?.bot && this.world.cars[i]!.team === team);
        if (slot < 0) break;
        this.host.removeBot(this.seats[slot]!.id);
        this.seats[slot] = null;
        this.world.cars[slot]!.active = false;
        count -= 1;
      }
      while (count < size) {
        const slot = this.seats.indexOf(null);
        if (slot < 0) break;
        const id = `bot-${(this.botCounter += 1)}`;
        this.seats[slot] = { id, bot: new BotBrain(), queue: [], received: 0, ack: 0, starved: 0, respawnAsked: -1e9 };
        this.world.cars[slot]!.team = team;
        this.spawnFresh(slot);
        const row = this.host.addBot(id, team, slot);
        row.name = BOT_NAMES[(this.botCounter - 1) % BOT_NAMES.length]!;
        count += 1;
      }
    }
  }

  /** Put a new car in: on a kickoff spot during the countdown, else at a respawn spot. */
  private spawnFresh(slot: number): void {
    const car = this.world.cars[slot]!;
    car.active = true;
    car.boost = CAR.kickoffBoost;
    if (this.state.phase === Phase.Countdown) this.placeKickoff();
    else this.world.respawn(slot);
  }

  slotOf(id: string): number {
    return this.seats.findIndex((s) => s?.id === id);
  }

  /** Change sides (between goals only), keeping teams within one human of each other. */
  switchTeam(id: string): boolean {
    const slot = this.slotOf(id);
    if (slot < 0) return false;
    const car = this.world.cars[slot]!;
    const to = 1 - car.team;
    if (this.humans(to) + 1 > this.humans(car.team) - 1 + 1) return false;
    if (this.options.teamSize !== null && this.humans(to) >= this.options.teamSize) return false;
    // swap with a bot on the other side if there is one, else just move
    const botSlot = this.seats.findIndex((s, i) => !!s?.bot && this.world.cars[i]!.team === to);
    if (botSlot >= 0) {
      this.host.removeBot(this.seats[botSlot]!.id);
      this.seats[botSlot] = null;
      this.world.cars[botSlot]!.active = false;
    }
    car.team = to;
    this.world.respawn(slot);
    this.balanceBots();
    const row = this.host.player(id);
    if (row) row.team = to;
    return true;
  }

  /**
   * Whether a player's hands are busy with the car (steering hard, jumping or
   * boosting) - what stops an emote (`EMOTE.steerStop`).
   */
  driving(id: string): boolean {
    const slot = this.slotOf(id);
    if (slot < 0) return false;
    const input = this.inputs[slot]!;
    return Math.abs(input.steer) > EMOTE.steerStop || input.jump || input.boost;
  }

  /**
   * The portal's "respawn" for a stuck player, made fair: the car is taken off
   * exactly like a demolition and comes back at a respawn spot after the usual
   * 3 s, so it can never be a free teleport home. During play only, once per
   * `RESPAWN_GAP`; credits nobody.
   */
  requestRespawn(id: string): boolean {
    const slot = this.slotOf(id);
    if (slot < 0 || this.state.phase !== Phase.Play) return false;
    const seat = this.seats[slot]!;
    if (this.world.tick - seat.respawnAsked < RESPAWN_GAP) return false;
    const car = this.world.cars[slot]!;
    if (!car.active || car.demolished) return false;
    seat.respawnAsked = this.world.tick;
    car.demolished = true;
    car.respawnTime = Math.round(CAR.demoRespawn * TICK_RATE);
    car.boosting = false;
    return true;
  }

  /** Dev-only test hooks (see GameRoom). */
  debug(id: string, msg: unknown): void {
    const m = (msg ?? {}) as { ball?: number[]; car?: number[]; play?: boolean; bots?: boolean; clock?: number; arena?: number };
    if (typeof m.arena === 'number' && m.arena >= 0 && m.arena < ARENAS.length) this.state.arena = Math.floor(m.arena);
    if (typeof m.clock === 'number' && Number.isFinite(m.clock)) {
      this.state.clock = Math.max(0, m.clock);
      this.state.clockTick = this.world.tick;
      if (!this.state.clockRunning) this.runClock();
    }
    const w = this.world;
    const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    if (Array.isArray(m.ball)) {
      w.ball.pos.x = n(m.ball[0]);
      w.ball.pos.y = n(m.ball[1]);
      w.ball.pos.z = n(m.ball[2]) || BALL.radius;
      w.ball.vel.x = n(m.ball[3]);
      w.ball.vel.y = n(m.ball[4]);
      w.ball.vel.z = n(m.ball[5]);
      w.ball.angVel.x = 0;
      w.ball.angVel.y = 0;
      w.ball.angVel.z = 0;
    }
    const slot = this.slotOf(id);
    if (Array.isArray(m.car) && slot >= 0) {
      placeCar(w.cars[slot]!, n(m.car[0]), n(m.car[1]), n(m.car[3]));
      w.cars[slot]!.pos.z = Math.max(w.cars[slot]!.pos.z, n(m.car[2]));
      w.cars[slot]!.boost = 100;
    }
    if (m.play && this.state.phase === Phase.Countdown) this.state.phaseEnd = w.tick + 1;
    if (m.bots === false) for (const seat of this.seats) seat?.bot && (seat.bot.frozen = true);
    if (m.bots === true) for (const seat of this.seats) seat?.bot && (seat.bot.frozen = false);
  }

  // ------------------------------------------------------------------ input

  /** A client's batch of inputs. Out-of-order or stale ticks are dropped; the queue is bounded. */
  pushInputs(id: string, first: number, inputs: CarInput[]): void {
    const slot = this.slotOf(id);
    const seat = slot >= 0 ? this.seats[slot] : null;
    if (!seat || seat.bot) return;
    for (let k = 0; k < inputs.length; k += 1) {
      const seq = first + k;
      if (seq <= seat.received) continue;
      seat.received = seq;
      seat.queue.push({ seq, input: inputs[k]! });
    }
    while (seat.queue.length > INPUT_QUEUE_MAX) {
      const dropped = seat.queue.shift()!;
      const next = seat.queue[0]!;
      // never lose a press
      if (dropped.input.jump && !next.input.jump) next.input.jump = true;
    }
  }

  private takeInput(slot: number, seat: Seat): void {
    const q = seat.queue;
    if (q.length === 0) {
      // starved: hold the last input briefly, then let go of everything
      seat.starved += 1;
      if (seat.starved > 30) copyInput(this.inputs[slot]!, emptyInput());
      return;
    }
    seat.starved = 0;
    let item = q.shift()!;
    // running behind (more than a few ticks buffered): catch up by one
    if (q.length > 3) {
      const next = q.shift()!;
      if (item.input.jump && !next.input.jump && !this.inputs[slot]!.jump) next.input.jump = true;
      item = next;
    }
    copyInput(this.inputs[slot]!, item.input);
    seat.ack = item.seq;
  }

  // ------------------------------------------------------------------ flow

  private placeKickoff(): void {
    const w = this.world;
    w.resetBall();
    w.resetPads();
    // RL picks a random set of spots and mirrors it for both teams
    const order = [0, 1, 2, 3, 4].sort(() => Math.random() - 0.5);
    for (let team = 0; team < 2; team += 1) {
      const slots: number[] = [];
      for (let i = 0; i < MAX_CARS; i += 1) if (this.seats[i] && w.cars[i]!.active && w.cars[i]!.team === team) slots.push(i);
      slots.forEach((slot, k) => {
        const spot = KICKOFF_SPOTS[slots.length <= 5 ? order[k]! : k] ?? KICKOFF_SPOTS[k % KICKOFF_SPOTS.length]!;
        const s = team === 0 ? 1 : -1;
        const car = w.cars[slot]!;
        placeCar(car, spot[0] * s, spot[1] * s, team === 0 ? spot[2] : spot[2] + Math.PI);
        car.boost = CAR.kickoffBoost;
        this.seats[slot]?.bot?.reset();
      });
    }
  }

  private setPhase(phase: Phase, seconds: number): void {
    this.state.phase = phase;
    this.state.phaseEnd = seconds > 0 ? this.world.tick + Math.round(seconds * TICK_RATE) : 0;
    const w = this.world;
    w.carsFrozen = phase === Phase.Countdown || phase === Phase.Replay || phase === Phase.Ended;
    w.ballFrozen = phase !== Phase.Play;
  }

  startKickoff(extra = 0): void {
    this.placeKickoff();
    this.touchedSinceKickoff = false;
    this.setPhase(Phase.Countdown, MATCH.countdown + extra);
  }

  /** A playlist's first kickoff is on hold until its players are here (phaseEnd 0 = open-ended). */
  private waiting = false;
  private waitUntil = 0;

  startMatch(): void {
    const m = this.state;
    m.blue = 0;
    m.orange = 0;
    m.clock = MATCH.duration;
    m.clockTick = this.world.tick;
    m.clockRunning = false;
    m.overtime = false;
    m.lastGoalTeam = -1;
    this.pendingEnd = false;
    for (const seat of this.seats) {
      const row = seat ? this.host.player(seat.id) : undefined;
      if (!row) continue;
      row.score = 0;
      row.goals = 0;
      row.assists = 0;
      row.saves = 0;
      row.shots = 0;
      row.demos = 0;
    }
    if ((this.options.expect ?? 0) > 0 && m.matchNo === 1) {
      // everyone placed for the kickoff, frozen, until the lobby's players have all arrived
      this.waiting = true;
      this.waitUntil = this.world.tick + WAIT_SECONDS * TICK_RATE;
      this.placeKickoff();
      this.touchedSinceKickoff = false;
      this.setPhase(Phase.Countdown, 0);
      return;
    }
    this.startKickoff();
  }

  private clockNow(): number {
    const m = this.state;
    if (!m.clockRunning) return m.clock;
    const dt = (this.world.tick - m.clockTick) / TICK_RATE;
    return m.overtime ? m.clock + dt : m.clock - dt;
  }

  private freezeClock(): void {
    const m = this.state;
    m.clock = Math.max(0, this.clockNow());
    m.clockTick = this.world.tick;
    m.clockRunning = false;
  }

  private runClock(): void {
    const m = this.state;
    m.clockTick = this.world.tick;
    m.clockRunning = true;
  }

  // ------------------------------------------------------------------ tick

  step(): void {
    const w = this.world;
    const m = this.state;
    if (this.waiting && (this.humans() >= (this.options.expect ?? 0) || w.tick >= this.waitUntil)) {
      this.waiting = false;
      this.startKickoff(INTRO_GRACE);
    }
    const kickoff = m.phase === Phase.Play && !this.touchedSinceKickoff;
    for (let i = 0; i < MAX_CARS; i += 1) {
      const seat = this.seats[i];
      if (!seat) continue;
      if (seat.bot) seat.bot.think(w, i, kickoff || m.phase === Phase.Countdown, this.inputs[i]!);
      else this.takeInput(i, seat);
      this.meta[i]!.ack = seat.ack;
    }
    this.prevBall.copyFrom(w.ball);
    w.advance(this.inputs);
    quantizeWorld(w);
    this.sincePlay += 1 / TICK_RATE;

    this.books();

    // phase timers
    const ends = m.phaseEnd > 0 && w.tick >= m.phaseEnd;
    switch (m.phase) {
      case Phase.Countdown:
        if (ends) {
          this.setPhase(Phase.Play, 0);
          this.sincePlay = 0;
        }
        break;
      case Phase.Play: {
        if (w.goal !== 0) {
          this.scoreGoal(w.goal);
          break;
        }
        if (m.clockRunning && !m.overtime && this.clockNow() <= 0) {
          this.freezeClock();
          m.clock = 0;
          if (m.blue === m.orange) {
            m.overtime = true;
            this.runClock();
            this.host.feed({ kind: 'epic', a: '', b: '', text: 'OVERTIME!' });
          } else {
            this.pendingEnd = true;
          }
        }
        // at 0:00 the match ends when the ball next touches the ground
        if (this.pendingEnd && w.ball.pos.z < BALL.radius + 30 && Math.abs(w.ball.vel.z) < 400) this.endMatch();
        break;
      }
      case Phase.Goal:
        if (ends) this.setPhase(Phase.Replay, MATCH.replay);
        break;
      case Phase.Replay:
        if (ends) {
          if (m.overtime || this.pendingEnd) this.endMatch();
          else this.startKickoff();
        }
        break;
      case Phase.Ended:
        if (ends && !this.options.rematch) {
          // a playlist plays one match: hold here and send everyone back to the lobby
          this.state.phaseEnd = 0;
          this.host.finished?.();
        } else if (ends) {
          m.matchNo += 1;
          m.arena = (m.arena + 1) % ARENAS.length;
          this.startMatch();
        }
        break;
    }

    // 30 Hz for normal lobbies; 20 Hz once there are more than eight cars (bandwidth grows with cars)
    let cars = 0;
    for (let i = 0; i < MAX_CARS; i += 1) if (w.cars[i]!.active) cars += 1;
    const every = cars > 8 ? SNAPSHOT_EVERY + 1 : SNAPSHOT_EVERY;
    if (w.tick % every === 0) this.host.snapshot(encodeSnapshot(w, this.meta));
  }

  /** Touches, shots, saves, demos - from this tick's events. */
  private books(): void {
    const w = this.world;
    let touched = -1;
    for (let k = 0; k < w.eventCount; k += 1) {
      const e = w.events[k]!;
      if (e.kind === EventKind.BallHit) {
        touched = e.car;
        this.touchTick[e.car] = w.tick;
      }
      if (e.kind === EventKind.Demo) {
        const a = this.rowOf(e.car);
        const b = this.rowOf(e.other);
        if (a && w.cars[e.car]!.team !== w.cars[e.other]!.team) {
          a.demos += 1;
          a.score += POINTS.demo;
        }
        this.host.feed({ kind: 'demo', a: a?.name ?? '', b: b?.name ?? '', text: 'DEMOLITION' });
      }
    }
    if (touched < 0 || this.state.phase !== Phase.Play) return;
    if (!this.touchedSinceKickoff) {
      this.touchedSinceKickoff = true;
      if (!this.state.clockRunning) this.runClock();
    }
    const row = this.rowOf(touched);
    const team = w.cars[touched]!.team;
    const own = team === 0 ? -1 : 1;
    const before = predictBallGoal(this.prevBall, 3);
    const after = predictBallGoal(w.ball, 3);
    if (row) row.score += POINTS.touch;
    if (before === own && after !== own) {
      if (row) {
        row.saves += 1;
        row.score += POINTS.save;
      }
      const speed = Math.hypot(this.prevBall.vel.x, this.prevBall.vel.y, this.prevBall.vel.z);
      this.host.feed({ kind: 'save', a: row?.name ?? '', b: '', text: speed > 2200 ? 'EPIC SAVE!' : 'SAVE!' });
    } else if (after === -own && before !== -own) {
      if (row) {
        row.shots += 1;
        row.score += POINTS.shot;
      }
      this.host.feed({ kind: 'shot', a: row?.name ?? '', b: '', text: 'SHOT ON GOAL' });
    }
  }

  private rowOf(slot: number): PlayerState | undefined {
    const seat = slot >= 0 ? this.seats[slot] : null;
    return seat ? this.host.player(seat.id) : undefined;
  }

  private scoreGoal(side: number): void {
    const w = this.world;
    const m = this.state;
    const team = side > 0 ? 0 : 1;
    const b = w.ball;
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    if (team === 0) m.blue += 1;
    else m.orange += 1;
    m.lastGoalTeam = team;
    this.freezeClock();
    let scorer = '';
    let assist = '';
    let ownGoal = false;
    const last = this.rowOf(b.lastTouch);
    if (last && b.lastTouchTeam === team) {
      scorer = last.name;
      last.goals += 1;
      last.score += POINTS.goal;
      const prev = this.rowOf(b.prevTouch);
      const recent = w.tick - (this.touchTick[b.prevTouch] ?? -1e9) < 5 * TICK_RATE;
      if (prev && recent && b.prevTouch !== b.lastTouch && w.cars[b.prevTouch]?.team === team) {
        assist = prev.name;
        prev.assists += 1;
        prev.score += POINTS.assist;
      }
    } else if (last) {
      scorer = last.name;
      ownGoal = true;
    }
    this.host.goal({ team, scorer, assist, speed, tick: w.tick, side, ownGoal });
    this.setPhase(Phase.Goal, MATCH.goalLinger);
  }

  private endMatch(): void {
    const m = this.state;
    this.freezeClock();
    this.pendingEnd = false;
    const winner = m.blue > m.orange ? 0 : m.orange > m.blue ? 1 : -1;
    const rows: MatchEndMessage['rows'] = [];
    for (let i = 0; i < MAX_CARS; i += 1) {
      const seat = this.seats[i];
      const row = seat ? this.host.player(seat.id) : undefined;
      if (!row) continue;
      rows.push({
        id: row.id,
        name: row.name,
        team: row.team,
        score: row.score,
        goals: row.goals,
        assists: row.assists,
        saves: row.saves,
        shots: row.shots,
        demos: row.demos,
        bot: row.bot,
      });
    }
    rows.sort((a, b) => b.score - a.score);
    const mvp = rows.find((r) => r.team === winner)?.id ?? rows[0]?.id ?? '';
    this.host.ended({ winner, blue: m.blue, orange: m.orange, mvp, rows });
    this.setPhase(Phase.Ended, MATCH.results);
  }
}
