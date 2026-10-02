/** Match rules and presentation timing (seconds unless noted). */
export const MATCH = {
  /** Regulation length. */
  duration: 300,
  /** Kickoff countdown (cars frozen). */
  countdown: 3,
  /** After a goal: cars keep driving, ball gone. */
  goalLinger: 3,
  /** The replay window after that. */
  replay: 4.6,
  /** Results screen before the next match. */
  results: 12,
  /** Smallest team the bots fill up to. */
  minTeamSize: 3,
} as const;

/**
 * The arenas, in rotation order. Every arena has the SAME physical shape
 * (shared/src/sim/arena.ts); only the look differs, so the list lives here
 * just so server and client agree on the ids.
 */
export const ARENAS = [
  { id: 'neon', name: 'NEON PARK' },
  { id: 'day', name: 'GRAND PRIX PARK' },
] as const;

/** How many car bodies there are (the models live in the client; the hitbox is shared). */
export const CAR_COUNT = 5;

export const Phase = {
  Countdown: 1,
  Play: 2,
  Goal: 3,
  Replay: 4,
  Ended: 5,
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const TEAMS = [
  { name: 'BLUE', color: '#2f7bff', light: '#7fb4ff', dark: '#163a8a', hex: 0x2f7bff },
  { name: 'ORANGE', color: '#ff8a1f', light: '#ffc07a', dark: '#8a3a08', hex: 0xff8a1f },
] as const;

/** Rocket League's points. */
export const POINTS = {
  goal: 100,
  assist: 50,
  save: 50,
  shot: 20,
  demo: 25,
  touch: 2,
} as const;

export const QUICK_CHATS = [
  'I got it!',
  'Need boost!',
  'Take the shot!',
  'Defending...',
  'Nice shot!',
  'What a save!',
  'Great pass!',
  'Thanks!',
  'Wow!',
  'Calculated.',
  'Close one!',
  'gg',
] as const;
