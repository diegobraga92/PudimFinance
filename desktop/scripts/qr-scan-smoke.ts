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
  SCAN_CANVAS_MAX_WIDTH,
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
  'https://www.nfce.fazenda.sp.gov.br/qrcode?p=35260901735029000265650010000183261099751411%7C3%7C1';

const longQrValue =
  'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35261006057223049855650290000277551291067331%7C3%7C1';

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
check(
  'ConsultaQRCode.aspx NFC-e URL is accepted',
  normalizeNfceQrValue(`  ${longQrValue}  `) === longQrValue,
);
check('NFC-e query string is accepted', normalizeNfceQrValue('?p=invoice-payload') === '?p=invoice-payload');
check('unrelated QR content is rejected', normalizeNfceQrValue('https://example.com/product/42') === null);
check('empty QR content is rejected', normalizeNfceQrValue('   ') === null);

function renderQr(value: string, errorCorrectionLevel: 'M' | 'H', moduleScale: number) {
  const qr = create(value, { errorCorrectionLevel });
  const quietZone = 4;
  const size = (qr.modules.size + quietZone * 2) * moduleScale;
  const pixels = new Uint8ClampedArray(size * size * 4);
  pixels.fill(255);

  for (let y = 0; y < qr.modules.size; y += 1) {
    const top = (y + quietZone) * moduleScale;
    const bottom = (y + quietZone + 1) * moduleScale;
    for (let x = 0; x < qr.modules.size; x += 1) {
      if (!qr.modules.get(y, x)) continue;
      const left = (x + quietZone) * moduleScale;
      const right = (x + quietZone + 1) * moduleScale;
      for (let pixelY = top; pixelY < bottom; pixelY += 1) {
        for (let pixelX = left; pixelX < right; pixelX += 1) {
          const offset = (pixelY * size + pixelX) * 4;
          pixels[offset] = 0;
          pixels[offset + 1] = 0;
          pixels[offset + 2] = 0;
          pixels[offset + 3] = 255;
        }
      }
    }
  }

  return { pixels, size };
}

function cameraFrame(value: string, errorCorrectionLevel: 'M' | 'H', moduleScale: number) {
  const frameWidth = 1280;
  const frameHeight = 720;
  const code = renderQr(value, errorCorrectionLevel, moduleScale);
  const frame = new Uint8ClampedArray(frameWidth * frameHeight * 4);
  frame.fill(255);

  const offsetX = Math.round((frameWidth - code.size) / 2);
  const offsetY = Math.round((frameHeight - code.size) / 2);
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      const source = (y * code.size + x) * 4;
      const target = ((offsetY + y) * frameWidth + (offsetX + x)) * 4;
      frame[target] = code.pixels[source];
      frame[target + 1] = code.pixels[source + 1];
      frame[target + 2] = code.pixels[source + 2];
      frame[target + 3] = code.pixels[source + 3];
    }
  }

  const scale = Math.min(1, SCAN_CANVAS_MAX_WIDTH / frameWidth);
  const width = Math.max(1, Math.round(frameWidth * scale));
  const height = Math.max(1, Math.round(frameHeight * scale));
  const pixels = new Uint8ClampedArray(width * height * 4);
  const stepX = frameWidth / width;
  const stepY = frameHeight / height;

  for (let y = 0; y < height; y += 1) {
    const sourceYStart = Math.floor(y * stepY);
    const sourceYEnd = Math.min(frameHeight, Math.ceil((y + 1) * stepY));
    for (let x = 0; x < width; x += 1) {
      const sourceXStart = Math.floor(x * stepX);
      const sourceXEnd = Math.min(frameWidth, Math.ceil((x + 1) * stepX));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sourceY = sourceYStart; sourceY < sourceYEnd; sourceY += 1) {
        for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX += 1) {
          const offset = (sourceY * frameWidth + sourceX) * 4;
          red += frame[offset];
          green += frame[offset + 1];
          blue += frame[offset + 2];
          count += 1;
        }
      }
      const offset = (y * width + x) * 4;
      pixels[offset] = red / count;
      pixels[offset + 1] = green / count;
      pixels[offset + 2] = blue / count;
      pixels[offset + 3] = 255;
    }
  }

  return { pixels, width, height };
}

const shortCode = renderQr(qrValue, 'H', 6);
const decoded = await decodeQrFromRgba(shortCode.pixels, shortCode.size, shortCode.size);
check('jsQR decodes the generated NFC-e code', decoded === qrValue);

const blank = new Uint8ClampedArray(200 * 200 * 4);
blank.fill(255);
check('blank image has no QR result', (await decodeQrFromRgba(blank, 200, 200)) === null);

check(
  'live frames decode at native capture resolution',
  SCAN_CANVAS_MAX_WIDTH >= 1280,
);
for (const errorCorrectionLevel of ['M', 'H'] as const) {
  const frame = cameraFrame(longQrValue, errorCorrectionLevel, 2);
  const value = await decodeQrFromRgba(frame.pixels, frame.width, frame.height);
  check(
    `live ${frame.width}px frame decodes ConsultaQRCode.aspx (EC ${errorCorrectionLevel})`,
    value === longQrValue,
  );
}

if (failures > 0) {
  console.error(`${failures} QR scanner smoke check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('QR scanner smoke checks passed.');
}