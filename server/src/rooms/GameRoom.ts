import { Client, Room } from '@colyseus/core';
import {
  ARENAS,
  EMOTE,
  modeById,
  Phase,
  isBloxityEmoteId,
  INPUT_BYTES,
  MAX_PLAYERS_PER_ROOM,
  MessageType,
  QUICK_CHATS,
  CAR_COUNT,
  STATE_PATCH_MS,
  TICK_RATE,
  emptyInput,
  sanitizeAppearance,
  sanitizeIdentity,
  sanitizeProportions,
  unpackInput,
  type CarInput,
  type FeedMessage,
  type GoalMessage,
  type MatchEndMessage,
  type SetAuthMessage,
  type SetAvatarMessage,
  type SetIdentityMessage,
} from '@rlb/shared';
import { verifyGameToken } from '../auth/BloxityAuth.js';
import { careers, type Career } from '../bloxity/careers.js';
import { reportIdentityOf, statRegistry, statValuesOf } from '../bloxity/statReporter.js';
import { Match } from '../game/Match.js';
import { logger } from '../util/logger.js';
import { GameState, PlayerState } from './state/GameState.js';

const SCOPE = 'GameRoom';

/** Longest token accepted. Bloxity's are a few hundred bytes. */
const MAX_TOKEN_LENGTH = 4096;
/** Most input ticks one message may carry. */
const MAX_BATCH = 12;
/** Seconds between two quick chats from one player. */
const CHAT_GAP_TICKS = TICK_RATE * 1.5;

interface JoinOptions {
  token?: string | null;
  car?: number;
  avatar?: SetAvatarMessage;
  identity?: SetIdentityMessage;
  /** The team the lobby put this player on (playlists). */
  team?: number;
}

/** How the room was made: by the lobby for a playlist (mode, arena), or plain (an open room, as before). */
interface CreateOptions {
  mode?: string;
  arena?: number;
  /** How many players the lobby reserved seats for (the first kickoff waits for them). */
  expect?: number;
  /** The bots' handles per team, as the lobby announced them. */
  botNames?: [unknown, unknown];
}

/** Bot handles from the lobby: short plain strings only. */
const cleanNames = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((n): n is string => typeof n === 'string').map((n) => n.replace(/[^\w .-]/g, '').slice(0, 20)).filter(Boolean).slice(0, 8) : [];

/**
 * The authoritative room: one Rocket League match for up to 15 humans, bots
 * filling the empty seats.
 *
 * The one hard rule: nothing a client sends is copied into the world. An
 * Input is a stick and some buttons that the server simulates; a name or an
 * avatar is sanitised and is never read by the simulation.
 */
export class GameRoom extends Room<GameState> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  /** Live rooms in this process, for /health. */
  static readonly live = new Set<GameRoom>();
  override autoDispose = true;

  private match!: Match;
  private loop: ReturnType<typeof setInterval> | undefined;
  /** Average / worst simulation tick cost (ms), reported on /health. */
  tickMs = 0;
  tickMax = 0;
  private readonly scratch: CarInput[] = Array.from({ length: MAX_BATCH }, () => emptyInput());

  /** The playlist this room plays ('' : an open room - up to 15 humans, matches back to back). */
  mode = '';
  private metaKey = '';

  override onCreate(options: CreateOptions = {}): void {
    this.state = new GameState();
    this.setPatchRate(STATE_PATCH_MS);
    const mode = modeById(options.mode);
    const arena = typeof options.arena === 'number' && Number.isInteger(options.arena) && options.arena >= 0 && options.arena < ARENAS.length ? options.arena : null;
    if (mode) {
      this.mode = mode.id;
      this.maxClients = mode.teamSize * 2;
      // the lobby's players arrive with reserved seats while their client preloads the arena
      this.setSeatReservationTime(30);
    }

    this.match = new Match(this.state.match, {
      player: (id) => this.state.players.get(id),
      addBot: (id, team, car) => {
        const row = new PlayerState();
        row.id = id;
        row.bot = true;
        row.team = team;
        row.car = car;
        row.body = Math.floor(Math.random() * CAR_COUNT);
        this.state.players.set(id, row);
        return row;
      },
      removeBot: (id) => {
        this.state.players.delete(id);
      },
      snapshot: (bytes) => this.broadcast(MessageType.Snapshot, bytes),
      goal: (message: GoalMessage) => this.broadcast(MessageType.Goal, message),
      feed: (message: FeedMessage) => this.broadcast(MessageType.Feed, message),
      ended: (message: MatchEndMessage) => {
        this.broadcast(MessageType.MatchEnd, message);
        this.commitMatch(message);
      },
      finished: () => {
        // a playlist is one match: results over, back to the lobby (then the room empties and goes)
        this.broadcast(MessageType.ToLobby, {});
        this.clock.setTimeout(() => void this.disconnect(), 1500);
      },
    }, mode
      ? {
          teamSize: mode.teamSize,
          rematch: false,
          arena,
          expect: Math.min(mode.teamSize * 2, Math.max(0, Math.floor(Number(options.expect) || 0))),
          botNames: [cleanNames(options.botNames?.[0]), cleanNames(options.botNames?.[1])],
        }
      : { teamSize: null, rematch: true, arena });
    this.match.balanceBots();
    this.match.startMatch();

    this.onMessage(MessageType.Input, (client, message: unknown) => this.onInput(client, message));
    this.onMessage(MessageType.Ping, (client, message: unknown) => {
      client.send(MessageType.Pong, typeof message === 'number' ? message : 0);
    });
    this.onMessage('rtt', (client, ms: unknown) => {
      const row = this.state.players.get(client.sessionId);
      if (row && typeof ms === 'number' && Number.isFinite(ms)) row.ping = Math.max(0, Math.min(999, Math.round(ms)));
    });
    this.onMessage(MessageType.SetIdentity, (client, message: SetIdentityMessage) => {
      const row = this.state.players.get(client.sessionId);
      if (row) this.applyIdentity(row, message);
    });
    this.onMessage(MessageType.SetAvatar, (client, message: SetAvatarMessage) => {
      const row = this.state.players.get(client.sessionId);
      if (row) this.applyAvatar(row, message);
    });
    this.onMessage(MessageType.SetAuth, (client, message: SetAuthMessage) => {
      void this.verify(client.sessionId, message?.token ?? null);
    });
    // Dev only (RL_DEBUG=1, set by `npm run dev`): place the ball / your car for testing.
    if (process.env['RL_DEBUG'] === '1') {
      this.onMessage('dbg', (client, m: unknown) => this.match.debug(client.sessionId, m));
      logger.warn(SCOPE, 'RL_DEBUG is on: debug commands accepted');
    }
    this.onMessage(MessageType.SetCar, (client, body: unknown) => {
      const row = this.state.players.get(client.sessionId);
      if (row && typeof body === 'number' && Number.isInteger(body) && body >= 0 && body < CAR_COUNT) row.body = body;
    });
    this.onMessage(MessageType.SwitchTeam, (client) => {
      this.match.switchTeam(client.sessionId);
    });
    this.onMessage(MessageType.QuickChat, (client, index: unknown) => {
      const row = this.state.players.get(client.sessionId);
      if (!row || typeof index !== 'number' || !Number.isInteger(index)) return;
      if (index < 0 || index >= QUICK_CHATS.length) return;
      if (this.match.tick - row.chatTick < CHAT_GAP_TICKS && row.chat >= 0) return;
      row.chat = index;
      row.chatTick = this.match.tick;
      this.broadcast(MessageType.Feed, { kind: 'chat', a: row.name, b: String(row.team), text: QUICK_CHATS[index]! } satisfies FeedMessage);
    });
    // A Bloxity emote the portal sent this player: checked for SHAPE only (never ownership), spam
    // guarded, then replicated as (id, start tick) so every screen plays the same frame.
    this.onMessage(MessageType.Emote, (client, message: unknown) => {
      const row = this.state.players.get(client.sessionId);
      const id = message && typeof message === 'object' ? (message as { id?: unknown }).id : undefined;
      if (!row || row.car < 0 || !isBloxityEmoteId(id)) return;
      if (row.emote && this.match.tick - row.emoteTick < EMOTE.minGapTicks) return;
      row.emote = id.toLowerCase();
      row.emoteTick = this.match.tick;
    });
    this.onMessage(MessageType.Respawn, (client) => {
      this.match.requestRespawn(client.sessionId);
    });

    // A real-time fixed step. Colyseus' setSimulationInterval is a plain setInterval, which
    // Node rounds to whole milliseconds (~58.8 Hz for 16.67 ms) - clients produce inputs at a
    // true 60 Hz, so the input queues would overflow and every merge would show up as a
    // one-tick correction on the player's own car.
    let last = performance.now();
    let acc = 0;
    this.loop = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      if (acc > 250) acc = 250; // a stalled process does not fast-forward the match
      while (acc >= 1000 / TICK_RATE) {
        acc -= 1000 / TICK_RATE;
        const t0 = performance.now();
        this.match.step();
        this.clearEmotes();
        // a new match has started (its stats were reset): nobody's current match is credited yet
        if (this.committed.size && this.state.match.phase !== Phase.Ended) this.committed.clear();
        if (this.match.tick % TICK_RATE === 0) {
          this.publishLive();
          this.botPings();
        }
        const ms = performance.now() - t0;
        this.tickMs = this.tickMs * 0.98 + ms * 0.02;
        this.tickMax = Math.max(this.tickMax, ms);
      }
    }, 4);
    this.setMetadata({ game: 'rocket-league' });
    this.unregisterStats = statRegistry.addSource(() => this.statRows());
    GameRoom.live.add(this);
    logger.info(SCOPE, `room ${this.roomId} created (capacity ${MAX_PLAYERS_PER_ROOM})`);
  }

  // ------------------------------------------------------------------ career stats

  /** Verified Bloxity account per session (signed-in players only). */
  private readonly accounts = new Map<string, string>();
  /** Sessions whose current match is already credited (between the final whistle and the next kickoff). */
  private readonly committed = new Set<string>();
  private unregisterStats: (() => void) | null = null;

  /** This room's signed-in players, as stat rows (read at flush time from the career store). */
  private *statRows(): Iterable<{ userId: string; values: Record<string, number> }> {
    for (const accountId of this.accounts.values()) {
      const userId = reportIdentityOf(accountId);
      const career = careers.current(accountId);
      if (userId && career) yield { userId, values: statValuesOf(career) };
    }
  }

  /** The final whistle: every signed-in player's match goes on their career, from the server's own rows. */
  private commitMatch(m: MatchEndMessage): void {
    for (const row of m.rows) {
      if (row.bot) continue;
      const accountId = this.accounts.get(row.id);
      this.committed.add(row.id);
      if (!accountId) continue;
      void careers.add(accountId, {
        goals: row.goals,
        assists: row.assists,
        saves: row.saves,
        shots: row.shots,
        demos: row.demos,
        points: row.score,
        matches: 1,
        wins: m.winner >= 0 && row.team === m.winner ? 1 : 0,
        mvps: row.id === m.mvp ? 1 : 0,
      });
    }
  }

  /** A signed-in player leaving mid-match keeps what they earned (no match, win or MVP), and is reported once more. */
  private commitLeaver(sessionId: string): void {
    const accountId = this.accounts.get(sessionId);
    this.accounts.delete(sessionId);
    if (!accountId) return;
    const row = this.state.players.get(sessionId);
    const report = (career: Career | null | undefined): void => {
      if (career) statRegistry.depart(reportIdentityOf(accountId), statValuesOf(career));
    };
    if (!row || this.committed.has(sessionId)) {
      report(careers.current(accountId));
      return;
    }
    void careers.add(accountId, { goals: row.goals, assists: row.assists, saves: row.saves, shots: row.shots, demos: row.demos, points: row.score }).then(report);
  }

  /**
   * The match as the lobby board shows it (mode, score, clock, who is on which side), in the
   * room's matchmaker metadata - which the lobby reads with matchMaker.query once a second.
   * Written only when it changed.
   */
  private publishLive(): void {
    const m = this.state.match;
    const names: [string[], string[]] = [[], []];
    this.state.players.forEach((p) => {
      if (p.car >= 0 && (p.team === 0 || p.team === 1)) names[p.team]!.push(p.name);
    });
    const elapsed = m.clockRunning ? (this.match.tick - m.clockTick) / TICK_RATE : 0;
    const clock = Math.max(0, Math.round(m.overtime ? m.clock + elapsed : m.clock - elapsed));
    const meta = {
      game: 'rocket-league',
      mode: this.mode,
      arena: m.arena,
      blue: m.blue,
      orange: m.orange,
      clock,
      overtime: m.overtime,
      phase: m.phase,
      blueNames: names[0].join(', ').slice(0, 160),
      orangeNames: names[1].join(', ').slice(0, 160),
    };
    const key = JSON.stringify(meta);
    if (key === this.metaKey) return;
    this.metaKey = key;
    void this.setMetadata(meta);
  }

  /** Bots show a ping like anyone's: a steady figure per bot that wanders a little. */
  private botPings(): void {
    this.state.players.forEach((p) => {
      if (!p.bot) return;
      if (!p.ping) p.ping = 28 + Math.floor(Math.random() * 60);
      else p.ping = Math.max(18, Math.min(140, p.ping + Math.round((Math.random() - 0.5) * 6)));
    });
  }

  /** An emote ends when the driver needs their hands (or after `EMOTE.maxTicks`): the replicated clear. */
  private clearEmotes(): void {
    const tick = this.match.tick;
    this.state.players.forEach((row, id) => {
      if (row.emote && (tick - row.emoteTick > EMOTE.maxTicks || this.match.driving(id))) row.emote = '';
    });
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const row = new PlayerState();
    row.id = client.sessionId;
    if (options.identity) this.applyIdentity(row, options.identity);
    if (options.avatar) this.applyAvatar(row, options.avatar);
    if (typeof options.car === 'number' && Number.isInteger(options.car) && options.car >= 0 && options.car < CAR_COUNT) row.body = options.car;
    this.state.players.set(client.sessionId, row);
    const seat = this.match.addHuman(client.sessionId, typeof options.team === 'number' ? options.team : -1);
    row.car = seat.car;
    row.team = seat.team;
    logger.info(SCOPE, `${row.name || client.sessionId} joined: team ${seat.team}, car ${seat.car} (${this.clients.length}/${this.maxClients})`);
    if (typeof options.token === 'string') void this.verify(client.sessionId, options.token);
  }

  override onLeave(client: Client): void {
    this.commitLeaver(client.sessionId);
    this.match.removeHuman(client.sessionId);
    this.state.players.delete(client.sessionId);
    logger.info(SCOPE, `${client.sessionId} left (${this.clients.length} remain)`);
  }

  override onDispose(): void {
    this.unregisterStats?.();
    clearInterval(this.loop);
    GameRoom.live.delete(this);
    logger.info(SCOPE, `room ${this.roomId} disposed`);
  }

  // ------------------------------------------------------------------ input

  private onInput(client: Client, message: unknown): void {
    if (!Array.isArray(message) || message.length < 2) return;
    const first = message[0];
    const count = message[1];
    if (typeof first !== 'number' || !Number.isInteger(first) || first < 0) return;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_BATCH) return;
    if (message.length < 2 + count * INPUT_BYTES) return;
    const batch: CarInput[] = [];
    for (let k = 0; k < count; k += 1) {
      // fresh objects: the queue keeps them
      batch.push(unpackInput(message, 2 + k * INPUT_BYTES, { ...this.scratch[k]! }));
    }
    this.match.pushInputs(client.sessionId, first, batch);
  }

  // ------------------------------------------------------------------ identity

  private applyIdentity(row: PlayerState, message: unknown): void {
    const identity = sanitizeIdentity(message);
    if (identity.displayName) row.name = identity.displayName;
    else if (!row.name) row.name = `Player ${Math.floor(100 + Math.random() * 900)}`;
    row.avatarUrl = identity.avatarUrl;
  }

  private applyAvatar(row: PlayerState, message: unknown): void {
    const m = (message ?? {}) as Partial<SetAvatarMessage>;
    row.avatar.apply(sanitizeAppearance(m.appearance), sanitizeProportions(m.proportions));
  }

  /** The handle shown for friend toasts comes only from Bloxity's own answer, never the client. */
  private async verify(sessionId: string, token: string | null): Promise<void> {
    const row = this.state.players.get(sessionId);
    if (!row) return;
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      row.username = '';
      this.accounts.delete(sessionId);
      return;
    }
    try {
      const outcome = await verifyGameToken(token);
      const live = this.state.players.get(sessionId);
      if (!live) return;
      live.username = outcome.status === 'verified' ? outcome.username : '';
      // the account the server verified (never one a client claims): career stats are keyed by it
      if (outcome.status === 'verified' && outcome.accountId) {
        this.accounts.set(sessionId, outcome.accountId);
        void careers.load(outcome.accountId);
      } else if (outcome.status === 'rejected') {
        this.accounts.delete(sessionId);
      }
    } catch (error) {
      logger.warn(SCOPE, `token check failed: ${String(error)}`);
    }
  }
}
