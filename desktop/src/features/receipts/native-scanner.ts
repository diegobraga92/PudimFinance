import { invoke, isTauri } from '@tauri-apps/api/core';

import type { TranslationKey } from '@/app/i18n';

/**
 * Failure codes reported by the native scanner, mirrored by `NfcQrScanCodes` in
 * the `pudim-native` plugin. Change both sides together.
 */
export type NativeScanErrorCode =
  | 'SCAN_CANCELLED'
  | 'SCAN_PERMISSION_DENIED'
  | 'SCAN_UNAVAILABLE'
  | 'SCAN_FAILED';

/** What the native scanner read, or why it read nothing. */
export interface NativeScanOutcome {
  /** Raw QR payload, exactly as printed on the receipt. */
  value: string | null;
  /** Failure code, set when no payload came back. */
  error: NativeScanErrorCode | null;
}

/**
 * Whether this build can open the full-screen native scanner.
 *
 * Android only. The browser and desktop builds keep using the WebView
 * `getUserMedia` overlay.
 */
export function nativeScannerAvailable(): boolean {
  return isTauri() && /Android/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent);
}

/** Narrows a code coming from the native side, defaulting to a generic failure. */
function toErrorCode(error: string | null | undefined): NativeScanErrorCode {
  return error === 'SCAN_CANCELLED' ||
    error === 'SCAN_PERMISSION_DENIED' ||
    error === 'SCAN_UNAVAILABLE'
    ? error
    : 'SCAN_FAILED';
}

/**
 * Opens the native scanner and waits for it to read a code.
 *
 * Never throws, so a denied permission, a platform without a scanner and a
 * failed bridge call also resolve to a failure code. The payload comes back
 * exactly as decoded, so callers still run it through `normalizeNfceQrValue`.
 */
export async function scanNfcQrNative(): Promise<NativeScanOutcome> {
  if (!nativeScannerAvailable()) return { value: null, error: 'SCAN_UNAVAILABLE' };

  try {
    const result = await invoke<{ value?: string | null; error?: string | null }>(
      'plugin:pudim-native|scan_nfc_qr',
    );
    const value = result?.value?.trim();
    if (value) return { value, error: null };
    return { value: null, error: toErrorCode(result?.error) };
  } catch {
    return { value: null, error: 'SCAN_UNAVAILABLE' };
  }
}

/**
 * Translation key for a scan failure, or null for a user cancellation.
 *
 * Backing out of the scanner is a normal outcome, so the card stays silent.
 */
export function nativeScanErrorKey(code: NativeScanErrorCode): TranslationKey | null {
  switch (code) {
    case 'SCAN_CANCELLED':
      return null;
    case 'SCAN_PERMISSION_DENIED':
      return 'receipts.cameraPermissionHint';
    case 'SCAN_UNAVAILABLE':
      return 'receipts.cameraUnavailable';
    default:
      return 'receipts.qrNotFound';
  }
}
