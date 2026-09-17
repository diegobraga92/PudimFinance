/**
 * QR scanner smoke test.
 *
 * Exercises the platform gate, NFC-e value validation and a real jsQR decode
 * using an in-memory QR matrix. No browser, backend, camera or canvas is
 * required.
 */
import { create } from 'qrcode';

import {
  cameraScanSupported,
  captureIntentTarget,
  decodeQrFromRgba,
  normalizeNfceQrValue,
} from '../src/features/receipts/qr-scan';

let failures = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    console.log(`✓ ${name}`);
  } else {
    failures += 1;
    console.error(`✗ ${name}`);
  }
}

function setCameraEnvironment(isSecureContext: boolean, available: boolean): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { isSecureContext },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: available ? { mediaDevices: { getUserMedia: () => Promise.resolve({}) } } : {},
  });
}

const qrValue =
  'https://www.fazenda.gov.br/nfce/qrcode?v=2&p=35240912345678000199550010000000011000000010|2|0.00|42.90|2024-09-15|12345678000199|Market';

setCameraEnvironment(true, true);
check('secure camera environment is supported', cameraScanSupported());
setCameraEnvironment(false, true);
check('insecure camera environment is rejected', !cameraScanSupported());
setCameraEnvironment(true, false);
check('camera-less environment is rejected', !cameraScanSupported());

check('QR intent targets camera when supported', captureIntentTarget('qr', true) === 'qr-camera');
check('QR intent targets picture without camera', captureIntentTarget('qr', false) === 'qr-picture');
check('photo intent targets camera when supported', captureIntentTarget('photo', true) === 'photo-camera');
check('photo intent targets picture without camera', captureIntentTarget('photo', false) === 'photo-picture');
check('empty capture intent has no target', captureIntentTarget(null, true) === null);

check('full NFC-e URL is accepted', normalizeNfceQrValue(`  ${qrValue}  `) === qrValue);
check('NFC-e query string is accepted', normalizeNfceQrValue('?p=invoice-payload') === '?p=invoice-payload');
check('unrelated QR content is rejected', normalizeNfceQrValue('https://example.com/product/42') === null);
check('empty QR content is rejected', normalizeNfceQrValue('   ') === null);

const qr = create(qrValue, { errorCorrectionLevel: 'H' });
const quietZone = 4;
const scale = 6;
const size = (qr.modules.size + quietZone * 2) * scale;
const pixels = new Uint8ClampedArray(size * size * 4);
pixels.fill(255);

for (let y = 0; y < qr.modules.size; y += 1) {
  for (let x = 0; x < qr.modules.size; x += 1) {
    if (!qr.modules.get(y, x)) continue;
    for (let pixelY = (y + quietZone) * scale; pixelY < (y + quietZone + 1) * scale; pixelY += 1) {
      for (let pixelX = (x + quietZone) * scale; pixelX < (x + quietZone + 1) * scale; pixelX += 1) {
        const offset = (pixelY * size + pixelX) * 4;
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 255;
      }
    }
  }
}

const decoded = await decodeQrFromRgba(pixels, size, size);
check('jsQR decodes the generated NFC-e code', decoded === qrValue);

const blank = new Uint8ClampedArray(200 * 200 * 4);
blank.fill(255);
check('blank image has no QR result', (await decodeQrFromRgba(blank, 200, 200)) === null);

if (failures > 0) {
  console.error(`${failures} QR scanner smoke check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('QR scanner smoke checks passed.');
}