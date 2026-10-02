import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { AvatarState } from './AvatarState.js';

/**
 * One person walking around the lobby. Movement is the CLIENT's (the lobby is
 * a social space, not a contest): the server only bounds it (inside the plaza,
 * no faster than a sprint) and relays it.
 */
export class LobbyPlayer extends Schema {
  @type('string') id = '';
  @type('string') name = '';
  /** Verified Bloxity handle ('' for guests). */
  @type('string') username = '';
  @type('string') avatarUrl = '';
  @type(AvatarState) avatar = new AvatarState();
  /** Position (metres) and facing on the plaza; anim 0 idle, 1 walk/run, 2 in the air. */
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') yaw = 0;
  @type('uint8') anim = 0;
  /** The car they will drive (shown on their name plate). */
  @type('uint8') body = 0;
  /** The playlist queue they are in ('' none). */
  @type('string') queue = '';
  /** Matched: on their way into a match. */
  @type('boolean') matched = false;
  /** Quick chat line index (-1 none) and when it was said (lobby seconds). */
  @type('int8') chat = -1;
  @type('float64') chatAt = 0;
  /** A Bloxity emote and when it began (lobby seconds). */
  @type('string') emote = '';
  @type('float64') emoteAt = 0;
  /** Career figures for the board (signed-in players; read from the server's own store). */
  @type('uint32') wins = 0;
  @type('uint32') goals = 0;
  @type('uint32') matches = 0;
}

/** A playlist's queue, for the pads and the board. */
export class QueueInfo extends Schema {
  @type('string') mode = '';
  @type('uint8') count = 0;
  @type('uint8') needed = 0;
  /** Seconds until it starts with bots in the empty seats (-1: nobody queued). */
  @type('float32') startsIn = -1;
}

/** A match being played right now (from the match rooms' metadata). */
export class LiveMatchState extends Schema {
  @type('string') roomId = '';
  @type('string') mode = '';
  @type('uint8') arena = 0;
  @type('uint8') blue = 0;
  @type('uint8') orange = 0;
  @type('uint16') clock = 0;
  @type('boolean') overtime = false;
  @type('uint8') phase = 0;
  @type('string') blueNames = '';
  @type('string') orangeNames = '';
}

export class LobbyState extends Schema {
  @type({ map: LobbyPlayer }) players = new MapSchema<LobbyPlayer>();
  @type({ map: QueueInfo }) queues = new MapSchema<QueueInfo>();
  @type([LiveMatchState]) matches = new ArraySchema<LiveMatchState>();
  /** Lobby clock (seconds since the room opened): chat and emote timing. */
  @type('float64') time = 0;
}
