import * as React from 'react';
import { Camera, ScanLine, X } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  cameraScanSupported,
  decodeQrFromRgba,
  normalizeNfceQrValue,
  SCAN_CANVAS_MAX_WIDTH,
  SCAN_INTERVAL_MS,
  SCAN_TIMEOUT_MS,
} from './qr-scan';

export type CameraCaptureMode = 'qr' | 'photo';

interface Props {
  mode: CameraCaptureMode;
  onDecoded?: (value: string) => void | Promise<void>;
  onCaptured?: (source: string) => void | Promise<void>;
  onClose: () => void;
}

type CameraStatus = 'starting' | 'scanning' | 'error' | 'done';

type CameraTranslationKey =
  | 'receipts.cameraUnsupported'
  | 'receipts.cameraPermissionHint'
  | 'receipts.cameraUnavailable'
  | 'receipts.qrNotFound';

function cameraErrorMessage(
  error: unknown,
  t: (key: CameraTranslationKey) => string,
): string {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return t('receipts.cameraPermissionHint');
  }
  if (
    error instanceof Error &&
    (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')
  ) {
    return t('receipts.cameraUnavailable');
  }
  if (error instanceof Error && error.name === 'ScanTimeoutError') {
    return t('receipts.qrNotFound');
  }
  return t('receipts.cameraUnsupported');
}

/** Shared live camera capture for NFC-e QR codes and receipt photos. */
export function CameraCapture({ mode, onDecoded, onCaptured, onClose }: Props) {
  const { t } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const frameRef = React.useRef<number | null>(null);
  const timeoutRef = React.useRef<number | null>(null);
  const activeRef = React.useRef(true);
  const decodingRef = React.useRef(false);
  const lastScanAtRef = React.useRef(0);
  const rejectedValueRef = React.useRef<string | null>(null);
  const onDecodedRef = React.useRef(onDecoded);
  const onCapturedRef = React.useRef(onCaptured);
  const onCloseRef = React.useRef(onClose);
  const [status, setStatus] = React.useState<CameraStatus>('starting');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    onDecodedRef.current = onDecoded;
  }, [onDecoded]);

  React.useEffect(() => {
    onCapturedRef.current = onCaptured;
  }, [onCaptured]);

  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  React.useEffect(() => {
    activeRef.current = true;
    let mounted = true;

    const stopStream = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      frameRef.current = null;
      timeoutRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const fail = (reason: unknown) => {
      if (!mounted || !activeRef.current) return;
      stopStream();
      setError(cameraErrorMessage(reason, t));
      setStatus('error');
    };

    const scheduleFrame = () => {
      if (mode === 'qr' && mounted && activeRef.current) {
        frameRef.current = requestAnimationFrame(scanFrame);
      }
    };

    const scanFrame = async (timestamp: number) => {
      if (!mounted || !activeRef.current || mode !== 'qr') return;
      if (timestamp - lastScanAtRef.current < SCAN_INTERVAL_MS || decodingRef.current) {
        scheduleFrame();
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        scheduleFrame();
        return;
      }

      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      if (!videoWidth || !videoHeight) {
        scheduleFrame();
        return;
      }

      lastScanAtRef.current = timestamp;
      decodingRef.current = true;
      const scale = Math.min(1, SCAN_CANVAS_MAX_WIDTH / videoWidth);
      const width = Math.max(1, Math.round(videoWidth * scale));
      const height = Math.max(1, Math.round(videoHeight * scale));
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      if (context) {
        context.drawImage(video, 0, 0, width, height);
        try {
          const rawValue = await decodeQrFromRgba(
            context.getImageData(0, 0, width, height).data,
            width,
            height,
          );
          const value = rawValue ? normalizeNfceQrValue(rawValue) : null;
          if (value) {
            activeRef.current = false;
            stopStream();
            setStatus('done');
            void onDecodedRef.current?.(value);
            return;
          }
          if (rawValue && rejectedValueRef.current !== rawValue) {
            rejectedValueRef.current = rawValue;
            setError(t('receipts.cameraNotNfce'));
          }
        } catch (reason) {
          fail(reason);
          return;
        } finally {
          decodingRef.current = false;
        }
      } else {
        decodingRef.current = false;
      }

      scheduleFrame();
    };

    const start = async () => {
      if (!cameraScanSupported()) {
        fail(new Error('UnsupportedCameraError'));
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (!mounted || !activeRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          fail(new Error('UnsupportedCameraError'));
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (!mounted || !activeRef.current) return;
        setError(null);
        setStatus('scanning');
        if (mode === 'qr') {
          timeoutRef.current = window.setTimeout(
            () => fail(new DOMException('QR scan timed out', 'ScanTimeoutError')),
            SCAN_TIMEOUT_MS,
          );
          scheduleFrame();
        }
      } catch (reason) {
        fail(reason);
      }
    };

    void start();
    return () => {
      mounted = false;
      activeRef.current = false;
      stopStream();
    };
  }, [mode, t]);

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (!video.videoWidth || !video.videoHeight) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const source = canvas.toDataURL('image/jpeg', 0.9);
    activeRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    video.srcObject = null;
    setStatus('done');
    void onCapturedRef.current?.(source);
  };

  const close = () => {
    activeRef.current = false;
    onCloseRef.current();
  };

  const hint = mode === 'qr' ? t('receipts.cameraHint') : t('receipts.cameraPhotoHint');

  return (
    <div className="space-y-3 rounded-[14px] border border-border bg-surface-hover/30 p-3">
      <div className="relative overflow-hidden rounded-[10px] bg-black">
        <video
          ref={videoRef}
          className={cn('aspect-[4/3] h-auto w-full object-cover', status === 'error' && 'opacity-40')}
          muted
          autoPlay
          playsInline
          aria-label={hint}
        />
        <canvas ref={canvasRef} className="hidden" />
        {mode === 'qr' && status === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-2/3 w-2/3 rounded-xl border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
          </div>
        )}
        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 px-6 text-center text-sm text-white">
            {t('receipts.cameraStarting')}
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 px-6 text-center text-sm text-white">
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          {mode === 'qr' ? (
            <ScanLine className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Camera className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          )}
          <span className={error ? 'text-destructive' : undefined}>
            {error ?? (status === 'scanning' ? hint : t('receipts.cameraStarting'))}
          </span>
        </p>
        <div className="flex shrink-0 gap-2">
          {mode === 'photo' && status === 'scanning' && (
            <Button className="gap-1.5" onClick={capturePhoto}>
              <Camera className="h-3.5 w-3.5" />
              {t('receipts.shutter')}
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={close}>
            {status === 'error' ? <X className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
            {t('receipts.cameraStop')}
          </Button>
        </div>
      </div>
    </div>
  );
}