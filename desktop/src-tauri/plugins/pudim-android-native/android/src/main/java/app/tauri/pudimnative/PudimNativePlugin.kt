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
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

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
        private val biometricInFlight = AtomicBoolean(false)
        private val activeBiometricPrompt = AtomicReference<BiometricPrompt?>(null)

        /** Called by [NotificationListenerService] for every posted notification. */
        fun notifyPosted(payload: Map<String, Any?>): Boolean {
            val plugin = instance ?: return false
            if (!plugin.webViewActive) return false
            plugin.triggerObject("notificationCaptured", payload.toJSObject())
            return true
        }

        /** Called by [CaptureActionReceiver] when an import action is tapped. */
        fun notifyCaptureAction(payload: Map<String, Any?>): Boolean {
            val plugin = instance ?: return false
            if (!plugin.webViewActive) return false
            plugin.triggerObject("captureAction", payload.toJSObject())
            return true
        }
    }

    @Volatile
    private var webViewActive = false

    override fun load(webView: WebView) {
        instance = this
        // Tauri creates/loads the WebView during activity startup, and plugin
        // load can happen after the Activity's first onResume callback. Treat
        // a loaded WebView as active; later lifecycle callbacks mark it paused
        // or stopped explicitly.
        webViewActive = true
        super.load(webView)
        // Deep link from the home-screen widget at cold start (JS drains it via takeDeepLink).
        activity.intent?.getStringExtra(DEEP_LINK_EXTRA)?.let { PendingDeepLink.value = it }
    }

    override fun onResume() {
        super.onResume()
        webViewActive = true
    }

    override fun onPause() {
        webViewActive = false
        super.onPause()
    }

    override fun onStop() {
        webViewActive = false
        super.onStop()
    }

    override fun onDestroy(activity: AppCompatActivity) {
        webViewActive = false
        if (instance === this) instance = null
        activeBiometricPrompt.getAndSet(null)?.cancelAuthentication()
        biometricInFlight.set(false)
        super.onDestroy(activity)
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
        // Wrapped because `resolveObject` cannot serialize a bare JSON null.
        invoke.resolveObject(mapOf("value" to value))
    }

    /** Whether a biometric authenticator (fingerprint/face) is available and enrolled. */
    @Command
    fun biometricAvailable(invoke: Invoke) {
        invoke.resolveObject(isBiometricAvailable())
    }

    /** Shows the system biometric prompt. Resolves true only on success. */
    @Command
    fun biometricAuthenticate(invoke: Invoke) {
        if (!isBiometricAvailable()) {
            invoke.resolveObject(false)
            return
        }
        val host = activity as? FragmentActivity
        if (
            host == null ||
            activity.isFinishing ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && activity.isDestroyed) ||
            !host.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED) ||
            !biometricInFlight.compareAndSet(false, true)
        ) {
            invoke.resolveObject(false)
            return
        }

        lateinit var prompt: BiometricPrompt
        fun finish(result: Boolean) {
            if (biometricInFlight.compareAndSet(true, false)) {
                activeBiometricPrompt.compareAndSet(prompt, null)
                invoke.resolveObject(result)
            }
        }

        val executor: Executor = ContextCompat.getMainExecutor(activity)
        prompt = BiometricPrompt(
            host,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    finish(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Includes user cancel, so resolve false. A failed attempt stays open.
                    finish(false)
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
        activeBiometricPrompt.set(prompt)
        executor.execute {
            if (activity.isFinishing || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && activity.isDestroyed)) {
                finish(false)
            } else {
                prompt.authenticate(info)
            }
        }
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
        invoke.resolveObject(granted)
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
        invoke.resolveObject(NotificationCaptureQueue.drain(activity))
    }

    /** Posts the income/debit/credit import prompt for a captured transaction. */
    @Command
    fun showCapturePrompt(invoke: Invoke) {
        val args = invoke.parseArgs(CapturePromptArgs::class.java)
        CapturePromptNotifier.show(activity, args.id, args.title, args.body, args.appLabel)
        invoke.resolve()
    }

    /** Dismisses a capture-prompt notification the user already handled in-app. */
    @Command
    fun cancelCapturePrompt(invoke: Invoke) {
        val args = invoke.parseArgs(CaptureIdArgs::class.java)
        CapturePromptNotifier.cancel(activity, args.id)
        invoke.resolve()
    }

    /** Returns (and clears) import actions tapped while the app was killed. */
    @Command
    fun drainCaptureActions(invoke: Invoke) {
        invoke.resolveObject(PendingCaptureActions.drain(activity))
    }

    /** Whether the OS currently allows posting notifications. */
    @Command
    fun notificationPostingAllowed(invoke: Invoke) {
        invoke.resolveObject(CapturePromptNotifier.postingAllowed(activity))
    }

    /** Requests the Android 13+ `POST_NOTIFICATIONS` permission if needed. */
    @Command
    fun requestNotificationPermission(invoke: Invoke) {
        invoke.resolveObject(CapturePromptNotifier.requestPermission(activity))
    }

    /**
     * Mirrors the webview's capture settings so the listener can honor them
     * (and post prompts) while the app process is dead.
     */
    @Command
    fun setCaptureSettings(invoke: Invoke) {
        val args = invoke.parseArgs(CaptureSettingsArgs::class.java)
        CaptureSettingsStore.save(activity, args.enabled, args.pushPrompt, args.monitoredApps)
        invoke.resolve()
    }

    @Command
    fun secureGet(invoke: Invoke) {
        val args = invoke.parseArgs(SecureGetArgs::class.java)
        // Wrapped because `resolveObject` cannot serialize a bare JSON null.
        invoke.resolveObject(mapOf("value" to SecureStorage.get(activity, args.key)))
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
internal class CapturePromptArgs {
    lateinit var id: String
    lateinit var title: String
    lateinit var body: String
    lateinit var appLabel: String
}

@InvokeArg
internal class CaptureIdArgs {
    lateinit var id: String
}

@InvokeArg
internal class CaptureSettingsArgs {
    var enabled: Boolean = false
    var pushPrompt: Boolean = true
    var monitoredApps: List<String> = emptyList()
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
