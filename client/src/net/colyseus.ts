import { Client } from 'colyseus.js';
import { clientConfig } from '../config/clientConfig.js';

let client: Client | null = null;

/** The one Colyseus client: the lobby and the match rooms share its endpoint (and seat reservations need it). */
export const sharedClient = (): Client => {
  if (!clientConfig.serverUrl) throw new Error('no game server configured (VITE_SERVER_URL)');
  client ??= new Client(clientConfig.serverUrl);
  return client;
};
