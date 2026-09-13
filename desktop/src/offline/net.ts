/**
 * Connectivity helper for the desktop app.
 *
 * "Online" means the API server is actually reachable, not just that the OS
 * has a network link. When the server is unreachable (server down, wrong
 * address, LAN host not reachable) we treat the app as offline so mutations
 * queue and reads fall back to the local mirror instead of hanging.
 */

import { getApiBaseUrl } from '@/lib/serverConfig';

/** The API server is treated as unreachable for this long after a failed probe. */
const SERVER_UNAVAILABLE_MS = 15_000;
/** A successful probe is reused within this window instead of re-probing. */
const ONLINE_CACHE_MS = 10_000;
/** Health-probe timeout. */
const PROBE_TIMEOUT_MS = 3_000;

let serverUnavailableUntil = 0;
let lastOnlineProbeAt = 0;
let probeInFlight: Promise<boolean> | null = null;

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
            return true;
          }
          markServerUnavailable();
          return false;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        markServerUnavailable();
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
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

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
