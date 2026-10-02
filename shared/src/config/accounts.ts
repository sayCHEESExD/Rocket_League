/**
 * PROFILE KEYS: what a player's progress is filed under.
 *
 * Two kinds, and the boundary between them is the whole point of this file.
 *
 *   - A GUEST is keyed by the id their browser generated (`p_...`). It lives
 *     in that browser's localStorage and in no other.
 *   - An ACCOUNT is keyed by `bloxity:<accountId>`, where the account id is
 *     the `_id` Bloxity's own API returned for the player's game token. It
 *     follows them to every browser and device.
 *
 * The prefix is RESERVED. A browser id that starts with it is refused
 * outright, because otherwise a guest could name themselves into somebody's
 * account by pasting the right string into localStorage. The client never
 * sends an account id at all - only the token - and the server never trusts
 * one it did not get from Bloxity.
 */

/** The prefix every account key carries, and no guest key may. */
export const ACCOUNT_KEY_PREFIX = 'bloxity:';

/** The profile key for a verified Bloxity account. */
export const accountKeyFor = (accountId: string): string => `${ACCOUNT_KEY_PREFIX}${accountId}`;

export const isAccountKey = (key: string): boolean => key.startsWith(ACCOUNT_KEY_PREFIX);

/**
 * What a browser-generated guest id may look like: URL-safe characters only,
 * a sane length, and NEVER the account prefix. The client generates
 * `p_<base36>`; the older probe scripts use `capacity-probe-N`. Both pass.
 */
const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export const isValidGuestId = (id: unknown): id is string =>
  typeof id === 'string' && GUEST_ID_PATTERN.test(id) && !isAccountKey(id);

/** What Bloxity's `_id` may look like before it is trusted as a key. */
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const isValidAccountId = (id: unknown): id is string =>
  typeof id === 'string' && ACCOUNT_ID_PATTERN.test(id);

/**
 * TWO NAMES, NOT ONE - and mixing them up is how every signed-in player ended
 * up a guest.
 *
 * The PORTAL SLUG is what the Bloxity portal lists this game under
 * (`api.bloxity.io/v1/games/rocket-league`). Login tokens are
 * minted FOR it, so it is what a token is verified against, what the SDK is
 * initialised with, and what invite links and purchases name. A token checked
 * against any other slug is rejected (401 GAME_TOKEN_INVALID) and the player
 * silently plays as a guest.
 *
 * The HOSTING ID is the Legion app (`rocket-league-game`): the deploy route, the
 * `*.play.bloxity.io` / `*.host.bloxity.io` hostnames, and the
 * `BLOXITY_GAME_ID` Legion injects into every pod. It must NEVER be used to
 * verify a token - here the two differ.
 *
 * Both are constants, shared by server and client, so there is one place to
 * change if the portal listing is ever renamed.
 */
export const BLOXITY_PORTAL_SLUG = 'rocket-league';

/** The Legion hosting id: hostnames and deploys only. See `BLOXITY_PORTAL_SLUG`. */
export const BLOXITY_HOSTING_ID = 'rocket-league-game';
