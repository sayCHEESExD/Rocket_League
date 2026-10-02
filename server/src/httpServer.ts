import { createServer, type Server } from 'node:http';
import { matchMaker } from '@colyseus/core';
import { ROOM_NAME } from '@rlb/shared';
import { GameRoom } from './rooms/GameRoom.js';
import { handleAllRooms, isAllRoomsRequest } from './routes/rooms.js';
import { logger } from './util/logger.js';

const SCOPE = 'http';

/**
 * A plain HTTP server for Colyseus to attach to, so the same port answers the
 * WebSocket upgrade, the `/health` probe Legion polls, and the store page's
 * "Servers" list.
 */
export const createHttpServer = (): Server =>
  createServer((request, response) => {
    if (request.url === '/health') {
      void (async () => {
        let rooms = 0;
        let players = 0;
        try {
          const live = await matchMaker.query({ name: ROOM_NAME });
          rooms = live.length;
          for (const room of live) players += room.clients;
        } catch (error) {
          logger.warn(SCOPE, `could not count rooms: ${String(error)}`);
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        const ticks = [...GameRoom.live].map((r) => ({ id: r.roomId, clients: r.clients.length, tickMs: +r.tickMs.toFixed(3), tickMax: +r.tickMax.toFixed(2) }));
        response.end(JSON.stringify({ ok: true, room: ROOM_NAME, rooms, players, ticks }));
      })();
      return;
    }
    if (isAllRoomsRequest(request)) {
      void handleAllRooms(request, response);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    response.end('not found');
  });
