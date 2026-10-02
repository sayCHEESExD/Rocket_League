/**
 * Network-level constants. Must stay identical on client and server.
 */

/** Colyseus room registered by the server and joined by the client. */
export const ROOM_NAME = 'rocketleague';

/** Default server port (unique among the sibling games on this machine). */
export const DEFAULT_SERVER_PORT = 2880;

/** Most HUMANS in one room. Bots fill empty seats and do not count. */
export const MAX_PLAYERS_PER_ROOM = 15;

/** World snapshots go out every this many ticks (60 Hz sim -> 30 Hz snapshots). */
export const SNAPSHOT_EVERY = 2;

/** Schema (names, scores, phases) patch interval. Motion travels in snapshots, not here. */
export const STATE_PATCH_MS = 100;

/** Most inputs a client may have queued on the server before old ones are merged away. */
export const INPUT_QUEUE_MAX = 6;

export const MessageType = {
  /** Client -> server: a batch of INPUT ticks: [firstSeq, count, ...6 bytes each]. Never a transform. */
  Input: 'in',
  /** Server -> clients: the binary world snapshot. */
  Snapshot: 'snap',
  /** Client -> server -> client: round-trip probe. */
  Ping: 'ping',
  Pong: 'pong',
  /** Server -> everyone: a goal (who, how fast). */
  Goal: 'goal',
  /** Server -> everyone: feed lines (demolitions, saves, shots). */
  Feed: 'feed',
  /** Server -> everyone: the final whistle, with the numbers. */
  MatchEnd: 'matchEnd',
  /** Client -> server: "this is what my Bloxity avatar looks like". */
  SetAvatar: 'setAvatar',
  /** Client -> server: the player's Bloxity DISPLAY NAME and portrait. */
  SetIdentity: 'setIdentity',
  /** Client -> server: the portal's game TOKEN, or null when signed out. */
  SetAuth: 'setAuth',
  /** Client -> server: ask to change team (granted when it keeps teams fair). */
  SwitchTeam: 'switchTeam',
  /** Client -> server: which of the five cars to drive (0..CAR_COUNT-1). */
  SetCar: 'setCar',
  /** Client -> server: quick chat line index. */
  QuickChat: 'quickChat',
  /** Client -> server: play a Bloxity emote ({ id }: a catalogue id the portal sent). */
  Emote: 'emote',
  /** Client -> server: the portal's "respawn" (handled like a demolition: back in 3 s). */
  Respawn: 'respawn',
  /** Server -> clients (a playlist match): the results are over, go back to the lobby. */
  ToLobby: 'toLobby',
  /** Client -> server (lobby): my walker's position ([x, y, z, yaw, anim]). */
  Move: 'move',
  /** Client -> server (lobby): join a playlist queue (its mode id) or leave it (''). */
  Queue: 'queue',
  /** Server -> client (lobby): your match is ready ({ reservation, mode, arena, team, blue, orange }). */
  MatchFound: 'matchFound',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
