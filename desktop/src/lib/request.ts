/**
 * Shared HTTP request infrastructure for the typed API client.
 *
 * Lives in its own module so the offline sync engine (`offline/sync-engine.ts`
 * and `lib/sync-api.ts`) never imports the app API layer. This keeps the
 * dependency graph acyclic.
 */

import { clearAuthSession, getAccessToken, getRefreshToken, setAuthSession } from './auth';
import { getApiBaseUrl } from './serverConfig';

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

/** True when the failure is a transport-level problem (server unreachable). */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof ApiError && err.status === 0);
}

// Single-flight refresh. Concurrent 401s share one refresh request instead of
// hammering the backend.
let refreshPromise: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken) {
    await clearAuthSession();
    return false;
  }
  try {
    const res = await fetch(`${await getApiBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) {
      await clearAuthSession();
      return false;
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      user: { id: string; email: string; role: string };
    };
    await setAuthSession(data.access_token, data.refresh_token, data.user);
    return true;
  } catch {
    // Server unreachable. Keep the stored session and let callers handle offline.
    return false;
  }
}

function refreshOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
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
  body?: BodyInit;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, withAuth = true, headers, ...rest } = options;
  const url = `${await getApiBaseUrl()}${path}`;
  const accessToken = withAuth ? await getAccessToken() : null;

  const doFetch = (t: string | null): Promise<Response> => {
    const finalHeaders = new Headers(headers);
    if (!(rest.body instanceof FormData)) {
      finalHeaders.set('Content-Type', 'application/json');
    }
    const authToken = token !== undefined ? token : t;
    if (withAuth && authToken) {
      finalHeaders.set('Authorization', `Bearer ${authToken}`);
    }
    return fetch(url, { ...rest, headers: finalHeaders });
  };

  let res = await doFetch(accessToken).catch(() => {
    throw new ApiError('Could not reach the server', 0, 'Network Error');
  });

  // Single retry after a successful token refresh.
  if (res.status === 401 && withAuth && token === undefined) {
    const refreshed = await refreshOnce();
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
    throw new ApiError(message, res.status, res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
