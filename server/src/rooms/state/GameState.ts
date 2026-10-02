import { MapSchema, Schema, type } from '@colyseus/schema';
import { AvatarState } from './AvatarState.js';

/**
 * Replicated per-PLAYER state (humans and bots alike). Everything here is
 * slow-changing: who, which team, which car, the match figures. The car's
 * MOTION never travels through the schema - it is in the binary world
 * snapshot, keyed by `car`.
 */
export class PlayerState extends Schema {
  @type('string') id = '';
  @type('string') name = '';
  /** The verified Bloxity handle ('' for guests and bots). */
  @type('string') username = '';
  @type('string') avatarUrl = '';
  @type('boolean') bot = false;
  @type('int8') team = 0;
  /** World car slot (0..15), -1 while spectating. */
  @type('int8') car = -1;
  /** Which car body (0..CAR_COUNT-1) - cosmetic, every car shares one hitbox. */
  @type('uint8') body = 0;
  @type(AvatarState) avatar = new AvatarState();
  @type('uint16') score = 0;
  @type('uint8') goals = 0;
  @type('uint8') assists = 0;
  @type('uint8') saves = 0;
  @type('uint8') shots = 0;
  @type('uint8') demos = 0;
  @type('uint16') ping = 0;
  /** Last quick-chat line (index into QUICK_CHATS) and the tick it was said. */
  @type('int8') chat = -1;
  @type('uint32') chatTick = 0;
  /** The Bloxity emote playing ('' none) and the server tick it began - every screen plays it from there. */
  @type('string') emote = '';
  @type('uint32') emoteTick = 0;
}

export class MatchState extends Schema {
  @type('uint8') phase = 1;
  /** Server tick the current phase ends at (0 = open-ended). */
  @type('uint32') phaseEnd = 0;
  /** Regulation seconds left at `clockTick` (overtime: seconds played in overtime). */
  @type('float32') clock = 300;
  @type('uint32') clockTick = 0;
  @type('boolean') clockRunning = false;
  @type('boolean') overtime = false;
  @type('uint8') blue = 0;
  @type('uint8') orange = 0;
  /** Team of the last goal (-1 none) - colours the explosion and the replay. */
  @type('int8') lastGoalTeam = -1;
  @type('uint16') matchNo = 1;
  /** Which arena (index into ARENAS) - visual only, the physical arena never changes. */
  @type('uint8') arena = 0;
}

export class GameState extends Schema {
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type(MatchState) match = new MatchState();
}
