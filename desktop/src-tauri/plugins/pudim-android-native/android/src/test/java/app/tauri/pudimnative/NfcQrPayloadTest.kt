package app.tauri.pudimnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NfcQrPayloadTest {

    private val nfceQr =
        "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=35261003476811107037650060001382121000464381%7C2%7C1%7C1%7C65f54332fdf87694facef3983611265532626ce0"

    @Test
    fun rawValueIsPreferredAndTrimmed() {
        assertEquals(nfceQr, NfcQrPayload.from("  $nfceQr\n", null))
    }

    @Test
    fun percentEncodedPayloadSurvivesVerbatim() {
        val value = NfcQrPayload.from(nfceQr, null)
        assertTrue(value!!.contains("%7C2%7C1%7C1%7C"))
    }

    @Test
    fun rawBytesAreDecodedWhenThePlatformHasNoString() {
        assertEquals(nfceQr, NfcQrPayload.from(null, nfceQr.toByteArray(Charsets.UTF_8)))
        assertEquals(nfceQr, NfcQrPayload.from("   ", nfceQr.toByteArray(Charsets.UTF_8)))
    }

    @Test
    fun payloadWithoutTextIsIgnored() {
        assertNull(NfcQrPayload.from(null, null))
        assertNull(NfcQrPayload.from("", null))
        assertNull(NfcQrPayload.from("   ", null))
        assertNull(NfcQrPayload.from(null, ByteArray(0)))
        assertNull(NfcQrPayload.from("", ByteArray(0)))
    }

    @Test
    fun whitespaceOnlyBytesAreIgnored() {
        assertNull(NfcQrPayload.from(null, "  \n".toByteArray(Charsets.UTF_8)))
    }
}
