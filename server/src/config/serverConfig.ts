import { BLOXITY_HOSTING_ID, BLOXITY_PORTAL_SLUG, DEFAULT_SERVER_PORT } from '@rlb/shared';

/** Runtime server configuration, overridable by environment variables. */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  /**
   * The Bloxity PORTAL slug: what a token is verified AGAINST. A constant, not
   * the `BLOXITY_GAME_ID` Legion injects (that is the hosting id).
   */
  readonly portalSlug: string;
  /** The Legion hosting id (`BLOXITY_GAME_ID`), for logs only. */
  readonly hostingId: string;
}

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** `--port N` (dev script) beats `PORT` (managed hosts inject it). */
const portArgument = (): string | undefined => {
  const at = process.argv.indexOf('--port');
  return at >= 0 ? process.argv[at + 1] : undefined;
};

export const serverConfig: ServerConfig = {
  port: int(portArgument() ?? process.env['PORT'], DEFAULT_SERVER_PORT),
  host: process.env['HOST'] ?? '0.0.0.0',
  portalSlug: BLOXITY_PORTAL_SLUG,
  hostingId: (process.env['BLOXITY_GAME_ID'] ?? '').trim() || BLOXITY_HOSTING_ID,
};
