/**
 * PLAYLISTS: the three ways to play, chosen in the lobby. A mode only sizes
 * the teams (bots fill empty seats) - the cars, the ball, the arena and every
 * rule of play are the same in all of them.
 */
export const MODES = [
  { id: '1v1', label: '1V1', name: 'DUEL', teamSize: 1, color: '#ffb02f' },
  { id: '3v3', label: '3V3', name: 'STANDARD', teamSize: 3, color: '#2f9bff' },
  { id: '4v4', label: '4V4', name: 'CHAOS', teamSize: 4, color: '#ff4f7a' },
] as const;

export type ModeId = (typeof MODES)[number]['id'];

export const modeById = (id: unknown): (typeof MODES)[number] | undefined => MODES.find((m) => m.id === id);

/** The social lobby room (walk around, pick a playlist). */
export const LOBBY_ROOM = 'lobby';

export const LOBBY = {
  /** Same cap as a match room was: 15 people per lobby. */
  maxPlayers: 15,
  /**
   * A queue that is not full starts anyway this long after its first player
   * joined it - bots take the empty seats - so nobody waits on an empty playlist.
   */
  fillWaitSeconds: 10,
  /** The walkable plaza: a disc of this radius (metres) around the centre. */
  radius: 34,
  /** Fastest a walker may move (m/s) - the server rejects anything quicker. */
  maxSpeed: 9,
  /** Where the three playlist pads stand (x, z in metres; facing the centre). */
  pads: [
    [-14, -16],
    [0, -21],
    [14, -16],
  ] as const,
  /** Pad radius (m): standing on it puts you in that queue. */
  padRadius: 3.4,
} as const;

/** One live match, as the lobby board lists it (read from the match rooms' metadata). */
export interface LiveMatch {
  roomId: string;
  mode: string;
  arena: number;
  blue: number;
  orange: number;
  /** Seconds left (regulation) or played (overtime). */
  clock: number;
  overtime: boolean;
  phase: number;
  blueNames: string;
  orangeNames: string;
}

/** Server -> client (lobby): your match is ready - join with this reservation. */
export interface MatchFoundMessage {
  /** Colyseus seat reservation for the match room (opaque to the game). */
  reservation: unknown;
  mode: string;
  arena: number;
  /** The team the lobby put you on (-1: decided on arrival - joining a match in progress). */
  team: number;
  blue: string[];
  orange: string[];
  /** A match already being played (you take an empty seat in it). */
  inProgress?: boolean;
}

/** Client -> server (lobby): where I am. [x, y, z, yaw, anim] in metres / radians; anim 0 idle 1 walk 2 air. */
export type LobbyMove = [number, number, number, number, number];
