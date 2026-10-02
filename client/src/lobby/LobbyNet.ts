import { LOBBY_ROOM, MessageType, type MatchFoundMessage } from '@rlb/shared';
import type { Room } from 'colyseus.js';
import { sharedClient } from '../net/colyseus.js';
import { logger } from '../util/logger.js';

const SCOPE = 'lobby-net';

/** One person on the plaza, as replicated (see server/src/rooms/state/LobbyState.ts). */
export interface LobbyPlayerView {
  id: string;
  name: string;
  username: string;
  avatarUrl: string;
  avatar: Record<string, unknown>;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: number;
  body: number;
  queue: string;
  matched: boolean;
  chat: number;
  chatAt: number;
  emote: string;
  emoteAt: number;
  wins: number;
  goals: number;
  matches: number;
}

export interface QueueView {
  mode: string;
  count: number;
  needed: number;
  startsIn: number;
}

export interface LiveMatchView {
  roomId: string;
  mode: string;
  arena: number;
  blue: number;
  orange: number;
  clock: number;
  overtime: boolean;
  phase: number;
  blueNames: string;
  orangeNames: string;
}

type SchemaMap<T> = Map<string, T> & { forEach(cb: (v: T, k: string) => void): void };

export interface LobbyStateView {
  players: SchemaMap<LobbyPlayerView>;
  queues: SchemaMap<QueueView>;
  matches: { length: number; forEach(cb: (m: LiveMatchView) => void): void };
  time: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * THE LOBBY CONNECTION: join (a known lobby by id - the one we came from, or
 * an invite - else any lobby with room), relay the walker and the requests,
 * and hand over the match the server found. A dropped lobby connection is
 * re-joined quietly; leaving on purpose (into a match) is not.
 */
export class LobbyNet {
  private room: Room<LobbyStateView> | null = null;
  private leaving = false;
  onMatchFound: ((m: MatchFoundMessage) => void) | null = null;
  onStatus: ((online: boolean) => void) | null = null;

  get state(): LobbyStateView | null {
    const s = this.room?.state;
    return s && s.players && s.queues ? s : null;
  }

  get sessionId(): string {
    return this.room?.sessionId ?? '';
  }

  get roomId(): string {
    return this.room?.roomId ?? '';
  }

  /** Join a lobby: \`roomId\` first (back to the same one after a match), else matchmaking. */
  async join(options: Record<string, unknown>, roomId = ''): Promise<void> {
    const client = sharedClient();
    let room: Room<LobbyStateView> | null = null;
    if (roomId) {
      try {
        room = await client.joinById<LobbyStateView>(roomId, options);
      } catch (error) {
        logger.info(SCOPE, `lobby ${roomId} unavailable (${String(error)}); finding another`);
      }
    }
    room ??= await client.joinOrCreate<LobbyStateView>(LOBBY_ROOM, options);
    this.attach(room, options);
  }

  /** Take over a lobby joined elsewhere (an invite link). */
  adopt(room: Room<LobbyStateView>, options: Record<string, unknown>): void {
    this.attach(room, options);
  }

  private attach(room: Room<LobbyStateView>, options: Record<string, unknown>): void {
    this.room = room;
    this.leaving = false;
    this.onStatus?.(true);
    room.onMessage(MessageType.MatchFound, (m: MatchFoundMessage) => this.onMatchFound?.(m));
    room.onLeave(async (code) => {
      if (this.leaving || this.room !== room) return;
      this.onStatus?.(false);
      logger.warn(SCOPE, `lobby connection lost (${code}); rejoining`);
      for (let attempt = 0; !this.leaving && attempt < 20; attempt += 1) {
        await sleep(Math.min(8000, 800 * (attempt + 1)));
        try {
          await this.join(options, room.roomId);
          return;
        } catch (error) {
          logger.warn(SCOPE, `rejoin failed: ${String(error)}`);
        }
      }
    });
  }

  send(type: string, message: unknown): void {
    if (this.room?.connection?.isOpen) this.room.send(type, message);
  }

  leave(): void {
    this.leaving = true;
    void this.room?.leave();
    this.room = null;
  }
}
