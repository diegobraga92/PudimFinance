package app.tauri.pudimnative

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.OnBackPressedDispatcherOwner
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.TorchState
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Full-screen QR scanner drawn over the WebView, because the WebView preview
 * cannot focus, zoom or light the code. CameraX binds to the host activity and
 * ML Kit decodes every frame on a background thread.
 *
 * [onFinish] runs once, on the main thread, with the raw payload or one of the
 * [NfcQrScanCodes].
 */
internal class NfcQrScanner(
    private val activity: Activity,
    private val onFinish: (value: String?, error: String?) -> Unit,
) {
    private val finished = AtomicBoolean(false)
    private val container = FrameLayout(activity)
    private val previewView = PreviewView(activity)
    private val analyzerExecutor = Executors.newSingleThreadExecutor()
    private val mlKitScanner: BarcodeScanner = BarcodeScanning.getClient(
        BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    )
    private val scaleDetector = ScaleGestureDetector(activity, ZoomGesture())

    private lateinit var flashView: TextView
    private var provider: ProcessCameraProvider? = null
    private var camera: Camera? = null
    private var backCallback: OnBackPressedCallback? = null

    fun start() {
        val owner = activity as? LifecycleOwner
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        if (owner == null || content == null) {
            finish(null, NfcQrScanCodes.UNAVAILABLE)
            return
        }
        if (!hasCameraPermission()) {
            finish(null, NfcQrScanCodes.PERMISSION_DENIED)
            return
        }

        buildOverlay(content)
        watchBackPress(owner)
        bindCamera(owner)
    }

    fun cancel() = finish(null, NfcQrScanCodes.CANCELLED)

    /** Closes the overlay without a result when the activity is destroyed. */
    fun release() {
        if (finished.compareAndSet(false, true)) tearDown()
    }

    private fun hasCameraPermission(): Boolean =
        ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED

    private fun buildOverlay(content: ViewGroup) {
        val density = activity.resources.displayMetrics.density
        val metrics = activity.resources.displayMetrics

        container.setBackgroundColor(Color.BLACK)
        // Swallows the taps that would otherwise reach the WebView underneath.
        container.setOnTouchListener { _, _ -> true }

        // COMPATIBLE keeps the preview in the regular view hierarchy, so the
        // guide box and the chips draw on top of it.
        previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        previewView.setOnTouchListener { _, event -> onPreviewTouch(event) }
        container.addView(previewView, matchParent())

        // Matches the frame the WebView overlay draws, so aiming feels the same.
        val guide = (minOf(metrics.widthPixels, metrics.heightPixels) * GUIDE_RATIO).toInt()
        container.addView(
            guideBox(guide, (2 * density).toInt()),
            FrameLayout.LayoutParams(guide, guide, Gravity.CENTER),
        )

        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        column.addView(
            label(activity.getString(R.string.scan_qr_hint)),
            wrap().apply { bottomMargin = (SPACING_DP * density).toInt() },
        )

        val actions = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        flashView = label(activity.getString(R.string.scan_qr_flash_off)).apply {
            setOnClickListener { toggleTorch() }
        }
        actions.addView(flashView, wrap().apply { marginEnd = (SPACING_DP * density).toInt() })
        actions.addView(
            label(activity.getString(R.string.scan_qr_close)).apply {
                setOnClickListener { cancel() }
            },
        )
        column.addView(actions)
        container.addView(
            column,
            FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL)
                .apply { bottomMargin = (SPACING_DP * 3 * density).toInt() },
        )

        content.addView(container, matchParent())
    }

    private fun matchParent() = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)

    private fun wrap() = LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT)

    private fun guideBox(size: Int, strokeWidth: Int): View = View(activity).apply {
        background = GradientDrawable().apply {
            setColor(Color.TRANSPARENT)
            setStroke(strokeWidth, Color.WHITE)
            cornerRadius = size * GUIDE_CORNER_RATIO
        }
    }

    private fun label(text: String): TextView = TextView(activity).apply {
        val density = activity.resources.displayMetrics.density
        val padX = (16 * density).toInt()
        val padY = (8 * density).toInt()
        setText(text)
        setTextColor(Color.WHITE)
        textSize = LABEL_SIZE_SP
        gravity = Gravity.CENTER
        setPadding(padX, padY, padX, padY)
        background = GradientDrawable().apply {
            setColor(Color.argb(160, 0, 0, 0))
            cornerRadius = 20 * density
        }
    }

    private fun watchBackPress(owner: LifecycleOwner) {
        val dispatcherOwner = activity as? OnBackPressedDispatcherOwner ?: return
        val callback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                cancel()
            }
        }
        backCallback = callback
        dispatcherOwner.onBackPressedDispatcher.addCallback(owner, callback)
    }

    // start() checks the camera permission before the overlay is shown.
    @SuppressLint("MissingPermission")
    private fun bindCamera(owner: LifecycleOwner) {
        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            if (finished.get()) return@addListener
            try {
                val cameraProvider = future.get()
                provider = cameraProvider
                val preview = Preview.Builder().build().apply {
                    setSurfaceProvider(previewView.surfaceProvider)
                }
                // Drops stale frames instead of queueing them, which keeps the preview smooth.
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                    .apply { setAnalyzer(analyzerExecutor) { image -> analyze(image) } }

                cameraProvider.unbindAll()
                val bound = cameraProvider.bindToLifecycle(
                    owner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    analysis,
                )
                camera = bound
                flashView.visibility = if (bound.cameraInfo.hasFlashUnit()) View.VISIBLE else View.GONE
            } catch (error: Exception) {
                Log.e(TAG, "Camera could not be opened", error)
                finish(null, NfcQrScanCodes.UNAVAILABLE)
            }
        }, ContextCompat.getMainExecutor(activity))
    }

    private fun analyze(image: ImageProxy) {
        val mediaImage = image.image
        if (finished.get() || mediaImage == null) {
            image.close()
            return
        }
        val input = InputImage.fromMediaImage(mediaImage, image.imageInfo.rotationDegrees)
        mlKitScanner.process(input)
            .addOnSuccessListener { barcodes ->
                for (barcode in barcodes) {
                    val value = NfcQrPayload.from(barcode.rawValue, barcode.rawBytes)
                    if (value != null) {
                        finish(value, null)
                        return@addOnSuccessListener
                    }
                }
            }
            .addOnFailureListener { error -> Log.w(TAG, "QR decoding failed", error) }
            // Closing the frame releases it back to the camera.
            .addOnCompleteListener { image.close() }
    }

    private fun onPreviewTouch(event: MotionEvent): Boolean {
        scaleDetector.onTouchEvent(event)
        if (event.actionMasked == MotionEvent.ACTION_UP && !scaleDetector.isInProgress) {
            focusAt(event.x, event.y)
        }
        return true
    }

    private fun focusAt(x: Float, y: Float) {
        val target = camera ?: return
        val point = previewView.meteringPointFactory.createPoint(x, y)
        val action = FocusMeteringAction.Builder(
            point,
            FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE,
        )
            .setAutoCancelDuration(FOCUS_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .build()
        target.cameraControl.startFocusAndMetering(action)
    }

    private fun toggleTorch() {
        val target = camera ?: return
        if (!target.cameraInfo.hasFlashUnit()) return
        val lit = target.cameraInfo.torchState.value == TorchState.ON
        target.cameraControl.enableTorch(!lit)
        flashView.setText(if (lit) R.string.scan_qr_flash_off else R.string.scan_qr_flash_on)
    }

    private fun finish(value: String?, error: String?) {
        if (!finished.compareAndSet(false, true)) return
        tearDown()
        onFinish(value, error)
    }

    private fun tearDown() {
        // The androidx.activity version this plugin builds on has no
        // `removeCallback`, so unregistering goes through the callback itself.
        backCallback?.remove()
        backCallback = null

        provider?.unbindAll()
        provider = null
        camera = null
        try {
            mlKitScanner.close()
        } catch (error: Exception) {
            Log.w(TAG, "Barcode scanner could not be closed", error)
        }
        analyzerExecutor.shutdown()
        (container.parent as? ViewGroup)?.removeView(container)
        container.removeAllViews()
    }

    private inner class ZoomGesture : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val target = camera ?: return false
            val state = target.cameraInfo.zoomState.value ?: return false
            val ratio = (state.zoomRatio * detector.scaleFactor)
                .coerceIn(state.minZoomRatio, state.maxZoomRatio)
            target.cameraControl.setZoomRatio(ratio)
            return true
        }
    }

    private companion object {
        const val TAG = "PudimNfcQrScanner"

        /** Guide box side as a share of the shortest screen side. */
        const val GUIDE_RATIO = 0.7f

        const val GUIDE_CORNER_RATIO = 0.08f
        const val SPACING_DP = 8f
        const val LABEL_SIZE_SP = 15f
        const val FOCUS_TIMEOUT_SECONDS = 5L

        val MATCH_PARENT = ViewGroup.LayoutParams.MATCH_PARENT
        val WRAP_CONTENT = ViewGroup.LayoutParams.WRAP_CONTENT
    }
}
