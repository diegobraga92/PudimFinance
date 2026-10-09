package app.tauri.pudimnative

/**
 * Failure codes the native QR scanner reports to the webview.
 *
 * `native-scanner.ts` turns each one into a localized hint, so these strings are
 * a cross-language contract. Change both sides together.
 */
internal object NfcQrScanCodes {
    /** The user closed the scanner. */
    const val CANCELLED = "SCAN_CANCELLED"

    /** Camera access was refused or blocked in the system settings. */
    const val PERMISSION_DENIED = "SCAN_PERMISSION_DENIED"

    /** No camera could be opened (none, busy or no preview surface). */
    const val UNAVAILABLE = "SCAN_UNAVAILABLE"

    /** The scanner ran to the end without a decodable QR code. */
    const val FAILED = "SCAN_FAILED"
}
