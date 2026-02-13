import { ServerClient } from './api/client';
import { SessionStore } from './storage/session-store';

type SessionBackend =
  | { type: 'server'; client: ServerClient }
  | { type: 'local'; store: SessionStore };

let cachedBackend: SessionBackend | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10_000; // 10 seconds

/**
 * Resolve whether to use the server or local session store.
 * Caches the result for 10s to avoid repeated health checks.
 */
export async function resolveBackend(): Promise<SessionBackend> {
  const now = Date.now();
  if (cachedBackend && now - cacheTimestamp < CACHE_TTL) {
    return cachedBackend;
  }

  const serverClient = new ServerClient();

  if (serverClient.isConfigured() && (await serverClient.isOnline())) {
    cachedBackend = { type: 'server', client: serverClient };
  } else {
    cachedBackend = { type: 'local', store: new SessionStore() };
  }

  cacheTimestamp = now;
  return cachedBackend;
}

/**
 * Get a local SessionStore (always available, used as fallback display).
 */
export function getLocalStore(): SessionStore {
  return new SessionStore();
}
