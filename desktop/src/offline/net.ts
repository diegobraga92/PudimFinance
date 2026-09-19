/** Treats the app as online only when the API server is reachable. */

import { getApiBaseUrl } from '@/lib/serverConfig';
import { logError, logEvent } from '@/lib/app-log';

const SERVER_UNAVAILABLE_MS = 15_000;
const ONLINE_CACHE_MS = 10_000;
const PROBE_TIMEOUT_MS = 3_000;

let serverUnavailableUntil = 0;
let lastOnlineProbeAt = 0;
let probeInFlight: Promise<boolean> | null = null;
const connectivityListeners = new Set<(online: boolean) => void>();
let connectivityListenersInstalled = false;
let lastKnownOnline: boolean | null = null;

function emitConnectivity(online: boolean): void {
  if (lastKnownOnline === online) return;
  lastKnownOnline = online;
  for (const listener of connectivityListeners) {
    try {
      listener(online);
    } catch {
      // Connectivity observers are not allowed to break the probe path.
    }
  }
}

function installConnectivityListeners(): void {
  if (connectivityListenersInstalled || typeof window === 'undefined') return;
  connectivityListenersInstalled = true;
  window.addEventListener('online', () => {
    clearServerProbeCache();
    void isOnline();
  });
  window.addEventListener('offline', () => emitConnectivity(false));
}

/** Subscribes to API reachability changes and immediately reports the current state. */
export function subscribeConnectivity(cb: (online: boolean) => void): () => void {
  installConnectivityListeners();
  connectivityListeners.add(cb);
  if (lastKnownOnline !== null) cb(lastKnownOnline);
  else void isOnline().then(cb);
  return () => connectivityListeners.delete(cb);
}

/**
 * Marks the API server as unreachable so `isOnline()` returns `false` without
 * probing again for a while (circuit breaker). Called after failed requests.
 */
export function markServerUnavailable(durationMs: number = SERVER_UNAVAILABLE_MS): void {
  serverUnavailableUntil = Date.now() + durationMs;
  lastOnlineProbeAt = 0;
}

/** Drops cached probe results so the next `isOnline()` check probes afresh. */
export function clearServerProbeCache(): void {
  serverUnavailableUntil = 0;
  lastOnlineProbeAt = 0;
}

/** Bypasses the breaker and performs a fresh reachability probe. */
export function probeNow(): Promise<boolean> {
  clearServerProbeCache();
  return probeServer();
}

/** Returns true while the circuit breaker is open (server recently unreachable). */
export function isServerUnavailable(): boolean {
  return Date.now() < serverUnavailableUntil;
}

/** Probes the API server's `/health` endpoint with a short timeout. */
function probeServer(): Promise<boolean> {
  if (!probeInFlight) {
    probeInFlight = (async () => {
      try {
        const base = await getApiBaseUrl();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        try {
          const res = await fetch(`${base}/health`, { signal: controller.signal });
          if (res.ok) {
            lastOnlineProbeAt = Date.now();
            emitConnectivity(true);
            return true;
          }
          logEvent('warn', 'server', `health check failed: ${res.status} ${res.statusText} (${base})`);
          markServerUnavailable();
          emitConnectivity(false);
          return false;
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        logError('server', err, 'health check unreachable');
        markServerUnavailable();
        emitConnectivity(false);
        return false;
      } finally {
        probeInFlight = null;
      }
    })();
  }
  return probeInFlight;
}

/** Returns whether the app can currently talk to the API server. */
export async function isOnline(): Promise<boolean> {
  // Circuit breaker. The server is known to be unreachable, so don't probe again yet.
  if (Date.now() < serverUnavailableUntil) return false;

  // Reuse a recent successful probe.
  if (lastOnlineProbeAt > 0 && Date.now() - lastOnlineProbeAt < ONLINE_CACHE_MS) return true;

  // No device-level link, so report offline immediately (the probe decides otherwise).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    emitConnectivity(false);
    return false;
  }

  return probeServer();
}

/** Generates a v4-like UUID string without a crypto dependency. */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
