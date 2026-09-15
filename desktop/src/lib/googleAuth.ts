import { invoke, addPluginListener } from '@tauri-apps/api/core';
import clients from '../../google-oauth-clients.json';
import { loginWithGoogle } from '@/lib/api';
import { storeDelete, storeGet, storeSet } from '@/lib/auth';
import { openExternal, takeAuthRedirect } from '@/notifications/native';

const ANDROID_CLIENT_ID = clients.androidClientId;
const DESKTOP_CLIENT_ID = clients.desktopClientId;
const PENDING_KEY = 'pudim_google_oauth_pending';
const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingOAuth {
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
  createdAt: number;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function isAndroid(): boolean {
  return /Android/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent);
}

function base64Url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomValue(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function encodeParams(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function androidRedirectUri(): string {
  return `com.googleusercontent.apps.${ANDROID_CLIENT_ID.replace('.apps.googleusercontent.com', '')}:/oauth2redirect`;
}

function parseRedirect(link: string): { code: string; state: string } {
  const url = new URL(link);
  const error = url.searchParams.get('error');
  if (error) throw new Error(`Google sign-in failed: ${error}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw new Error('Google did not return an authorization code');
  return { code, state };
}

async function waitForAndroidRedirect(): Promise<string> {
  let resolveLink: ((link: string) => void) | undefined;
  let rejectLink: ((error: Error) => void) | undefined;
  const result = new Promise<string>((resolve, reject) => {
    resolveLink = resolve;
    rejectLink = reject;
  });
  const unlisten = await addPluginListener<{ link: string }>('pudim-native', 'deepLink', (payload) => {
    if (payload.link.startsWith('com.googleusercontent.apps.')) resolveLink?.(payload.link);
  });
  try {
    const pending = await takeAuthRedirect();
    if (pending) return pending;
    return await Promise.race([
      result,
      new Promise<string>((_, reject) => {
        window.setTimeout(() => reject(new Error('Timed out waiting for Google sign-in')), 300_000);
      }),
    ]);
  } catch (error) {
    rejectLink?.(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    unlisten.unregister();
  }
}

async function waitForDesktopRedirect(redirectUri: string): Promise<string> {
  const query = await invoke<string>('oauth_loopback_wait', { timeoutMs: 300_000 });
  return `${redirectUri}?${query}`;
}

/** Starts the system-browser Google OAuth flow and returns the backend session. */
export async function signInWithGoogle(): Promise<Awaited<ReturnType<typeof loginWithGoogle>>> {
  if (!isTauri()) throw new Error('Google sign-in requires the native app');

  const verifier = randomValue(32);
  const state = randomValue(16);
  const challenge = await pkceChallenge(verifier);
  const android = isAndroid();
  const clientId = android ? ANDROID_CLIENT_ID : DESKTOP_CLIENT_ID;
  const redirectUri = android
    ? androidRedirectUri()
    : `http://127.0.0.1:${await invoke<number>('oauth_loopback_start')}/oauth2redirect`;
  const pending: PendingOAuth = {
    state,
    verifier,
    redirectUri,
    clientId,
    createdAt: Date.now(),
  };
  await storeSet(PENDING_KEY, JSON.stringify(pending));

  const authorizeUrl = `https://accounts.google.com/o/oauth2/v2/auth?${encodeParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  })}`;

  if (android) {
    const redirectPromise = waitForAndroidRedirect();
    await openExternal(authorizeUrl);
    const redirect = await redirectPromise;
    return completeGoogleSignIn(redirect, pending);
  }

  await openExternal(authorizeUrl);
  const redirect = await waitForDesktopRedirect(redirectUri);
  return completeGoogleSignIn(redirect, pending);
}

async function completeGoogleSignIn(
  redirect: string,
  fallbackPending: PendingOAuth,
): Promise<Awaited<ReturnType<typeof loginWithGoogle>>> {
  const storedRaw = await storeGet(PENDING_KEY);
  await storeDelete(PENDING_KEY);
  const pending = storedRaw ? (JSON.parse(storedRaw) as PendingOAuth) : fallbackPending;
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) throw new Error('Google sign-in request expired');
  const { code, state } = parseRedirect(redirect);
  if (state !== pending.state) throw new Error('Google sign-in state validation failed');
  return loginWithGoogle({
    code,
    code_verifier: pending.verifier,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
  });
}

export { ANDROID_CLIENT_ID, DESKTOP_CLIENT_ID };