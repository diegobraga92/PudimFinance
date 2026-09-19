/**
 * Device-local preferences that are not part of the synced settings.
 *
 * Which account a new transaction starts from is a device choice (a phone may
 * not care about the desktop's default), so it lives in `localStorage` next to
 * the server address rather than in the server-backed settings.
 */

const DEFAULT_ACCOUNT_KEY = 'pudim_default_account_id';
const LAST_ACCOUNT_KEY = 'pudim_last_account_id';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Preferences are best effort: losing them only changes a preselection.
  }
}

/** Account explicitly chosen by the user, or null to use the automatic order. */
export function getDefaultAccountId(): string | null {
  return read(DEFAULT_ACCOUNT_KEY);
}

/** Sets (or clears, with null) the account new transactions start from. */
export function setDefaultAccountId(id: string | null): void {
  write(DEFAULT_ACCOUNT_KEY, id);
}

/** Last account the user actually picked for a transaction on this device. */
export function getLastUsedAccountId(): string | null {
  return read(LAST_ACCOUNT_KEY);
}

export function setLastUsedAccountId(id: string | null): void {
  write(LAST_ACCOUNT_KEY, id);
}
