package app.tauri.pudimnative

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import android.net.Uri
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.appcompat.app.AppCompatActivity
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
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

private const val GOOGLE_SIGN_IN_CANCELLED = "GOOGLE_SIGN_IN_CANCELLED"
private const val GOOGLE_SIGN_IN_NO_ACCOUNT =
    "No Google account is available on this device. Add a Google account in Android Settings and try again."
private const val GOOGLE_SIGN_IN_UNAVAILABLE =
    "Google sign-in is unavailable. Check your Google account and try again."

/** Last deep link delivered by the widget, for cold-start reads. */
internal object PendingDeepLink {
    @Volatile
    var value: String? = null
}

/** Last OAuth redirect delivered by Android, for cold-start reads. */
internal object PendingAuthRedirect {
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
        private const val NOTIFICATION_CAPTURED_EVENT = "notificationCaptured"
        private const val CAPTURE_ACTION_EVENT = "captureAction"
        private const val DEEP_LINK_EVENT = "deepLink"

        @Volatile
        var instance: PudimNativePlugin? = null
        private val biometricInFlight = AtomicBoolean(false)
        private val activeBiometricPrompt = AtomicReference<BiometricPrompt?>(null)

        /** Called by [NotificationListenerService] for every posted notification. */
        fun notifyPosted(payload: Map<String, Any?>): Boolean {
            val plugin = instance ?: return false
            if (!plugin.hasListener(NOTIFICATION_CAPTURED_EVENT)) return false
            // Use trigger(), not triggerObject(): JSObject is an org.json.JSONObject
            // and Jackson serializes its internal `nameValuePairs` field when it
            // is passed through triggerObject().
            plugin.trigger(NOTIFICATION_CAPTURED_EVENT, payload.toJSObject())
            return true
        }

        /** Called by [CaptureActionReceiver] when an import action is tapped. */
        fun notifyCaptureAction(payload: Map<String, Any?>): Boolean {
            val plugin = instance ?: return false
            if (!plugin.hasListener(CAPTURE_ACTION_EVENT)) return false
            plugin.trigger(CAPTURE_ACTION_EVENT, payload.toJSObject())
            return true
        }
    }

    override fun load(webView: WebView) {
        instance = this
        super.load(webView)
        extractDeepLink(activity.intent)?.let(::captureDeepLink)
    }

    override fun onDestroy(activity: AppCompatActivity) {
        if (instance === this) instance = null
        activeBiometricPrompt.getAndSet(null)?.cancelAuthentication()
        biometricInFlight.set(false)
        super.onDestroy(activity)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Widget/OAuth link tapped while the app is already running.
        extractDeepLink(intent)?.let(::captureDeepLink)
    }

    private fun extractDeepLink(intent: Intent?): String? =
        intent?.getStringExtra(DEEP_LINK_EXTRA) ?: intent?.data?.toString()

    private fun captureDeepLink(link: String) {
        if (link.startsWith("com.googleusercontent.apps.")) {
            PendingAuthRedirect.value = link
        } else {
            PendingDeepLink.value = link
        }
        emitDeepLink(link)
    }

    private fun emitDeepLink(link: String) {
        val obj = JSObject()
        obj.put("link", link)
        // See notifyPosted(): trigger() preserves the JSONObject's actual keys.
        trigger(DEEP_LINK_EVENT, obj)
    }

    /** Returns (and clears) a deep link captured at cold start. */
    @Command
    fun takeDeepLink(invoke: Invoke) {
        val value = PendingDeepLink.value
        PendingDeepLink.value = null
        // Wrapped because `resolveObject` cannot serialize a bare JSON null.
        invoke.resolveObject(mapOf("value" to value))
    }

    /** Returns (and clears) a Google OAuth redirect captured at cold start. */
    @Command
    fun takeAuthRedirect(invoke: Invoke) {
        val value = PendingAuthRedirect.value
        PendingAuthRedirect.value = null
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

    /** Opens an OAuth authorization URL in Android's system browser. */
    @Command
    fun openExternal(invoke: Invoke) {
        val args = invoke.parseArgs(ExternalUrlArgs::class.java)
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(args.url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        activity.startActivity(intent)
        invoke.resolve()
    }

    /**
     * Shows the Android Credential Manager account picker and returns a Google
     * ID token. The caller supplies a nonce so the backend can bind the token
     * to this sign-in request.
     */
    @Command
    fun googleSignIn(invoke: Invoke) {
        val args = invoke.parseArgs(GoogleSignInArgs::class.java)
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(args.serverClientId)
            .setFilterByAuthorizedAccounts(false)
            .setAutoSelectEnabled(false)
            .setNonce(args.nonce)
            .build()
        val request = GetCredentialRequest(listOf(option))
        val manager = CredentialManager.create(activity)
        manager.getCredentialAsync(
            activity,
            request,
            null,
            ContextCompat.getMainExecutor(activity),
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    val credential = result.credential
                    if (credential !is CustomCredential ||
                        credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                    ) {
                        invoke.reject("Google returned an unsupported credential")
                        return
                    }
                    try {
                        val token = GoogleIdTokenCredential.createFrom(credential.data).idToken
                        invoke.resolveObject(mapOf("id_token" to token))
                    } catch (error: GoogleIdTokenParsingException) {
                        invoke.reject("Google returned an invalid ID token", error)
                    }
                }

                override fun onError(error: GetCredentialException) {
                    when {
                        error is GetCredentialCancellationException -> {
                            // Cancellation is a normal outcome, not an authentication error.
                            invoke.reject(GOOGLE_SIGN_IN_CANCELLED)
                        }
                        error is NoCredentialException ||
                            error.errorMessage?.toString()?.contains("28433") == true -> {
                            // Play Services may report the missing-account case as the opaque
                            // bvip: 28433 message instead of NoCredentialException.
                            invoke.reject(GOOGLE_SIGN_IN_NO_ACCOUNT, error)
                        }
                        else -> invoke.reject(GOOGLE_SIGN_IN_UNAVAILABLE, error)
                    }
                }
            },
        )
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

@InvokeArg
internal class ExternalUrlArgs {
    lateinit var url: String
}

@InvokeArg
internal class GoogleSignInArgs {
    lateinit var serverClientId: String
    lateinit var nonce: String
}
