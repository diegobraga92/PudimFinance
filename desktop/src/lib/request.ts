/** HTTP request infrastructure shared by the API client and offline sync. */

import { clearAuthSession, getAccessToken, getRefreshToken, setAuthSession } from './auth';
import { getApiBaseUrl } from './serverConfig';
import { logError, logEvent } from './app-log';

export class ApiError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(message: string, status: number, statusText: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
  }
}

/** Maximum time a normal API request may wait for a response. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

/** Fetches with a client-side timeout and maps transport failures to `ApiError`. */
function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort();

  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  return Promise.resolve()
    .then(() => fetch(input, { ...init, signal: controller.signal }))
    .catch(() => {
      throw new ApiError('Could not reach the server', 0, 'Network Error');
    })
    .finally(() => {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    });
}

/** True when the failure is a transport-level problem (server unreachable). */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof ApiError && err.status === 0);
}

// Single-flight refresh. Concurrent 401s share one refresh request instead of
// hammering the backend.
let refreshPromise: Promise<boolean> | null = null;

async function performRefresh(timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    logEvent('warn', 'api', 'Token refresh skipped: no stored refresh token');
    await clearAuthSession();
    return false;
  }
  try {
    const res = await fetchWithTimeout(
      `${await getApiBaseUrl()}/api/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
      timeoutMs,
    );
    if (!res.ok) {
      logEvent('error', 'api', `Token refresh failed: ${res.status} ${res.statusText}`);
      await clearAuthSession();
      return false;
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      user: { id: string; email: string; role: string; display_name?: string | null };
    };
    await setAuthSession(data.access_token, data.refresh_token, data.user);
    logEvent('info', 'api', 'Access token refreshed');
    return true;
  } catch (err) {
    // Server unreachable. Keep the stored session and let callers handle offline.
    logError('api', err, 'Token refresh unreachable');
    return false;
  }
}

function refreshOnce(timeoutMs: number): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performRefresh(timeoutMs).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Explicit bearer token override (e.g. admin-only audit endpoints). */
  token?: string | null;
  /** Set false to disable the automatic 401-refresh-and-retry flow. */
  withAuth?: boolean;
  /** Request timeout in milliseconds. Set to 0 to disable the timeout. */
  timeoutMs?: number;
  body?: BodyInit;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, withAuth = true, headers, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, ...rest } = options;
  const url = `${await getApiBaseUrl()}${path}`;
  const accessToken = withAuth ? await getAccessToken() : null;
  const method = rest.method ?? 'GET';

  const doFetch = (t: string | null): Promise<Response> => {
    const finalHeaders = new Headers(headers);
    if (!(rest.body instanceof FormData)) {
      finalHeaders.set('Content-Type', 'application/json');
    }
    const authToken = token !== undefined ? token : t;
    if (withAuth && authToken) {
      finalHeaders.set('Authorization', `Bearer ${authToken}`);
    }
    return fetchWithTimeout(url, { ...rest, headers: finalHeaders }, timeoutMs);
  };

  try {
    let res = await doFetch(accessToken);

    // Single retry after a successful token refresh.
    if (res.status === 401 && withAuth && token === undefined) {
      const refreshed = await refreshOnce(timeoutMs);
      if (refreshed) {
        res = await doFetch(await getAccessToken());
      }
    }

    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // Non-JSON error body, so fall back to the status text.
      }
      logEvent('error', 'api', `${method} ${path} failed: ${res.status} ${message}`);
      throw new ApiError(message, res.status, res.statusText);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } catch (err) {
    if (isNetworkError(err)) logError('api', err, `${method} ${path} unreachable`);
    throw err;
  }
}
