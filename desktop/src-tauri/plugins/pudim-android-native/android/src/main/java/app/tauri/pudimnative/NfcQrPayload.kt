package app.tauri.pudimnative

/**
 * Payload extraction for the QR scanner, free of Android types so the JVM unit
 * tests can cover it without a device or ML Kit.
 */
internal object NfcQrPayload {

    /**
     * The QR payload of one decoded barcode, or null when it carries no text.
     *
     * `rawValue` wins when it has content, because that is what receipt printers
     * encode. Bytes the platform cannot map back to a string are decoded as
     * UTF-8 so those receipts stay scannable.
     */
    fun from(rawValue: String?, rawBytes: ByteArray?): String? {
        val text = rawValue?.trim()
        if (!text.isNullOrEmpty()) return text

        val bytes = rawBytes ?: return null
        if (bytes.isEmpty()) return null

        val decoded = String(bytes, Charsets.UTF_8).trim()
        return decoded.ifEmpty { null }
    }
}
