import { invoke } from '@tauri-apps/api/core';
import clients from '../../google-oauth-clients.json';
import { loginWithGoogle, loginWithGoogleIdToken } from '@/lib/api';
import { storeDelete, storeGet, storeSet } from '@/lib/auth';
import { openExternal } from '@/notifications/native';

const ANDROID_CLIENT_ID = clients.androidClientId;
const DESKTOP_CLIENT_ID = clients.desktopClientId;
const ANDROID_SERVER_CLIENT_ID = clients.androidServerClientId;
const PENDING_KEY = 'pudim_google_oauth_pending';
const PENDING_TTL_MS = 10 * 60 * 1000;

export type GoogleSignInErrorCode =
  | 'GOOGLE_SIGN_IN_CANCELLED'
  | 'GOOGLE_SIGN_IN_NO_ACCOUNT'
  | 'GOOGLE_SIGN_IN_UNAVAILABLE';

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

function parseRedirect(link: string): { code: string; state: string } {
  const url = new URL(link);
  const error = url.searchParams.get('error');
  if (error) throw new Error(`Google sign-in failed: ${error}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) throw new Error('Google did not return an authorization code');
  return { code, state };
}

async function waitForDesktopRedirect(redirectUri: string): Promise<string> {
  const query = await invoke<string>('oauth_loopback_wait', { timeoutMs: 300_000 });
  return `${redirectUri}?${query}`;
}

/** Starts the system-browser Google OAuth flow and returns the backend session. */
export async function signInWithGoogle(): Promise<Awaited<ReturnType<typeof loginWithGoogle>>> {
  if (!isTauri()) throw new Error('Google sign-in requires the native app');

  if (isAndroid()) {
    const nonce = randomValue(32);
    const idToken = await invoke<string>('plugin:pudim-native|google_sign_in', {
      serverClientId: ANDROID_SERVER_CLIENT_ID,
      nonce,
    });
    return loginWithGoogleIdToken({ id_token: idToken, nonce });
  }

  const verifier = randomValue(32);
  const state = randomValue(16);
  const challenge = await pkceChallenge(verifier);
  const clientId = DESKTOP_CLIENT_ID;
  const redirectUri = `http://127.0.0.1:${await invoke<number>('oauth_loopback_start')}/oauth2redirect`;
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

  await openExternal(authorizeUrl);
  const redirect = await waitForDesktopRedirect(redirectUri);
  return completeGoogleSignIn(redirect, pending);
}

/** Extracts a Tauri rejection regardless of whether it crossed as a string or object. */
export function rejectionText(error: unknown): string | null {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}

/** Returns the stable native code embedded in a Google sign-in rejection. */
export function googleSignInErrorCode(error: unknown): GoogleSignInErrorCode | null {
  const text = rejectionText(error);
  if (!text) return null;
  if (text.includes('GOOGLE_SIGN_IN_CANCELLED')) return 'GOOGLE_SIGN_IN_CANCELLED';
  if (text.includes('GOOGLE_SIGN_IN_NO_ACCOUNT')) return 'GOOGLE_SIGN_IN_NO_ACCOUNT';
  if (text.includes('GOOGLE_SIGN_IN_UNAVAILABLE')) return 'GOOGLE_SIGN_IN_UNAVAILABLE';
  return null;
}

/** Returns native diagnostic text after removing a recognized machine code. */
export function googleSignInErrorMessage(error: unknown): string | null {
  const text = rejectionText(error)?.trim();
  if (!text) return null;
  const code = googleSignInErrorCode(error);
  if (!code) return text;
  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const detail = text
    .replace(new RegExp(`^\\s*\\[?${escapedCode}\\]?\\s*(?:[-:]\\s*)?`, 'i'), '')
    .trim();
  return detail || null;
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

export { ANDROID_CLIENT_ID, ANDROID_SERVER_CLIENT_ID, DESKTOP_CLIENT_ID };