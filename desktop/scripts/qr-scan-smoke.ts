/**
 * QR scanner smoke test.
 *
 * Exercises the platform gate, NFC-e value validation, the scan-region planner
 * and a real jsQR decode through the camera region pipeline, using in-memory QR
 * matrices. No browser, backend, camera or canvas is required.
 */
import { create } from 'qrcode';

import {
  cameraScanSupported,
  captureIntentTarget,
  decodeQrFromRgba,
  normalizeNfceQrValue,
  scanRegions,
  SCAN_GUIDE_RATIO,
  SCAN_MAX_DECODE_PIXELS,
  SCAN_MAX_IMAGE_PIXELS,
  type ScanRegion,
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

/** A dense v2 NFC-e payload, the case that breaks the decoder once a frame is scaled down. */
const denseQrValue =
  'https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35261003476811107037650060001382121000464381%7C2%7C1%7C1%7C65f54332fdf87694facef3983611265532626ce0';

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
check(
  'dense v2 NFC-e URL is accepted',
  normalizeNfceQrValue(`  ${denseQrValue}  `) === denseQrValue,
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

function cameraFrame(
  value: string,
  errorCorrectionLevel: 'M' | 'H',
  moduleScale: number,
  frameWidth = 1280,
  frameHeight = 720,
) {
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

  return { pixels: frame, width: frameWidth, height: frameHeight };
}

interface Frame {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Approximates the canvas `drawImage` sampling, box-averaging. */
function sampleRegion(frame: Frame, region: ScanRegion): Frame {
  const pixels = new Uint8ClampedArray(region.width * region.height * 4);

  if (region.width === region.sourceWidth && region.height === region.sourceHeight) {
    for (let y = 0; y < region.height; y += 1) {
      const start = ((region.y + y) * frame.width + region.x) * 4;
      pixels.set(frame.pixels.subarray(start, start + region.width * 4), y * region.width * 4);
    }
    return { pixels, width: region.width, height: region.height };
  }

  const stepX = region.sourceWidth / region.width;
  const stepY = region.sourceHeight / region.height;

  for (let y = 0; y < region.height; y += 1) {
    const sourceYStart = Math.floor(region.y + y * stepY);
    const sourceYEnd = Math.min(frame.height, Math.ceil(region.y + (y + 1) * stepY));
    for (let x = 0; x < region.width; x += 1) {
      const sourceXStart = Math.floor(region.x + x * stepX);
      const sourceXEnd = Math.min(frame.width, Math.ceil(region.x + (x + 1) * stepX));
      let red = 0;
      let green = 0;
      let blue = 0;
      let count = 0;
      for (let sourceY = sourceYStart; sourceY < sourceYEnd; sourceY += 1) {
        for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX += 1) {
          const offset = (sourceY * frame.width + sourceX) * 4;
          red += frame.pixels[offset];
          green += frame.pixels[offset + 1];
          blue += frame.pixels[offset + 2];
          count += 1;
        }
      }
      const offset = (y * region.width + x) * 4;
      pixels[offset] = red / count;
      pixels[offset + 1] = green / count;
      pixels[offset + 2] = blue / count;
      pixels[offset + 3] = 255;
    }
  }

  return { pixels, width: region.width, height: region.height };
}

/** Runs a frame through the same region pipeline the camera uses. */
async function decodeCameraFrame(frame: Frame, maxPixels?: number) {
  for (const [index, region] of scanRegions(frame.width, frame.height, maxPixels).entries()) {
    const sampled = sampleRegion(frame, region);
    const value = await decodeQrFromRgba(sampled.pixels, sampled.width, sampled.height);
    if (value) return { value, pass: index + 1, scaled: sampled.width !== region.sourceWidth };
  }
  return { value: null, pass: 0, scaled: false };
}

const hdRegions = scanRegions(1920, 1080);
check('1080p live frame is decoded whole', hdRegions.length === 1);
check(
  '1080p live frame is never scaled down',
  hdRegions[0].x === 0 &&
    hdRegions[0].y === 0 &&
    hdRegions[0].sourceWidth === 1920 &&
    hdRegions[0].sourceHeight === 1080 &&
    hdRegions[0].width === 1920 &&
    hdRegions[0].height === 1080,
);

const uhdRegions = scanRegions(3840, 2160);
const [uhdCrop, uhdFallback] = uhdRegions;
check('4K live frame offers the guide crop before the full frame', uhdRegions.length === 2);
check(
  '4K guide crop is exact and centered',
  uhdCrop.sourceWidth === Math.round(3840 * SCAN_GUIDE_RATIO) &&
    uhdCrop.sourceHeight === Math.round(2160 * SCAN_GUIDE_RATIO) &&
    uhdCrop.width === uhdCrop.sourceWidth &&
    uhdCrop.height === uhdCrop.sourceHeight &&
    uhdCrop.x === Math.round((3840 - uhdCrop.sourceWidth) / 2) &&
    uhdCrop.y === Math.round((2160 - uhdCrop.sourceHeight) / 2),
);
check(
  '4K fallback covers the frame inside the decode budget',
  uhdFallback.x === 0 &&
    uhdFallback.y === 0 &&
    uhdFallback.sourceWidth === 3840 &&
    uhdFallback.sourceHeight === 2160 &&
    uhdFallback.width * uhdFallback.height <= SCAN_MAX_DECODE_PIXELS,
);
check(
  'scan regions stay inside the frame and never upscale',
  uhdRegions.every(
    (region) =>
      region.x >= 0 &&
      region.y >= 0 &&
      region.x + region.sourceWidth <= 3840 &&
      region.y + region.sourceHeight <= 2160 &&
      region.width <= region.sourceWidth &&
      region.height <= region.sourceHeight,
  ),
);

const photoRegions = scanRegions(4032, 3024, SCAN_MAX_IMAGE_PIXELS);
check('12 MP still image is decoded whole', photoRegions.length === 1);
check(
  '12 MP still image is never scaled down',
  photoRegions[0].sourceWidth === 4032 &&
    photoRegions[0].width === 4032 &&
    photoRegions[0].sourceHeight === 3024 &&
    photoRegions[0].height === 3024,
);

const shortCode = renderQr(qrValue, 'H', 6);
const decoded = await decodeQrFromRgba(shortCode.pixels, shortCode.size, shortCode.size);
check('jsQR decodes the generated NFC-e code', decoded === qrValue);

const blank = new Uint8ClampedArray(200 * 200 * 4);
blank.fill(255);
check('blank image has no QR result', (await decodeQrFromRgba(blank, 200, 200)) === null);

for (const errorCorrectionLevel of ['M', 'H'] as const) {
  const frame = cameraFrame(longQrValue, errorCorrectionLevel, 2);
  const result = await decodeCameraFrame(frame);
  check(
    `live ${frame.width}px frame decodes ConsultaQRCode.aspx (EC ${errorCorrectionLevel})`,
    result.value === longQrValue,
  );
}

// A receipt held at arm's length leaves a few pixels per module, so the frame
// has to reach the decoder unscaled.
for (const errorCorrectionLevel of ['M', 'H'] as const) {
  const frame = cameraFrame(denseQrValue, errorCorrectionLevel, 3, 1920, 1080);
  const result = await decodeCameraFrame(frame);
  check(
    `dense v2 payload decodes from a 1080p frame at 3 px/module (EC ${errorCorrectionLevel})`,
    result.value === denseQrValue,
  );
}

{
  const frame = cameraFrame(denseQrValue, 'M', 6, 3840, 2160);
  const result = await decodeCameraFrame(frame);
  check(
    'dense v2 payload decodes from a 4K frame through the unscaled guide crop',
    result.value === denseQrValue,
  );
  check('4K frame decodes without a scaled pass', !result.scaled);
}

{
  const frame = cameraFrame(denseQrValue, 'M', 6, 4032, 3024);
  const result = await decodeCameraFrame(frame, SCAN_MAX_IMAGE_PIXELS);
  check(
    'dense v2 payload decodes from a 12 MP still image unscaled',
    result.value === denseQrValue,
  );
  check('12 MP still image decodes without a scaled pass', !result.scaled);
}

if (failures > 0) {
  console.error(`${failures} QR scanner smoke check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log('QR scanner smoke checks passed.');
}