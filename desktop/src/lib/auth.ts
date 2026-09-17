/**
 * Auth session persistence for the desktop app.
 *
 * Secrets live in the OS keyring (via the `auth_store_*` Tauri commands) when
 * available, with two safety nets.
 *
 *  1. An in-memory cache so the request hot path never awaits the OS keyring
 *     more than once per session.
 *  2. A localStorage fallback when the keyring is unavailable (headless /
 *     LAN-server sessions) or when migrating an existing session created by
 *     an earlier build.
 *
 * The rest of the app imports only from here, so this module is the single
 * seam between the webview and native storage.
 */

import { invoke } from '@tauri-apps/api/core';

const TOKEN_KEY = 'pudim_token';
const REFRESH_TOKEN_KEY = 'pudim_refresh_token';
const USER_KEY = 'pudim_user';

export const AUTH_CHANGED_EVENT = 'pudim:auth-changed';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  display_name?: string | null;
}

interface SessionCache {
  access: string | null;
  refresh: string | null;
  user: AuthUser | null;
}

let cache: SessionCache = { access: null, refresh: null, user: null };
let cacheLoaded = false;

/** True when running inside the Tauri webview (not a plain browser tab). */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function notify(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
  }
}

export async function storeGet(key: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const value = await invoke<string | null>('auth_store_get', { key });
      if (value != null) return value;
    } catch {
      // Keyring unavailable, so fall through to localStorage.
    }
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a secret.
 *
 * The keyring is the primary store, but the value is **also** mirrored into
 * localStorage. That is deliberate: on Linux the Secret Service can accept a
 * write into a collection that does not survive the session (or the daemon is
 * absent), which silently loses the session on the next launch — the "why do I
 * have to log in again?" symptom. Reading still prefers the keyring, and
 * deleting clears both copies.
 */
export async function storeSet(key: string, value: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('auth_store_set', { key, value });
    } catch {
      // Keyring unavailable; the localStorage copy below is the fallback.
    }
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage is optional in restricted webviews.
  }
}

/** Deletes from both keyring and localStorage (never leaves a stale copy). */
export async function storeDelete(key: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke('auth_store_delete', { key });
    } catch {
      // Keyring unavailable, so there is nothing to remove there.
    }
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage is optional in restricted webviews.
  }
}

/** Loads the session into the in-memory cache (idempotent). */
export async function loadSession(): Promise<void> {
  if (cacheLoaded) return;
  const [access, refresh, userRaw] = await Promise.all([
    storeGet(TOKEN_KEY),
    storeGet(REFRESH_TOKEN_KEY),
    storeGet(USER_KEY),
  ]);
  let user: AuthUser | null = null;
  if (userRaw) {
    try {
      user = JSON.parse(userRaw) as AuthUser;
    } catch {
      user = null;
    }
  }
  cache = { access, refresh, user };
  cacheLoaded = true;
}

/** Re-reads the OS-backed session after a native worker may rotate its tokens. */
export async function reloadSession(): Promise<void> {
  cacheLoaded = false;
  await loadSession();
  notify();
}

/** Synchronous cache reads (for the request layer and the event handler). */
export function getCachedAccessToken(): string | null {
  return cache.access;
}
export function getCachedRefreshToken(): string | null {
  return cache.refresh;
}
export function getCachedStoredUser(): AuthUser | null {
  return cache.user;
}

export async function getAccessToken(): Promise<string | null> {
  await loadSession();
  return cache.access;
}

export async function getRefreshToken(): Promise<string | null> {
  await loadSession();
  return cache.refresh;
}

export async function getStoredUser(): Promise<AuthUser | null> {
  await loadSession();
  return cache.user;
}

export async function setAuthSession(
  accessToken: string,
  refreshToken: string,
  user: AuthUser,
): Promise<void> {
  cache = { access: accessToken, refresh: refreshToken, user };
  cacheLoaded = true;
  await Promise.all([
    storeSet(TOKEN_KEY, accessToken),
    storeSet(REFRESH_TOKEN_KEY, refreshToken),
    storeSet(USER_KEY, JSON.stringify(user)),
  ]);
  notify();
}

export async function clearAuthSession(): Promise<void> {
  cache = { access: null, refresh: null, user: null };
  cacheLoaded = true;
  await Promise.all([
    storeDelete(TOKEN_KEY),
    storeDelete(REFRESH_TOKEN_KEY),
    storeDelete(USER_KEY),
    isTauri()
      ? invoke('plugin:pudim-native|clear_sync_outbox').catch(() => undefined)
      : Promise.resolve(),
  ]);
  notify();
}
