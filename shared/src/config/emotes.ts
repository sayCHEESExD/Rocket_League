/**
 * Bloxity emotes. The portal draws the emote picker and sends the game a
 * catalogue id; the game plays it and replicates it. Ids are never hard-coded
 * (the catalogue grows without a game release) and ownership is never checked
 * here - Bloxity only sends ids the player is entitled to, and a second check
 * is how the two would drift apart. Only the id's SHAPE is checked: 24 hex
 * characters, a Mongo id.
 */
export const isBloxityEmoteId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);

export const EMOTE = {
  /** Fewest ticks between two emotes from one player (spam guard). */
  minGapTicks: 30,
  /** An emote the player never stops is cleared after this long. */
  maxTicks: 60 * 20,
  /**
   * A driver's hands belong to the wheel: steering past this (|steer|), a
   * jump or boost stops the emote - on the server (the replicated clear) and
   * on every screen (the same rule, so they agree). Driving straight does not.
   */
  steerStop: 0.35,
} as const;

/** Bones an emote never takes from a seated driver: the legs stay in the footwell. */
export const EMOTE_SKIP_BONES: readonly string[] = ['LegL1', 'LegL2', 'LegR1', 'LegR2'];

export interface EmoteMessage {
  id: string;
}
