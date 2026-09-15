import * as React from 'react';
import { Camera, ImagePlus, QrCode, RefreshCw, ScanLine, UploadCloud } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ReceiptScanner } from './useReceiptScanner';

interface Props {
  scanner: ReceiptScanner;
  /** Called after a parse succeeds, so the page can reveal the review panel. */
  onParsed?: () => void;
}

const DROP_ZONE =
  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-surface-hover/20 px-6 py-8 text-center transition-colors hover:border-primary hover:bg-primary/[0.04]';

/**
 * The scanner: NFC-e QR data or a receipt photo.
 *
 * OCR runs in the client (tesseract.js) and the extracted text is parsed by the
 * backend, so the review step is identical for both sources.
 */
export function ScanReceiptCard({ scanner, onParsed }: Props) {
  const { t } = useI18n();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const [lastAction, setLastAction] = React.useState<'qr' | 'ocr' | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const processing = scanner.status === 'processing';

  const runQr = async () => {
    setLastAction('qr');
    if (await scanner.runQr()) onParsed?.();
  };

  const runOcr = async () => {
    setLastAction('ocr');
    if (await scanner.runOcr()) onParsed?.();
  };

  const retry = () => {
    if (lastAction === 'qr') void runQr();
    if (lastAction === 'ocr') void runOcr();
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    scanner.onPickFile(event.dataTransfer.files?.[0] ?? null);
  };

  return (
    <Card className="border-border bg-surface shadow-card">
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">{t('receipts.scanCardTitle')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('receipts.scanCardBlurb')}</p>
        </div>

        <div className="flex gap-1 rounded-md bg-muted p-1" role="tablist">
          {(
            [
              { key: 'qr', label: t('receipts.methodQr'), icon: QrCode },
              { key: 'photo', label: t('receipts.methodPhoto'), icon: ImagePlus },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={scanner.method === option.key}
              disabled={processing}
              onClick={() => scanner.setMethod(option.key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-sm px-3 py-2 text-sm font-medium transition-colors',
                scanner.method === option.key
                  ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <option.icon className="h-4 w-4" aria-hidden="true" />
              {option.label}
            </button>
          ))}
        </div>

        {processing ? (
          <div className="space-y-3 py-2" role="status" aria-live="polite">
            <p className="text-sm font-medium">{scanner.processingLabel}</p>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24 w-full rounded-[12px]" />
          </div>
        ) : scanner.method === 'qr' ? (
          <div className="space-y-2">
            <Label htmlFor="receipt-qr">{t('receipts.qrData')}</Label>
            <textarea
              id="receipt-qr"
              value={scanner.qrData}
              onChange={(event) => scanner.setQrData(event.target.value)}
              placeholder={t('receipts.qrPlaceholder')}
              spellCheck={false}
              className="min-h-[90px] w-full resize-y rounded-md border border-input bg-surface px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              className="min-h-[44px] w-full gap-2 sm:w-auto"
              onClick={() => void runQr()}
              disabled={!scanner.qrData.trim()}
            >
              <ScanLine className="h-4 w-4" />
              {t('receipts.scanQrButton')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className={cn(DROP_ZONE, dragging && 'border-primary bg-primary/[0.06]')}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
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

            <div className="flex flex-wrap gap-2">
              {/* A camera input keeps mobile usable; drag & drop is desktop-only. */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(event) => scanner.onPickFile(event.target.files?.[0] ?? null)}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => scanner.onPickFile(event.target.files?.[0] ?? null)}
              />
              <Button
                variant="outline"
                className="min-h-[44px] gap-2"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera className="h-4 w-4" />
                {t('receipts.takePhoto')}
              </Button>
              <Button
                className="min-h-[44px] gap-2"
                onClick={() => void runOcr()}
                disabled={!scanner.image}
              >
                <ScanLine className="h-4 w-4" />
                {t('receipts.readReceipt')}
              </Button>
            </div>
          </div>
        )}

        {scanner.error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <p className="font-medium">{t('receipts.scanFailedTitle')}</p>
            <p className="mt-0.5 text-xs opacity-90">{scanner.error}</p>
            {lastAction && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5 border-destructive/40 text-destructive"
                onClick={retry}
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
