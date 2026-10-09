import type jsQR from 'jsqr';

export type CaptureIntent = 'qr' | 'photo';
export type CaptureTarget = 'qr-camera' | 'qr-picture' | 'photo-camera' | 'photo-picture';

/** Fraction of each frame side covered by the on-screen QR guide box. */
export const SCAN_GUIDE_RATIO = 2 / 3;
/**
 * Largest frame handed to the decoder in a single unscaled pass.
 *
 * Resampling blurs the modules of a dense QR code, so frames inside this budget
 * are decoded whole at native resolution.
 */
export const SCAN_MAX_DECODE_PIXELS = 4_000_000;
/**
 * Pixel budget for a still image, which is decoded once and can be much larger
 * than a live frame.
 */
export const SCAN_MAX_IMAGE_PIXELS = 16_000_000;
/** Minimum delay between live camera decode attempts. */
export const SCAN_INTERVAL_MS = 120;
/** Time after which a live scan gives up and lets the user try again. */
export const SCAN_TIMEOUT_MS = 20_000;

type JsQr = typeof jsQR;

let decoderPromise: Promise<JsQr> | null = null;

function loadDecoder(): Promise<JsQr> {
  decoderPromise ??= import('jsqr').then((module) => module.default);
  return decoderPromise;
}

/** Whether this browser can use a live camera from the current origin. */
export function cameraScanSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Selects the camera-first capture path, with a picture fallback. */
export function captureIntentTarget(
  intent: CaptureIntent | null,
  cameraSupported: boolean,
): CaptureTarget | null {
  if (intent === 'qr') return cameraSupported ? 'qr-camera' : 'qr-picture';
  if (intent === 'photo') return cameraSupported ? 'photo-camera' : 'photo-picture';
  return null;
}

/** Keeps only QR values understood by the NFC-e endpoint. */
export function normalizeNfceQrValue(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.searchParams.has('p') && url.searchParams.get('p')?.trim()) return value;
  } catch {
    // The backend also accepts a query string without a scheme, so inspect it
    // below instead of requiring every state to print a complete URL.
  }

  if (/(?:^|[?&])p=[^&]+/i.test(value)) return value;
  return null;
}

/** Decodes one RGBA image buffer with the lazily loaded QR decoder. */
export async function decodeQrFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string | null> {
  const decoder = await loadDecoder();
  return decoder(data, width, height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** One crop of a captured frame handed to the decoder. */
export interface ScanRegion {
  /** Crop origin inside the source frame, in source pixels. */
  x: number;
  y: number;
  /** Crop size inside the source frame, in source pixels. */
  sourceWidth: number;
  sourceHeight: number;
  /** Size the crop is sampled into, equal to the source size when unscaled. */
  width: number;
  height: number;
}

/** Largest size that stays inside `maxPixels`, never scaling an image up. */
function boundedSize(width: number, height: number, maxPixels: number) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  // Flooring keeps `width * height` inside the budget, rounding up does not.
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

/**
 * Decoder passes for one captured frame, in the order they are tried.
 *
 * Frames inside the budget are decoded whole and unscaled. Larger frames are
 * tried through the native-resolution guide-box crop first, then through the
 * scaled full frame for codes outside the guide box.
 */
export function scanRegions(
  width: number,
  height: number,
  maxPixels = SCAN_MAX_DECODE_PIXELS,
): ScanRegion[] {
  const full = boundedSize(width, height, maxPixels);
  if (full.width === width && full.height === height) {
    return [{ x: 0, y: 0, sourceWidth: width, sourceHeight: height, width, height }];
  }

  const cropWidth = Math.max(1, Math.round(width * SCAN_GUIDE_RATIO));
  const cropHeight = Math.max(1, Math.round(height * SCAN_GUIDE_RATIO));
  const crop = boundedSize(cropWidth, cropHeight, maxPixels);
  return [
    {
      x: Math.round((width - cropWidth) / 2),
      y: Math.round((height - cropHeight) / 2),
      sourceWidth: cropWidth,
      sourceHeight: cropHeight,
      width: crop.width,
      height: crop.height,
    },
    { x: 0, y: 0, sourceWidth: width, sourceHeight: height, width: full.width, height: full.height },
  ];
}

/** Decodes an image data URL, used before falling back to OCR for receipt photos. */
export async function decodeQrFromImage(imageSource: string): Promise<string | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;

  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Unable to load receipt image'));
    image.src = imageSource;
  });

  if (!image.naturalWidth || !image.naturalHeight) return null;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  for (const region of scanRegions(image.naturalWidth, image.naturalHeight, SCAN_MAX_IMAGE_PIXELS)) {
    canvas.width = region.width;
    canvas.height = region.height;
    context.drawImage(
      image,
      region.x,
      region.y,
      region.sourceWidth,
      region.sourceHeight,
      0,
      0,
      region.width,
      region.height,
    );
    const value = await decodeQrFromRgba(
      context.getImageData(0, 0, region.width, region.height).data,
      region.width,
      region.height,
    );
    if (value) return value;
  }

  return null;
}