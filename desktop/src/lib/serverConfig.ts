/** Runtime server URL, persisted locally and falling back to the build-time default. */

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
  // Pasted addresses often come from prose and end with sentence punctuation.
  // It is not part of a server base URL and otherwise makes the health check
  // target a different host/port path.
  url = url.replace(/[.,;]+$/, '');
  // Strip trailing slashes so http://host:3000/ becomes http://host:3000.
  // Apply punctuation cleanup twice so values such as `host:3000./` are also
  // normalized without preserving either delimiter.
  url = url.replace(/\/+$/, '').replace(/[.,;]+$/, '').replace(/\/+$/, '');
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
