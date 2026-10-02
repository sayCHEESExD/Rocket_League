import { Client, Room, matchMaker } from '@colyseus/core';
import {
  ARENAS,
  playerLikeName,
  CAR_COUNT,
  EMOTE,
  LOBBY,
  MODES,
  MessageType,
  QUICK_CHATS,
  ROOM_NAME,
  isBloxityEmoteId,
  modeById,
  sanitizeAppearance,
  sanitizeIdentity,
  sanitizeProportions,
  type MatchFoundMessage,
  type SetAvatarMessage,
  type SetIdentityMessage,
} from '@rlb/shared';
import { verifyGameToken } from '../auth/BloxityAuth.js';
import { careers } from '../bloxity/careers.js';
import { logger } from '../util/logger.js';
import { LiveMatchState, LobbyPlayer, LobbyState, QueueInfo } from './state/LobbyState.js';

const SCOPE = 'lobby';
const MAX_TOKEN_LENGTH = 4096;
const CHAT_GAP = 1.5;

interface JoinOptions {
  token?: string | null;
  car?: number;
  avatar?: SetAvatarMessage;
  identity?: SetIdentityMessage;
}

/** What the lobby keeps about a person to seat them in a match (server memory only). */
interface Seat {
  token: string | null;
  identity: SetIdentityMessage | undefined;
  avatar: SetAvatarMessage | undefined;
  /** When they joined their queue (ms) - first come, first served. */
  queuedAt: number;
  /** Last accepted position and its time, for the speed bound. */
  lx: number;
  lz: number;
  lt: number;
}

/**
 * THE LOBBY: up to 15 people on a stadium plaza, in their Bloxity avatars,
 * walking about, chatting and emoting, with three playlist pads (1v1, 3v3,
 * 4v4). Standing on a pad (or picking it from the menu) queues you; a queue
 * that fills - or has waited `LOBBY.fillWaitSeconds` - becomes a match: the
 * lobby creates a match room for that playlist and arena, reserves a seat for
 * each player on the team it picked, and sends them the reservation. Clients
 * preload the arena, take their seat, and leave the lobby; when the match is
 * over the match room sends them back.
 *
 * The board's "live matches" come from the match rooms' own metadata
 * (`GameRoom.publishLive`), read here with matchMaker.query once a second.
 */
export class LobbyRoom extends Room<LobbyState> {
  override maxClients = LOBBY.maxPlayers;
  override autoDispose = true;
  private readonly seats = new Map<string, Seat>();
  private launching = new Set<string>();
  private arenaTurn = Math.floor(Math.random() * ARENAS.length);
  private liveKey = '';
  /** The match rooms as last read (for joining matches in progress). */
  private liveRooms: Awaited<ReturnType<typeof matchMaker.query>> = [];
  /** Seats this lobby reserved in a live room that may not show in its client count yet (room -> [count, until]). */
  private readonly pending = new Map<string, [number, number]>();

  override onCreate(): void {
    this.state = new LobbyState();
    this.setPatchRate(50);
    for (const mode of MODES) {
      const q = new QueueInfo();
      q.mode = mode.id;
      q.needed = mode.teamSize * 2;
      this.state.queues.set(mode.id, q);
    }

    this.onMessage(MessageType.Move, (client, m: unknown) => this.onMove(client, m));
    this.onMessage(MessageType.Queue, (client, mode: unknown) => this.onQueue(client, mode));
    this.onMessage(MessageType.SetIdentity, (client, message: SetIdentityMessage) => {
      const row = this.state.players.get(client.sessionId);
      const seat = this.seats.get(client.sessionId);
      if (!row || !seat) return;
      this.applyIdentity(row, message);
      seat.identity = message;
    });
    this.onMessage(MessageType.SetAvatar, (client, message: SetAvatarMessage) => {
      const row = this.state.players.get(client.sessionId);
      const seat = this.seats.get(client.sessionId);
      if (!row || !seat) return;
      this.applyAvatar(row, message);
      seat.avatar = message;
    });
    this.onMessage(MessageType.SetAuth, (client, message: { token?: string | null }) => {
      void this.verify(client.sessionId, message?.token ?? null);
    });
    this.onMessage(MessageType.SetCar, (client, body: unknown) => {
      const row = this.state.players.get(client.sessionId);
      if (row && typeof body === 'number' && Number.isInteger(body) && body >= 0 && body < CAR_COUNT) row.body = body;
    });
    this.onMessage(MessageType.QuickChat, (client, index: unknown) => {
      const row = this.state.players.get(client.sessionId);
      if (!row || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= QUICK_CHATS.length) return;
      if (row.chat >= 0 && this.state.time - row.chatAt < CHAT_GAP) return;
      row.chat = index;
      row.chatAt = this.state.time;
    });
    this.onMessage(MessageType.Emote, (client, message: unknown) => {
      const row = this.state.players.get(client.sessionId);
      const id = message && typeof message === 'object' ? (message as { id?: unknown }).id : undefined;
      if (!row || !isBloxityEmoteId(id)) return;
      if (row.emote && this.state.time - row.emoteAt < EMOTE.minGapTicks / 60) return;
      row.emote = id.toLowerCase();
      row.emoteAt = this.state.time;
    });

    this.setSimulationInterval((dt) => {
      this.state.time += dt / 1000;
    }, 100);
    this.clock.setInterval(() => this.matchmake(), 500);
    this.clock.setInterval(() => void this.refreshLive(), 1000);
    void this.refreshLive();
    logger.info(SCOPE, `lobby ${this.roomId} open`);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const row = new LobbyPlayer();
    row.id = client.sessionId;
    // arrive somewhere near the middle, facing the playlist pads
    const a = Math.random() * Math.PI * 2;
    row.x = Math.cos(a) * 4;
    row.z = 6 + Math.sin(a) * 3;
    row.yaw = Math.PI;
    if (options.identity) this.applyIdentity(row, options.identity);
    else row.name = `Player ${Math.floor(100 + Math.random() * 900)}`;
    if (options.avatar) this.applyAvatar(row, options.avatar);
    if (typeof options.car === 'number' && Number.isInteger(options.car) && options.car >= 0 && options.car < CAR_COUNT) row.body = options.car;
    this.state.players.set(client.sessionId, row);
    this.seats.set(client.sessionId, {
      token: typeof options.token === 'string' && options.token.length <= MAX_TOKEN_LENGTH ? options.token : null,
      identity: options.identity,
      avatar: options.avatar,
      queuedAt: 0,
      lx: row.x,
      lz: row.z,
      lt: Date.now(),
    });
    if (typeof options.token === 'string') void this.verify(client.sessionId, options.token);
    logger.info(SCOPE, `${row.name} joined the lobby (${this.clients.length}/${this.maxClients})`);
  }

  override onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.seats.delete(client.sessionId);
  }

  // ------------------------------------------------------------------ walking

  private onMove(client: Client, m: unknown): void {
    const row = this.state.players.get(client.sessionId);
    const seat = this.seats.get(client.sessionId);
    if (!row || !seat || !Array.isArray(m) || m.length < 5) return;
    const [x, y, z, yaw, anim] = m as unknown[];
    if (![x, y, z, yaw, anim].every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    let nx = x as number;
    let nz = z as number;
    const r = Math.hypot(nx, nz);
    if (r > LOBBY.radius) {
      nx *= LOBBY.radius / r;
      nz *= LOBBY.radius / r;
    }
    // no faster than a sprint (plus slack for a late packet)
    const now = Date.now();
    const dt = Math.max(0.05, (now - seat.lt) / 1000);
    if (Math.hypot(nx - seat.lx, nz - seat.lz) > LOBBY.maxSpeed * dt + 1.5) return;
    seat.lx = nx;
    seat.lz = nz;
    seat.lt = now;
    row.x = nx;
    row.y = Math.min(6, Math.max(0, y as number));
    row.z = nz;
    row.yaw = yaw as number;
    row.anim = Math.min(2, Math.max(0, Math.round(anim as number)));
    // an emote stops when its player moves
    if (row.anim !== 0 && row.emote) row.emote = '';
  }

  // ------------------------------------------------------------------ queues

  private onQueue(client: Client, mode: unknown): void {
    const row = this.state.players.get(client.sessionId);
    const seat = this.seats.get(client.sessionId);
    if (!row || !seat || row.matched || this.launching.has(client.sessionId)) return;
    const next = mode === '' ? '' : (modeById(mode)?.id ?? row.queue);
    if (next === row.queue) return;
    row.queue = next;
    seat.queuedAt = Date.now();
  }

  /** Every half second: start any queue that is full, or has waited long enough (bots fill the rest). */
  private matchmake(): void {
    const now = Date.now();
    for (const mode of MODES) {
      const info = this.state.queues.get(mode.id)!;
      const queued: string[] = [];
      this.state.players.forEach((p, id) => {
        if (p.queue === mode.id && !p.matched && !this.launching.has(id)) queued.push(id);
      });
      queued.sort((a, b) => this.seats.get(a)!.queuedAt - this.seats.get(b)!.queuedAt);
      // first, empty seats in a match of this playlist already being played
      for (const room of this.joinable(mode.id)) {
        if (queued.length === 0) break;
        const free = room.maxClients - room.clients - this.pendingIn(room.roomId, now);
        if (free <= 0) continue;
        const take = queued.splice(0, free);
        this.pending.set(room.roomId, [this.pendingIn(room.roomId, now) + take.length, now + 30_000]);
        void this.joinLive(mode, room, take);
      }
      info.count = queued.length;
      if (queued.length === 0) {
        info.startsIn = -1;
        continue;
      }
      const waited = (now - this.seats.get(queued[0]!)!.queuedAt) / 1000;
      info.startsIn = Math.max(0, LOBBY.fillWaitSeconds - waited);
      if (queued.length >= info.needed || info.startsIn <= 0) void this.launch(mode, queued.slice(0, info.needed));
    }
  }

  /** Create the match room, put each player on a team, reserve their seats, tell them. */
  private async launch(mode: (typeof MODES)[number], ids: string[]): Promise<void> {
    for (const id of ids) this.launching.add(id);
    const arena = this.arenaTurn;
    this.arenaTurn = (this.arenaTurn + 1) % ARENAS.length;
    try {
      // the names first: a room is created before the teams are known, so they are worked out up front
      const team0 = ids.filter((_, i) => i % 2 === 0).length;
      const team1 = ids.length - team0;
      const botNames: [string[], string[]] = [
        Array.from({ length: mode.teamSize - team0 }, () => playerLikeName(Math.random)),
        Array.from({ length: mode.teamSize - team1 }, () => playerLikeName(Math.random)),
      ];
      const room = await matchMaker.createRoom(ROOM_NAME, { mode: mode.id, arena, expect: ids.length, botNames: [[...botNames[0]], [...botNames[1]]] });
      // alternate teams in queue order: the first two are on opposite sides
      const team = new Map(ids.map((id, i) => [id, i % 2]));
      const names = (t: number): string[] => ids.filter((id) => team.get(id) === t).map((id) => this.state.players.get(id)?.name ?? 'Player');
      // the full roster: the players, then the handles the bots will play under
      const blue = [...names(0), ...botNames[0]];
      const orange = [...names(1), ...botNames[1]];
      for (const id of ids) {
        const row = this.state.players.get(id);
        const seat = this.seats.get(id);
        const client = this.clients.find((c) => c.sessionId === id);
        if (!row || !seat || !client) continue;
        const reservation = await matchMaker.reserveSeatFor(room, {
          token: seat.token,
          car: row.body,
          identity: seat.identity,
          avatar: seat.avatar,
          team: team.get(id),
        });
        row.matched = true;
        row.queue = '';
        client.send(MessageType.MatchFound, { reservation, mode: mode.id, arena, team: team.get(id)!, blue, orange } satisfies MatchFoundMessage);
      }
      logger.info(SCOPE, `${mode.id} match ${room.roomId} for ${ids.length} player(s) on arena ${arena}`);
    } catch (error) {
      logger.warn(SCOPE, `could not start a ${mode.id} match: ${String(error)}`);
    } finally {
      for (const id of ids) this.launching.delete(id);
    }
  }

  private pendingIn(roomId: string, now: number): number {
    const p = this.pending.get(roomId);
    return p && p[1] > now ? p[0] : 0;
  }

  /**
   * Live matches of a playlist with a seat for a human: not over, not in its last
   * half-minute, not locked (Colyseus locks a room whose seats are all taken or reserved).
   */
  private joinable(mode: string): Awaited<ReturnType<typeof matchMaker.query>> {
    return this.liveRooms.filter((r) => {
      const m = r.metadata as { game?: string; mode?: string; phase?: number; clock?: number; overtime?: boolean } | undefined;
      if (!m || m.game !== 'rocket-league' || m.mode !== mode || r.locked || r.clients <= 0) return false;
      if (m.phase === 5) return false; // results
      return m.overtime || (m.clock ?? 0) > 30;
    });
  }

  /** Seat queued players in a match in progress (they take over bots on arrival). */
  private async joinLive(mode: (typeof MODES)[number], room: Awaited<ReturnType<typeof matchMaker.query>>[number], ids: string[]): Promise<void> {
    for (const id of ids) this.launching.add(id);
    const m = room.metadata as { arena?: number; blueNames?: string; orangeNames?: string };
    const split = (s: string | undefined): string[] => (s ? s.split(', ').filter(Boolean) : []);
    try {
      for (const id of ids) {
        const row = this.state.players.get(id);
        const seat = this.seats.get(id);
        const client = this.clients.find((c) => c.sessionId === id);
        if (!row || !seat || !client) continue;
        try {
          const reservation = await matchMaker.reserveSeatFor(room, { token: seat.token, car: row.body, identity: seat.identity, avatar: seat.avatar });
          row.matched = true;
          row.queue = '';
          client.send(MessageType.MatchFound, {
            reservation,
            mode: mode.id,
            arena: Number(m.arena) || 0,
            team: -1,
            blue: split(m.blueNames),
            orange: split(m.orangeNames),
            inProgress: true,
          } satisfies MatchFoundMessage);
        } catch (error) {
          // full after all (or gone): they stay queued and get the next match
          logger.info(SCOPE, `no seat in ${room.roomId}: ${String(error)}`);
        }
      }
      logger.info(SCOPE, `${ids.length} player(s) sent into ${mode.id} match ${room.roomId} in progress`);
    } finally {
      for (const id of ids) this.launching.delete(id);
    }
  }

  // ------------------------------------------------------------------ the board

  private async refreshLive(): Promise<void> {
    try {
      const rooms = await matchMaker.query({ name: ROOM_NAME });
      this.liveRooms = rooms;
      const rows = rooms
        .filter((r) => (r.metadata as { game?: string } | undefined)?.game === 'rocket-league' && r.clients > 0)
        .map((r) => ({ id: r.roomId, m: r.metadata as Record<string, unknown> }))
        .sort((a, b) => String(a.m['mode']).localeCompare(String(b.m['mode'])))
        .slice(0, 8);
      const key = JSON.stringify(rows);
      if (key === this.liveKey) return;
      this.liveKey = key;
      this.state.matches.clear();
      for (const { id, m } of rows) {
        const s = new LiveMatchState();
        s.roomId = id;
        s.mode = typeof m['mode'] === 'string' ? m['mode'] : '';
        s.arena = Number(m['arena']) || 0;
        s.blue = Number(m['blue']) || 0;
        s.orange = Number(m['orange']) || 0;
        s.clock = Number(m['clock']) || 0;
        s.overtime = m['overtime'] === true;
        s.phase = Number(m['phase']) || 0;
        s.blueNames = String(m['blueNames'] ?? '');
        s.orangeNames = String(m['orangeNames'] ?? '');
        this.state.matches.push(s);
      }
    } catch (error) {
      logger.warn(SCOPE, `live matches unavailable: ${String(error)}`);
    }
  }

  // ------------------------------------------------------------------ identity

  private applyIdentity(row: LobbyPlayer, message: unknown): void {
    const identity = sanitizeIdentity(message);
    if (identity.displayName) row.name = identity.displayName;
    else if (!row.name) row.name = `Player ${Math.floor(100 + Math.random() * 900)}`;
    row.avatarUrl = identity.avatarUrl;
  }

  private applyAvatar(row: LobbyPlayer, message: unknown): void {
    const m = (message ?? {}) as Partial<SetAvatarMessage>;
    row.avatar.apply(sanitizeAppearance(m.appearance), sanitizeProportions(m.proportions));
  }

  /** The handle and the career figures come only from Bloxity's answer and the server's own store. */
  private async verify(sessionId: string, token: string | null): Promise<void> {
    const seat = this.seats.get(sessionId);
    const row = this.state.players.get(sessionId);
    if (!seat || !row) return;
    seat.token = token && token.length <= MAX_TOKEN_LENGTH ? token : null;
    if (!seat.token) {
      row.username = '';
      row.wins = row.goals = row.matches = 0;
      return;
    }
    try {
      const outcome = await verifyGameToken(seat.token);
      const live = this.state.players.get(sessionId);
      if (!live) return;
      live.username = outcome.status === 'verified' ? outcome.username : '';
      if (outcome.status === 'verified' && outcome.accountId) {
        const career = await careers.load(outcome.accountId);
        if (career && this.state.players.get(sessionId)) {
          live.wins = career.wins;
          live.goals = career.goals;
          live.matches = career.matches;
        }
      }
    } catch (error) {
      logger.warn(SCOPE, `token check failed: ${String(error)}`);
    }
  }
}
