import { LOBBY_ROOM } from '@rlb/shared';
import { clientConfig } from './config/clientConfig.js';
import { App } from './core/App.js';
import { Game } from './core/Game.js';
import { sharedClient } from './net/colyseus.js';
import { takeDeepLinkRoom } from './net/deepLink.js';
import { GameLoop } from './core/GameLoop.js';
import { logger } from './util/logger.js';

const SCOPE = 'main';
const boot = document.getElementById('boot');
const bootStatus = document.getElementById('boot-status');

const setBootStatus = (text: string): void => {
  if (bootStatus) bootStatus.textContent = text;
};

/** Hand the browser a frame (or a timer in a hidden tab, where rAF never fires). */
const paint = (): Promise<void> =>
  new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(finish);
    window.setTimeout(finish, 120);
  });

const main = async (): Promise<void> => {
  const container = document.getElementById('app');
  if (!container) throw new Error('#app container missing from index.html');
  setBootStatus('Warming up the engines…');
  await paint();
  const game = new Game(container);
  game.startBloxity();
  game.loadingStep('Painting the pitch…');
  setBootStatus('Painting the pitch…');
  await paint();
  await game.initialise();
  const app = new App(game);
  game.loadingStep('Building the lobby…');
  setBootStatus('Building the lobby…');
  await paint();
  await app.lobby.warm();
  game.loadingStep('Joining the lobby…');
  setBootStatus('Joining the lobby…');
  await paint();
  let online = true;
  try {
    const deep = takeDeepLinkRoom();
    if (new URLSearchParams(window.location.search).get('play') === 'open') {
      // dev: straight into an open match room (the tests and the debug camera live here)
      await game.joinOpen();
      app.enteredMatch();
    } else if (deep) {
      // an invite: a lobby (walk in) or a match (straight in)
      try {
        const room = await sharedClient().joinById(deep, game.joinOptions());
        if (room.name === LOBBY_ROOM) app.lobby.adopt(room as never);
        else {
          await game.joinOpen(room as never);
          app.enteredMatch();
        }
      } catch (error) {
        logger.warn(SCOPE, `invite room ${deep} unavailable (${String(error)}); to the lobby`);
        await app.lobby.enter();
      }
    } else {
      await app.lobby.enter();
    }
  } catch (error) {
    online = false;
    const detail = error instanceof Error ? error.message : String(error);
    logger.error(SCOPE, `offline: ${detail}`);
    if (bootStatus) {
      bootStatus.className = 'err';
      bootStatus.textContent = clientConfig.serverUrl
        ? `Can't reach the game server (${clientConfig.serverUrl}).\nReload to try again.`
        : 'This build has no game server configured (VITE_SERVER_URL).';
    }
    boot?.classList.add('notice');
  }
  game.start();
  const loop = new GameLoop((delta) => app.update(delta));
  loop.start();
  if (clientConfig.debug) (window as Window & { __rl?: unknown }).__rl = { game, app, loop };
  if (boot && online) boot.hidden = true;
  logger.info(SCOPE, 'running');
};

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(SCOPE, message, error);
  if (bootStatus) {
    bootStatus.className = 'err';
    bootStatus.textContent = `Failed to start:\n${message}`;
  }
});
