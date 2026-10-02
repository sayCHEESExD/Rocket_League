import { MessageType, type MatchFoundMessage } from '@rlb/shared';
import { isTouchPrimary } from '../config/device.js';
import { Lobby } from '../lobby/Lobby.js';
import { logger } from '../util/logger.js';
import type { Game } from './Game.js';

const SCOPE = 'app';

/**
 * WHERE THE PLAYER IS: the lobby (walking about, picking a playlist), loading
 * a match (behind the MATCH FOUND card: the arena built, cars pooled, shaders
 * compiled - see \`Game.prepare\`), or in the match. One renderer; the frame
 * goes to whichever is showing.
 */
export class App {
  readonly lobby: Lobby;
  private mode: 'lobby' | 'loading' | 'match' = 'lobby';

  constructor(readonly game: Game) {
    this.lobby = new Lobby({
      renderer: game.renderer,
      joinOptions: () => game.joinOptions(),
      myLook: () => game.myLook,
      openGarage: () => game.openGarage(),
      garageOpen: () => game.garageOpen,
      renderGarage: (dt) => game.renderGarage(dt),
      toggleSocial: () => game.toggleSocial(),
      roomChanged: (id) => game.noteRoom(id),
      playerSeen: (u) => game.notePlayer(u),
      matchFound: (m) => void this.matchFound(m),
      touch: isTouchPrimary(),
    });
    game.onExit = () => this.backToLobby();
    game.lobbyEmote = (id) => this.lobby.playEmote(id);
    game.onCarPicked = (body) => {
      if (!game.playing) this.lobby.net.send(MessageType.SetCar, body);
    };
    game.onGarageOpened = () => this.lobby.hud.setVisible(false);
    game.onGarageClosed = () => {
      if (this.mode === 'lobby') this.lobby.hud.setVisible(true);
    };
    game.lobbySync = () => {
      if (this.mode === 'lobby') this.lobby.refreshMe();
    };
    game.onResize = (w, h) => this.lobby.resize(w, h);
    this.lobby.resize(window.innerWidth, window.innerHeight);
    game.setActive(false);
  }

  /** Straight into a match (dev \`?play=open\`, an invite into a match room). */
  enteredMatch(): void {
    this.mode = 'match';
  }

  update(dt: number): void {
    if (this.mode === 'match') this.game.update(dt);
    else this.lobby.update(dt);
  }

  /** The lobby found a match: load it behind the card, take the seat, fade into the intro. */
  private async matchFound(m: MatchFoundMessage): Promise<void> {
    if (this.mode !== 'lobby') return;
    this.mode = 'loading';
    this.lobby.freeze(true);
    this.lobby.hud.matchFound(m, m.team);
    try {
      // frames go to the match as soon as we are in it (it settles under the card), then reveal
      await this.game.joinMatch(m, (text) => this.lobby.hud.loading(text), () => (this.mode = 'match'));
      this.lobby.exit();
      this.game.reveal();
    } catch (error) {
      logger.warn(SCOPE, `could not join the match: ${String(error)}`);
      this.game.leaveMatch();
      this.lobby.hud.matchFound(null);
      this.lobby.freeze(false);
      this.lobby.hud.toast('Match unavailable - back to the lobby');
      this.mode = 'lobby';
    }
  }

  /** The match is over (or we left): back to the lobby we came from. */
  private backToLobby(): void {
    if (this.mode !== 'match') return;
    this.mode = 'lobby';
    this.game.leaveMatch();
    this.game.portalGameplayStart();
    void this.lobby.enter();
  }
}
