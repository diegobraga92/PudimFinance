import type jsQR from 'jsqr';

export type CaptureIntent = 'qr' | 'photo';
export type CaptureTarget = 'qr-camera' | 'qr-picture' | 'photo-camera' | 'photo-picture';

/** Maximum width used when decoding a live camera frame. */
export const SCAN_CANVAS_MAX_WIDTH = 800;
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

function scaledDimensions(width: number, height: number, maxWidth: number) {
  const scale = Math.min(1, maxWidth / width);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
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
  const { width, height } = scaledDimensions(image.naturalWidth, image.naturalHeight, 1600);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, width, height);
  return decodeQrFromRgba(context.getImageData(0, 0, width, height).data, width, height);
}