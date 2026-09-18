import * as React from 'react';
import { Camera, ImagePlus, QrCode, RefreshCw, ScanLine, UploadCloud } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { CameraCapture, type CameraCaptureMode } from './CameraCapture';
import { cameraScanSupported, captureIntentTarget } from './qr-scan';
import type { ReceiptScanner } from './useReceiptScanner';

interface Props {
  scanner: ReceiptScanner;
  /** Called after a parse succeeds, so the page can reveal the review panel. */
  onParsed?: () => void;
}

type CaptureAction = 'qr-camera' | 'qr-image' | 'photo-camera' | 'photo-image';

const DROP_ZONE =
  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-surface-hover/20 px-6 py-8 text-center transition-colors hover:border-primary hover:bg-primary/[0.04]';

/** Receipt capture card with QR-camera, QR-image, OCR-camera and OCR-image paths. */
export function ScanReceiptCard({ scanner, onParsed }: Props) {
  const { t } = useI18n();
  const qrImageInputRef = React.useRef<HTMLInputElement>(null);
  const receiptImageInputRef = React.useRef<HTMLInputElement>(null);
  const [lastAction, setLastAction] = React.useState<CaptureAction | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [cameraMode, setCameraMode] = React.useState<CameraCaptureMode | null>(null);
  const cameraSupported = cameraScanSupported();
  const processing = scanner.status === 'processing';
  const { captureIntent, clearCaptureIntent } = scanner;
  const captureTarget = captureIntentTarget(captureIntent, cameraSupported);

  React.useEffect(() => {
    if (!captureTarget) return;
    if (captureTarget === 'qr-camera' || captureTarget === 'photo-camera') {
      setCameraMode(captureTarget === 'qr-camera' ? 'qr' : 'photo');
    } else if (captureTarget === 'qr-picture') {
      qrImageInputRef.current?.click();
    } else {
      receiptImageInputRef.current?.click();
    }
    clearCaptureIntent();
  }, [captureTarget, clearCaptureIntent]);

  const runQrImage = async (file: File | null) => {
    setLastAction('qr-image');
    if (await scanner.runQrFile(file)) onParsed?.();
  };

  const runPhotoImage = async (file: File | null) => {
    setLastAction('photo-image');
    if (await scanner.runOcrFile(file)) onParsed?.();
  };

  const runQrCamera = async (value: string) => {
    setLastAction('qr-camera');
    setCameraMode(null);
    if (await scanner.runQr(value)) onParsed?.();
  };

  const runPhotoCamera = async (source: string) => {
    setLastAction('photo-camera');
    setCameraMode(null);
    scanner.setImageData(source, t('receipts.cameraPhotoName'));
    if (await scanner.runOcr(source)) onParsed?.();
  };

  const retryAvailable = lastAction === 'qr-camera' || Boolean(scanner.image);

  const retry = async () => {
    if (lastAction === 'qr-camera') {
      setCameraMode('qr');
      return;
    }
    if (!scanner.image) return;

    const succeeded =
      lastAction === 'qr-image'
        ? await scanner.runQrImage(scanner.image)
        : await scanner.runOcr(scanner.image);
    if (succeeded) onParsed?.();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void runPhotoImage(event.dataTransfer.files?.[0] ?? null);
  };

  return (
    <Card className="min-w-0 border-border bg-surface shadow-card">
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">{t('receipts.scanCardTitle')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('receipts.scanCardBlurb')}</p>
        </div>

        {cameraMode ? (
          <CameraCapture
            mode={cameraMode}
            onDecoded={runQrCamera}
            onCaptured={runPhotoCamera}
            onClose={() => setCameraMode(null)}
          />
        ) : processing ? (
          <div className="space-y-3 py-2" role="status" aria-live="polite">
            <p className="text-sm font-medium">{scanner.processingLabel}</p>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24 w-full rounded-[12px]" />
          </div>
        ) : (
          <>
            <section className="space-y-3" aria-labelledby="receipt-qr-section">
              <div className="flex items-center gap-2">
                <QrCode className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 id="receipt-qr-section" className="font-medium">
                  {t('receipts.qrSectionTitle')}
                </h3>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {cameraSupported ? (
                  <Button
                    variant="outline"
                    className="min-h-[48px] justify-start gap-2"
                    onClick={() => setCameraMode('qr')}
                  >
                    <Camera className="h-4 w-4" />
                    {t('receipts.scanQrWithCamera')}
                  </Button>
                ) : (
                  <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                    {t('receipts.cameraUnsupported')}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="min-h-[48px] justify-start gap-2"
                  onClick={() => qrImageInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  {t('receipts.readQrFromPicture')}
                </Button>
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="receipt-photo-section">
              <div className="flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 id="receipt-photo-section" className="font-medium">
                  {t('receipts.photoSectionTitle')}
                </h3>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {cameraSupported ? (
                  <Button
                    variant="outline"
                    className="min-h-[48px] justify-start gap-2"
                    onClick={() => setCameraMode('photo')}
                  >
                    <Camera className="h-4 w-4" />
                    {t('receipts.photographReceipt')}
                  </Button>
                ) : (
                  <p className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                    {t('receipts.cameraUnsupported')}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="min-h-[48px] justify-start gap-2"
                  onClick={() => receiptImageInputRef.current?.click()}
                >
                  <ImagePlus className="h-4 w-4" />
                  {t('receipts.readReceiptFromPicture')}
                </Button>
              </div>
            </section>

            <input
              ref={qrImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void runQrImage(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />
            <input
              ref={receiptImageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void runPhotoImage(event.target.files?.[0] ?? null);
                event.target.value = '';
              }}
            />

            <div
              className={cn(DROP_ZONE, dragging && 'border-primary bg-primary/[0.06]')}
              onClick={() => receiptImageInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') receiptImageInputRef.current?.click();
              }}
              aria-label={t('receipts.dropZoneLabel')}
            >
              <UploadCloud className="h-7 w-7 text-primary" aria-hidden="true" />
              <p className="text-sm font-medium">{t('receipts.dropTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('receipts.dropHint')}</p>
              <p className="text-xs text-dim">{t('receipts.dropFormats')}</p>
            </div>

            {scanner.image && (
              <div className="flex items-center gap-3 rounded-md border border-border bg-surface-hover/40 p-2.5">
                <img
                  src={scanner.image}
                  alt={t('receipts.receiptPreview')}
                  className="h-14 w-14 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {scanner.imageName ?? t('receipts.receiptPreview')}
                  </p>
                  <p className="text-xs text-dim">{t('receipts.imageReady')}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => scanner.onPickFile(null)}>
                  {t('common.remove')}
                </Button>
              </div>
            )}
          </>
        )}

        {scanner.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <p className="font-medium">{t('receipts.scanFailedTitle')}</p>
            <p className="mt-0.5 text-xs opacity-90">{scanner.error}</p>
            {retryAvailable && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5 border-destructive/40 text-destructive"
                onClick={() => void retry()}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('common.retry')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}