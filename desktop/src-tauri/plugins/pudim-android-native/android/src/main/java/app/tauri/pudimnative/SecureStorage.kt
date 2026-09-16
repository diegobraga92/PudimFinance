package app.tauri.pudimnative

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Minimal token store backed by the Android Keystore. An AES-256/GCM key is
 * generated once (non-exportable, kept in hardware-backed storage when
 * available) and used to encrypt values that are persisted in regular
 * SharedPreferences. This replaces the OS keyring (`keyring` crate) which has
 * no reliable Android backend.
 *
 * Used by the Rust `auth_store_*` commands on the Android target.
 */
internal object SecureStorage {
    private const val PREFS = "pudim_secure_store"
    private const val KEY_ALIAS = "pudimfinance_auth_key"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val GCM_TAG_BITS = 128
    private const val IV_LENGTH = 12

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    fun set(context: Context, name: String, value: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val blob = cipher.iv + encrypted
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(name, Base64.encodeToString(blob, Base64.NO_WRAP))
            // commit() so a fresh process can read the value even if the OS
            // kills the app right after the webview finishes the IPC call.
            .commit()
    }

    fun get(context: Context, name: String): String? {
        val encoded = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(name, null) ?: return null
        return try {
            val blob = Base64.decode(encoded, Base64.NO_WRAP)
            val iv = blob.copyOfRange(0, IV_LENGTH)
            val data = blob.copyOfRange(IV_LENGTH, blob.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(data), Charsets.UTF_8)
        } catch (_: Exception) {
            // Corrupted/tampered ciphertext (or key rotation), so treat as missing.
            null
        }
    }

    fun delete(context: Context, name: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(name).commit()
    }
}
