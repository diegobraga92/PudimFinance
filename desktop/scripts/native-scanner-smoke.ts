/**
 * Native QR scanner smoke test.
 *
 * Covers the platform gate, the failure-code mapping the card localizes, the
 * NFC-e validation the native payload feeds into and a drift check against the
 * Kotlin codes. No device, camera or Tauri runtime is needed.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  nativeScanErrorKey,
  nativeScannerAvailable,
  scanNfcQrNative,
  type NativeScanErrorCode,
} from '../src/features/receipts/native-scanner';
import { normalizeNfceQrValue } from '../src/features/receipts/qr-scan';

const here = dirname(fileURLToPath(import.meta.url));
const KOTLIN_CODES = resolve(
  here,
  '../src-tauri/plugins/pudim-android-native/android/src/main/java/app/tauri/pudimnative/NfcQrScanCodes.kt',
);

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`✓ ${name}`);
    return;
  }
  failures += 1;
  console.error(`✗ ${name}${detail ? ` (${detail})` : ''}`);
}

/** A v2 NFC-e payload as printed on a receipt. */
const nfceQrValue =
  'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35261003476811107037650060001382121000464381%7C2%7C1%7C1%7C65f54332fdf87694facef3983611265532626ce0';

const scanCodes: NativeScanErrorCode[] = [
  'SCAN_CANCELLED',
  'SCAN_PERMISSION_DENIED',
  'SCAN_UNAVAILABLE',
  'SCAN_FAILED',
];

async function main(): Promise<void> {
  console.log('Native QR scanner smoke');

  // Only the Android app has the native scanner, every other target falls back.
  check('no native scanner outside the Android app', !nativeScannerAvailable());

  const withoutRuntime = await scanNfcQrNative();
  check(
    'a scan without a runtime resolves as unavailable',
    withoutRuntime.value === null && withoutRuntime.error === 'SCAN_UNAVAILABLE',
    JSON.stringify(withoutRuntime),
  );

  // The scanner hands back the payload verbatim, validation stays in the card.
  check('a decoded NFC-e payload is accepted', normalizeNfceQrValue(nfceQrValue) === nfceQrValue);
  check(
    'a QR code that is not an NFC-e link is rejected',
    normalizeNfceQrValue('https://example.com/receipt/123') === null,
  );

  check('cancelling the scanner stays silent', nativeScanErrorKey('SCAN_CANCELLED') === null);
  check(
    'a denied permission points at the camera permission hint',
    nativeScanErrorKey('SCAN_PERMISSION_DENIED') === 'receipts.cameraPermissionHint',
  );
  check(
    'a missing camera reports the device as unsupported',
    nativeScanErrorKey('SCAN_UNAVAILABLE') === 'receipts.cameraUnavailable',
  );
  check(
    'a generic failure asks for another attempt',
    nativeScanErrorKey('SCAN_FAILED') === 'receipts.qrNotFound',
  );

  // Cross-language contract, the Kotlin scanner has to keep producing these codes.
  const kotlin = readFileSync(KOTLIN_CODES, 'utf8');
  for (const code of scanCodes) {
    check(`Kotlin still reports ${code}`, kotlin.includes(`"${code}"`));
  }

  if (failures > 0) {
    console.error(`\n${failures} native scanner check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll native scanner checks passed');
}

void main();
