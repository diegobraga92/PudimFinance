# ADR 011: Camera QR scanning for receipts

## Status

Accepted

## Context

Receipt scanning needs to work from the two kinds of information printed on an
NFC-e receipt: the QR code and the receipt text. Manually copying a QR value is
inconvenient on a phone, while OCR is slower and less reliable than reading the
QR payload directly when the code is available.

The Android client and browser client share the React frontend rendered by
Tauri. The Android webview can expose `getUserMedia` camera access through wry,
while browser camera access depends on the page being served from a secure
origin.

## Decision

Use shared web capture flows in the receipt scanner:

- Request the rear-facing camera with `navigator.mediaDevices.getUserMedia`.
- For QR capture, draw throttled video frames to a small canvas and decode them
  with the lazy, client-side `jsqr` dependency.
- For receipt-photo capture, expose a shutter that saves the current video frame
  and sends it through the same QR-first/OCR fallback as an uploaded picture.
- Accept only values containing the NFC-e `p` query parameter before sending
  them to the existing `/api/receipts/scan` endpoint.
- Stop all media tracks and animation/timer work when a scan completes, fails,
  or the scanner closes.
- Attempt QR decoding on uploaded receipt photos before falling back to OCR.
- Expose exactly four receipt capture actions: QR from camera, QR from picture,
  OCR from camera, and OCR from picture. Manual QR text entry is intentionally
  not part of the shared client flow because the printed access key does not
  contain totals or line items and the full `p=` payload is not human-friendly.
- Declare Android camera permission in the committed native plugin manifest;
  the webview requests runtime permission when `getUserMedia` starts.
- Hide the live-camera action when the current browser does not provide a
  secure camera-capable context.
- Header and overview shortcuts choose the camera-first path when available;
  unsupported contexts open the corresponding picture picker instead.

## Consequences

### Positive

- Android users can point their phone at the printed NFC-e code or photograph
  the receipt instead of typing or copying its URL.
- The same implementation works in secure browser deployments and desktop
  builds that expose WebRTC camera access.
- No new native scanner Activity, Rust command, or platform-specific result
  plumbing is required.
- Picture selection and OCR preserve compatibility with unsupported browsers,
  denied permissions, damaged codes, and ordinary non-QR receipt photos.

### Trade-offs

- Live scanning requires camera permission and a secure browser context.
- Webview camera performance varies by device; frames are downscaled and
  throttled to limit CPU usage.
- The shared web API does not provide a portable flashlight control, so the
  scanner does not expose a torch button.
- The `jsqr` decoder adds a client dependency, although it is lazy-loaded and
  therefore excluded from the initial application bundle.