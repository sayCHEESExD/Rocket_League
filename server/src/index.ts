import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LOBBY_ROOM, ROOM_NAME } from '@rlb/shared';
import { careers } from './bloxity/careers.js';
import { installStatReporter } from './bloxity/statReporter.js';
import { serverConfig } from './config/serverConfig.js';
import { createHttpServer } from './httpServer.js';
import { GameRoom } from './rooms/GameRoom.js';
import { LobbyRoom } from './rooms/LobbyRoom.js';
import { logger } from './util/logger.js';

const SCOPE = 'server';

const boot = async (): Promise<void> => {
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: createHttpServer() }),
    greet: false,
  });
  gameServer.define(ROOM_NAME, GameRoom);
  gameServer.define(LOBBY_ROOM, LobbyRoom);
  await gameServer.listen(serverConfig.port, serverConfig.host);
  logger.info(
    SCOPE,
    `listening on ${serverConfig.host}:${serverConfig.port} room="${ROOM_NAME}" health=/health ` +
      `game=${serverConfig.hostingId} tokens-verified-for=${serverConfig.portalSlug}`,
  );

  // Bloxity profile stats: a no-op unless the pod has BLOXITY_REPORT_TOKEN and BLOXITY_GAME_ID
  const stats = installStatReporter();

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info(SCOPE, `received ${signal}, shutting down`);
    // Leaving players commit their careers (GameRoom.onLeave); wait for those writes, then report
    // everyone one last time - or a whole interval of progress on this pod would be lost.
    void gameServer
      .gracefullyShutdown(false)
      .catch((error: unknown) => logger.error(SCOPE, 'graceful shutdown failed:', error))
      .then(() => careers.settle())
      .then(() => {
        stats.stop();
        return stats.flush();
      })
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
};

boot().catch((error: unknown) => {
  logger.error(SCOPE, 'failed to start', error);
  process.exit(1);
});
