import {
  MessageType,
  ROOM_NAME,
  type FeedMessage,
  type GoalMessage,
  type MatchEndMessage,
  type SetAvatarMessage,
  type SetIdentityMessage,
} from '@rlb/shared';
import { type Client, type Room } from 'colyseus.js';
import { sharedClient } from './colyseus.js';
import { logger } from '../util/logger.js';
import { takeDeepLinkRoom } from './deepLink.js';

const SCOPE = 'net';

/** The replicated schema as the client reads it (structural; colyseus decodes into these shapes). */
export interface NetAvatar {
  [key: string]: string | number;
}
export interface NetPlayer {
  id: string;
  name: string;
  username: string;
  avatarUrl: string;
  bot: boolean;
  team: number;
  car: number;
  body: number;
  avatar: NetAvatar;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
  demos: number;
  ping: number;
  chat: number;
  chatTick: number;
  emote: string;
  emoteTick: number;
}
export interface NetMatch {
  phase: number;
  phaseEnd: number;
  clock: number;
  clockTick: number;
  clockRunning: boolean;
  overtime: boolean;
  blue: number;
  orange: number;
  lastGoalTeam: number;
  matchNo: number;
  arena: number;
}
export interface NetState {
  players: Map<string, NetPlayer> & { forEach(cb: (p: NetPlayer, id: string) => void): void };
  match: NetMatch;
}

export interface NetHandlers {
  onSnapshot(bytes: Uint8Array): void;
  onGoal(message: GoalMessage): void;
  onFeed(message: FeedMessage): void;
  onMatchEnd(message: MatchEndMessage): void;
  onStatus(status: 'connecting' | 'online' | 'offline', detail?: string): void;
  /** A reconnect landed in a new room: forget everything about the old one. */
  onReset(): void;
  /** A playlist match is over (or its connection is gone): back to the lobby. */
  onToLobby(): void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const BACKOFF = [800, 1500, 3000, 5000, 8000, 15000];

/**
 * The only module that talks to Colyseus. Everything sent is INPUT or a
 * REQUEST; the server decides everything else.
 */
export class Net {
  private client: Client | null = null;
  private room: Room<NetState> | null = null;
  private live = false;
  private leaving = false;
  private joinOptions: () => Record<string, unknown> = () => ({});
  /** In a lobby playlist match (one match, then back): a lost connection returns to the lobby. */
  private playlist = false;
  rtt = 0;
  private pingTimer = 0;

  constructor(private readonly handlers: NetHandlers) {}

  get state(): NetState | null {
    const s = this.room?.state;
    return s && s.players && s.match ? s : null;
  }

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  get roomId(): string {
    return this.room?.roomId ?? '';
  }

  get online(): boolean {
    return this.live && !!this.room?.connection?.isOpen;
  }

  setJoinOptions(provider: () => Record<string, unknown>): void {
    this.joinOptions = provider;
  }

  /** Take the seat the lobby reserved in a playlist match. */
  async joinReserved(reservation: unknown): Promise<void> {
    this.client = sharedClient();
    this.handlers.onStatus('connecting');
    const room = await this.client.consumeSeatReservation<NetState>(reservation as never);
    this.playlist = true;
    this.attach(room);
  }

  /** Take over a match room some other code already joined (an invite link into a match). */
  adopt(room: Room<NetState>): void {
    this.client = sharedClient();
    this.playlist = false;
    this.attach(room);
  }

  /** An OPEN room (dev: `?play=open`; before the lobby, the only way in): an invite link, else matchmaking. */
  async connect(): Promise<void> {
    this.client = sharedClient();
    this.playlist = false;
    let attempt = 0;
    for (;;) {
      try {
        this.handlers.onStatus('connecting');
        const deep = takeDeepLinkRoom();
        let room: Room<NetState> | null = null;
        if (deep) {
          try {
            room = await this.client.joinById<NetState>(deep, this.joinOptions());
          } catch (error) {
            logger.warn(SCOPE, `invite room ${deep} unavailable (${String(error)}), matchmaking instead`);
          }
        }
        room ??= await this.client.joinOrCreate<NetState>(ROOM_NAME, this.joinOptions());
        this.attach(room);
        return;
      } catch (error) {
        const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)]!;
        attempt += 1;
        logger.warn(SCOPE, `join failed (${describe(error)}), retry in ${wait}ms`);
        if (attempt >= 4) throw error instanceof Error ? error : new Error(describe(error));
        await sleep(wait);
      }
    }
  }

  private attach(room: Room<NetState>): void {
    this.room = room;
    this.live = true;
    this.leaving = false;
    this.handlers.onStatus('online');
    room.onMessage(MessageType.Snapshot, (bytes: Uint8Array) => this.handlers.onSnapshot(bytes));
    room.onMessage(MessageType.Goal, (m: GoalMessage) => this.handlers.onGoal(m));
    room.onMessage(MessageType.Feed, (m: FeedMessage) => this.handlers.onFeed(m));
    room.onMessage(MessageType.MatchEnd, (m: MatchEndMessage) => this.handlers.onMatchEnd(m));
    room.onMessage(MessageType.ToLobby, () => this.handlers.onToLobby());
    room.onMessage(MessageType.Pong, (sent: number) => {
      const rtt = performance.now() - sent;
      this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
      this.send('rtt', Math.round(this.rtt));
    });
    room.onLeave((code) => {
      this.live = false;
      if (this.leaving) return;
      if (this.playlist) {
        // a playlist match cannot be rejoined by matchmaking: the lobby is home
        logger.warn(SCOPE, `playlist match connection closed (${code}); back to the lobby`);
        this.handlers.onToLobby();
        return;
      }
      logger.warn(SCOPE, `disconnected (${code}); reconnecting`);
      this.handlers.onStatus('offline', `disconnected (${code})`);
      void this.reconnect();
    });
    window.clearInterval(this.pingTimer);
    this.pingTimer = window.setInterval(() => this.send(MessageType.Ping, performance.now()), 2000);
    this.send(MessageType.Ping, performance.now());
  }

  private async reconnect(): Promise<void> {
    for (let attempt = 0; !this.leaving; attempt += 1) {
      await sleep(BACKOFF[Math.min(attempt, BACKOFF.length - 1)]!);
      try {
        const room = await this.client!.joinOrCreate<NetState>(ROOM_NAME, this.joinOptions());
        this.handlers.onReset();
        this.attach(room);
        return;
      } catch (error) {
        logger.warn(SCOPE, `reconnect failed: ${describe(error)}`);
      }
    }
  }

  send(type: string, message: unknown): boolean {
    const room = this.room;
    if (!room || !this.live || !room.connection?.isOpen) return false;
    room.send(type, message);
    return true;
  }

  sendInputs(packed: number[]): void {
    this.send(MessageType.Input, packed);
  }

  sendAvatar(message: SetAvatarMessage): void {
    this.send(MessageType.SetAvatar, message);
  }

  sendIdentity(message: SetIdentityMessage): void {
    this.send(MessageType.SetIdentity, message);
  }

  sendAuth(token: string | null): void {
    this.send(MessageType.SetAuth, { token });
  }

  leave(): void {
    this.leaving = true;
    this.live = false;
    window.clearInterval(this.pingTimer);
    void this.room?.leave();
    this.room = null;
  }
}

const describe = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'type' in error) return `server unreachable (${String((error as { type: unknown }).type)})`;
  return String(error);
};
