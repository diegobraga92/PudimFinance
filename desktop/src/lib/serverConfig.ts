/**
 * Server configuration for the PudimFinance client.
 *
 * The backend URL is configurable at runtime (the Server screen under Settings) and persisted
 * in localStorage so the app can be pointed at any PudimFinance server without
 * rebuilding. It prefers the user-configured URL, then VITE_API_BASE_URL, then localhost.
 *
 * `VITE_API_BASE_URL` is *defined but empty* in the web image (`desktop/Dockerfile.web`) to
 * mean **same-origin**: nginx proxies `/api` and `/health` to the backend, so a browser on
 * the LAN needs no configuration. On the desktop/Android builds the variable is unset and
 * the app falls back to `http://localhost:3000`.
 */

const SERVER_URL_KEY = 'pudim_server_url';

let cached: string | null = null;

/** Default from the environment, or localhost for dev. */
export function getDefaultServerUrl(): string {
  const env = (import.meta as { env?: { VITE_API_BASE_URL?: string } }).env;
  // `??` (not `||`) so an explicitly empty value means same-origin requests.
  return env?.VITE_API_BASE_URL ?? 'http://localhost:3000';
}

/** Normalizes a user-entered server address. Returns '' for blank input. */
export function normalizeServerUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  // Strip trailing slashes so http://host:3000/ becomes http://host:3000
  url = url.replace(/\/+$/, '');
  // Add protocol if missing so 192.168.1.100:3000 becomes http://192.168.1.100:3000
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url;
}

/**
 * Returns the current API base URL. The first call reads localStorage, and later
 * calls use the in-memory cache. Never throws, and falls back to the default.
 */
export async function getApiBaseUrl(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(SERVER_URL_KEY);
    const normalized = stored ? normalizeServerUrl(stored) : '';
    cached = normalized || getDefaultServerUrl();
  } catch {
    cached = getDefaultServerUrl();
  }
  return cached;
}

/**
 * Persists a new server URL and updates the in-memory cache so subsequent API
 * calls immediately use it. Returns the normalized value.
 */
export async function setApiBaseUrl(raw: string): Promise<string> {
  const normalized = normalizeServerUrl(raw);
  if (!normalized) {
    throw new Error('Server address cannot be empty');
  }
  localStorage.setItem(SERVER_URL_KEY, normalized);
  cached = normalized;
  return normalized;
}

/** Pings the backend `/health` endpoint to verify a server address works. */
export async function testServerConnection(raw: string): Promise<boolean> {
  const url = normalizeServerUrl(raw);
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}
