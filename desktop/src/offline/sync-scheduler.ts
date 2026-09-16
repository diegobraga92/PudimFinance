import { countPendingOperations, syncAll } from './sync-engine';
import { isOnline, isServerUnavailable, probeNow } from './net';

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let wakeRequested = false;

const ACTIVE_DELAY_MS = 15_000;
const IDLE_DELAY_MS = 60_000;

async function pass(): Promise<void> {
  if (!running) return;
  wakeRequested = false;
  try {
    const pending = await countPendingOperations();
    if (pending > 0 && !isServerUnavailable()) {
      await syncAll();
    } else if (!isServerUnavailable()) {
      await probeNow();
    }
  } catch {
    // Sync errors are reflected by the engine/banner; the scheduler must live.
  } finally {
    if (running) {
      const pending = await countPendingOperations().catch(() => 0);
      timer = setTimeout(() => void pass(), pending > 0 ? ACTIVE_DELAY_MS : IDLE_DELAY_MS);
    }
  }
}

function wake(): void {
  if (!running || wakeRequested) return;
  wakeRequested = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void pass(), 0);
}

/** Starts the foreground sync loop. Safe to call more than once. */
export function startSyncScheduler(): () => void {
  if (running) return stopSyncScheduler;
  running = true;
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
  void pass();
  return stopSyncScheduler;
}

/** Stops the scheduler and removes its browser listeners. */
export function stopSyncScheduler(): void {
  running = false;
  wakeRequested = false;
  if (timer) clearTimeout(timer);
  timer = null;
  window.removeEventListener('online', wake);
  window.removeEventListener('focus', wake);
  document.removeEventListener('visibilitychange', wake);
}

/** Requests an immediate sync after a capture or other local mutation. */
export function requestSync(): void {
  wake();
}

// Keep `isOnline` in this module's dependency graph intentional: importing the
// scheduler should not accidentally make a failed health probe unhandled.
void isOnline;