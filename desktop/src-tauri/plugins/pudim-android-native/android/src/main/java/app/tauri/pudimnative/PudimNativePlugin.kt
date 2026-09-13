package app.tauri.pudimnative

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executor

/** Intent extra carrying the home-screen widget deep link. */
const val DEEP_LINK_EXTRA = "pudim_deep_link"

/** Last deep link delivered by the widget, for cold-start reads. */
internal object PendingDeepLink {
    @Volatile
    var value: String? = null
}

/**
 * Tauri Android plugin bridging the native side and the webview.
 *
 * Command groups are notification capture (`accessGranted`, `openSettings`,
 * `drainPending`), Keystore-backed token storage (`secureGet`, `secureSet`,
 * `secureDelete`), the biometric lock (`biometricAvailable`,
 * `biometricAuthenticate`), and the home-screen Quick Add widget
 * (`setWidgetSpentToday` plus the `deepLink` event). The plugin also emits the
 * `notificationCaptured` event for live bank notifications.
 *
 * Registered from Rust via `register_android_plugin("app.tauri.pudimnative",
 * "PudimNativePlugin")` in `pudim-android-native`.
 */
@TauriPlugin
class PudimNativePlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        @Volatile
        var instance: PudimNativePlugin? = null

        /** Called by [NotificationListenerService] for every posted notification. */
        fun notifyPosted(payload: Map<String, Any?>) {
            instance?.triggerObject("notificationCaptured", payload.toJSObject())
        }
    }

    override fun load(webView: WebView) {
        instance = this
        super.load(webView)
        // Deep link from the home-screen widget at cold start (JS drains it via takeDeepLink).
        activity.intent?.getStringExtra(DEEP_LINK_EXTRA)?.let { PendingDeepLink.value = it }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Widget tapped while the app is already running, so forward immediately.
        val link = intent.getStringExtra(DEEP_LINK_EXTRA) ?: return
        PendingDeepLink.value = link
        emitDeepLink(link)
    }

    private fun emitDeepLink(link: String) {
        val obj = JSObject()
        obj.put("link", link)
        triggerObject("deepLink", obj)
    }

    /** Returns (and clears) a deep link captured at cold start. */
    @Command
    fun takeDeepLink(invoke: Invoke) {
        val value = PendingDeepLink.value
        PendingDeepLink.value = null
        invoke.resolve(value)
    }

    /** Whether a biometric authenticator (fingerprint/face) is available and enrolled. */
    @Command
    fun biometricAvailable(invoke: Invoke) {
        invoke.resolve(isBiometricAvailable())
    }

    /** Shows the system biometric prompt. Resolves true only on success. */
    @Command
    fun biometricAuthenticate(invoke: Invoke) {
        if (!isBiometricAvailable()) {
            invoke.resolve(false)
            return
        }
        val host = activity as? FragmentActivity
        if (host == null) {
            invoke.resolve(false)
            return
        }
        val executor: Executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(
            host,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    invoke.resolve(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Includes user cancel, so resolve false. A failed attempt stays open.
                    invoke.resolve(false)
                }
            },
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(activity.getString(R.string.biometric_title))
            .setSubtitle(activity.getString(R.string.biometric_subtitle))
            .setNegativeButtonText(activity.getString(android.R.string.cancel))
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_WEAK or
                    BiometricManager.Authenticators.BIOMETRIC_STRONG,
            )
            .build()
        executor.execute { prompt.authenticate(info) }
    }

    private fun isBiometricAvailable(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BiometricManager.from(activity).canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_WEAK or
                    BiometricManager.Authenticators.BIOMETRIC_STRONG,
            ) == BiometricManager.BIOMETRIC_SUCCESS
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            @Suppress("DEPRECATION")
            BiometricManager.from(activity).canAuthenticate() == BiometricManager.BIOMETRIC_SUCCESS
        } else {
            false
        }
    }

    /** Pushes a fresh "spent today" value to every home-screen widget. */
    @Command
    fun setWidgetSpentToday(invoke: Invoke) {
        val args = invoke.parseArgs(WidgetArgs::class.java)
        QuickAddWidgetProvider.pushSpentToday(activity, args.value)
        invoke.resolve()
    }

    /** Whether the user granted Android "Notification access". */
    @Command
    fun accessGranted(invoke: Invoke) {
        val granted = NotificationManagerCompat.getEnabledListenerPackages(activity)
            .contains(activity.packageName)
        invoke.resolve(granted)
    }

    /** Opens the system "Notification access" settings screen. */
    @Command
    fun openSettings(invoke: Invoke) {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
        invoke.resolve()
    }

    /** Returns (and clears) notifications captured while the app was killed. */
    @Command
    fun drainPending(invoke: Invoke) {
        val arr = JSArray()
        NotificationCaptureQueue.drain(activity).forEach { payload -> arr.put(payload.toJSObject()) }
        invoke.resolveObject(arr)
    }

    @Command
    fun secureGet(invoke: Invoke) {
        val args = invoke.parseArgs(SecureGetArgs::class.java)
        invoke.resolve(SecureStorage.get(activity, args.key))
    }

    @Command
    fun secureSet(invoke: Invoke) {
        val args = invoke.parseArgs(SecureSetArgs::class.java)
        SecureStorage.set(activity, args.key, args.value)
        invoke.resolve()
    }

    @Command
    fun secureDelete(invoke: Invoke) {
        val args = invoke.parseArgs(SecureDeleteArgs::class.java)
        SecureStorage.delete(activity, args.key)
        invoke.resolve()
    }
}

/**
 * Converts a [Map] of primitive values into a [JSObject] the webview can
 * consume. File-scope (not a class member) so both the companion object's
 * [PudimNativePlugin.notifyPosted] and instance [@Command] handlers can use it.
 */
private fun Map<String, Any?>.toJSObject(): JSObject {
    val obj = JSObject()
    for ((key, value) in this) {
        when (value) {
            is String -> obj.put(key, value)
            is Long -> obj.put(key, value)
            is Int -> obj.put(key, value)
            is Double -> obj.put(key, value)
            is Boolean -> obj.put(key, value)
            else -> obj.put(key, value?.toString())
        }
    }
    return obj
}

@InvokeArg
internal class WidgetArgs {
    lateinit var value: String
}

@InvokeArg
internal class SecureGetArgs {
    lateinit var key: String
}

@InvokeArg
internal class SecureSetArgs {
    lateinit var key: String
    lateinit var value: String
}

@InvokeArg
internal class SecureDeleteArgs {
    lateinit var key: String
}
