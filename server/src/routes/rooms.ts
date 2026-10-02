import type { IncomingMessage, ServerResponse } from 'node:http';
import { matchMaker } from '@colyseus/core';
import { MAX_PLAYERS_PER_ROOM, ROOM_NAME } from '@rlb/shared';
import { logger } from '../util/logger.js';

const SCOPE = 'rooms';

/**
 * THE ROOM LIST Bloxity's store page reads for its "Servers" panel:
 * `GET /api/coly-matchmaker/all-rooms?mode=<id>`, which the catalogue row's
 * `allRoomsUrl` points at
 * (`https://rocket-league-game.host.bloxity.io/api/coly-matchmaker/all-rooms?mode=0`
 * - the HOSTING id, not the portal slug).
 *
 * The body is the shape the portal already parses:
 *
 *   { rooms: [{ region, id, type, players, maxPlayers, locked, metadata }],
 *     servers: ['bloxity'], onlineServers: ['bloxity'],
 *     totalPlayers, totalRooms, timestamp, version, mode }
 *
 * `region` is always "bloxity": Legion has one cluster of interchangeable
 * pods, but the portal renders the field per row, so it cannot be left out.
 *
 * WHERE THE ROOMS COME FROM MATTERS. `matchMaker.query()` sees only the pod
 * that answered this request, so on a fleet of N pods it reports about 1/N of
 * the game - and `totalPlayers` feeds the platform's health board. The list
 * must come from the matchmaker's CROSS-POD directory whenever one exists
 * (`MATCHMAKER_REPORT_URL` is set in a Legion deployment); this process is the
 * source ONLY when it is not (local development, a single-process host). A
 * directory that cannot be read answers 502 with no online servers rather than
 * a quietly partial list.
 *
 * Only public listings are published - the same set any client reads from the
 * lobby - so the token is optional: enforced only if `LEGION_GETROOMS_API_TOKEN`
 * happens to be set.
 */
export const ALL_ROOMS_PATH = '/api/coly-matchmaker/all-rooms';

/** This game serves one catalogue row: mode 0. */
const MODES: Readonly<Record<number, string>> = { 0: 'Rocket League' };

const REGION = 'bloxity';

export interface RoomRow {
  region: string;
  id: string;
  type: 'public' | 'private';
  players: number;
  maxPlayers: number;
  locked: boolean;
  metadata: Record<string, unknown>;
}

/**
 * The cross-pod directory reader, when one is installed.
 *
 * Reading the directory needs the matchmaker's protocol, which ships with
 * Legion's `legion-room-reporter` and is not in this repository. Until a reader
 * is installed here, a deployment that HAS a directory answers 502 - never a
 * one-pod undercount dressed up as the whole game.
 */
export type DirectoryReader = (mode: number) => Promise<RoomRow[]>;
let directoryReader: DirectoryReader | null = null;

export const installDirectoryReader = (reader: DirectoryReader): void => {
  directoryReader = reader;
};

const version = (): string => process.env['BLOXITY_VERSION']?.trim() || process.env['GIT_SHA']?.trim().slice(0, 7) || '0.1.0';

/** This process's own rooms (local development / single-process hosting only). */
const localRooms = async (mode: number): Promise<RoomRow[]> => {
  if (!(mode in MODES)) return [];
  const live = await matchMaker.query({ name: ROOM_NAME });
  return live
    .filter((room) => !room.private && !room.unlisted)
    .map((room) => {
      const maxPlayers = room.maxClients || MAX_PLAYERS_PER_ROOM;
      return {
        region: REGION,
        id: room.roomId,
        type: 'public' as const,
        players: room.clients,
        maxPlayers,
        locked: room.locked || room.clients >= maxPlayers,
        metadata: {
          roomId: room.roomId,
          region: REGION,
          maxPlayers,
          currentPlayers: room.clients,
          mode,
          modeName: MODES[mode],
        },
      };
    });
};

/** True when this request is for the room list (any query string). */
export const isAllRoomsRequest = (request: IncomingMessage): boolean =>
  request.method === 'GET' && (request.url ?? '').split('?')[0] === ALL_ROOMS_PATH;

export const handleAllRooms = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const mode = Number.parseInt(url.searchParams.get('mode') ?? '0', 10) || 0;
  const reply = (status: number, body: Record<string, unknown>): void => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    response.end(JSON.stringify(body));
  };
  const empty = (online: boolean): Record<string, unknown> => ({
    rooms: [],
    servers: [REGION],
    onlineServers: online ? [REGION] : [],
    totalPlayers: 0,
    totalRooms: 0,
    timestamp: Date.now(),
    version: version(),
    mode,
  });

  const token = process.env['LEGION_GETROOMS_API_TOKEN']?.trim();
  if (token) {
    const supplied = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
    if (supplied !== token) {
      reply(401, { error: 'unauthorized' });
      return;
    }
  }

  let rooms: RoomRow[];
  try {
    if (process.env['MATCHMAKER_REPORT_URL']?.trim()) {
      if (!directoryReader) throw new Error('no cross-pod directory reader is installed');
      rooms = await directoryReader(mode);
    } else {
      rooms = await localRooms(mode);
    }
  } catch (error) {
    logger.warn(SCOPE, `room directory unreadable: ${String(error)}`);
    reply(502, empty(false));
    return;
  }

  const totalPlayers = rooms.reduce((sum, room) => sum + room.players, 0);
  reply(200, { ...empty(true), rooms, totalPlayers, totalRooms: rooms.length });
};
