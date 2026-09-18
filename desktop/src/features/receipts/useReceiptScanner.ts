import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { saveReceipt, scanReceipt, scanReceiptOcr, isNetworkError } from '@/lib/api';
import { toIsoDate } from '@/lib/date-input';
import { decodeQrFromImage, normalizeNfceQrValue, type CaptureIntent } from './qr-scan';

/** One line of a parsed receipt, editable before saving. */
export interface EditableReceiptItem {
  description: string;
  quantity: string;
  unit_price: string;
  total_price: string;
}

/** A parsed (not yet saved) receipt. */
export interface ReceiptDraft {
  store_name: string;
  cnpj: string | null;
  date: string;
  total: string;
  items: EditableReceiptItem[];
  /** QR-only scans could not obtain the public DANFE details automatically. */
  detailsUnavailable: boolean;
  /** Where the data came from, stored with the receipt. */
  source: 'nfce' | 'ocr';
}

type ScanStatus = 'idle' | 'processing' | 'ready';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Unable to read receipt image'));
    };
    reader.onerror = () => reject(new Error('Unable to read receipt image'));
    reader.readAsDataURL(file);
  });
}

/** Shares receipt scanning and editing state across receipt tabs. */
export function useReceiptScanner() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [captureIntent, setCaptureIntent] = React.useState<CaptureIntent | null>(null);
  const [image, setImage] = React.useState<string | null>(null);
  const [imageName, setImageName] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<ScanStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<ReceiptDraft | null>(null);
  const [processingLabel, setProcessingLabel] = React.useState('');

  const reset = React.useCallback(() => {
    setDraft(null);
    setError(null);
    setStatus('idle');
    setImage(null);
    setImageName(null);
  }, []);

  const startCapture = React.useCallback((intent: CaptureIntent) => {
    setCaptureIntent(intent);
  }, []);

  const clearCaptureIntent = React.useCallback(() => {
    setCaptureIntent(null);
  }, []);

  /** Turns a raw parse response into a draft the user can review. */
  const applyParsed = React.useCallback(
    (result: Record<string, unknown>, source: 'nfce' | 'ocr') => {
      const items = (result.items as Array<Record<string, unknown>> | undefined) ?? [];
      const detailsUnavailable =
        source === 'nfce' && result.details_source !== 'portal' && items.length === 0;
      setDraft({
        store_name: (result.store_name as string | undefined) ?? t('receipts.unknownStore'),
        cnpj: (result.cnpj as string | null | undefined) ?? null,
        date:
          (result.date as string | undefined) ??
          (detailsUnavailable ? '' : toIsoDate(new Date())),
        total: (result.total as string | undefined) ?? '0',
        detailsUnavailable,
        source,
        items: items.map((item) => ({
          description: (item.description as string | undefined) ?? '',
          quantity: (item.quantity as string | null | undefined) ?? '1',
          unit_price: (item.unit_price as string | null | undefined) ?? '',
          total_price: (item.total_price as string | null | undefined) ?? '',
        })),
      });
      setStatus('ready');
    },
    [t],
  );

  const runQr = React.useCallback(async (value: string) => {
    if (!value.trim()) return false;
    setStatus('processing');
    setProcessingLabel(t('receipts.parsing'));
    setError(null);
    try {
      const result = await scanReceipt(value.trim());
      applyParsed(result, 'nfce');
      return true;
    } catch (err) {
      // Parsing happens server-side, so an unreachable server is not a bad
      // receipt — say so instead of blaming the QR code (and stay in the
      // user's language rather than surfacing the transport error).
      setError(
        isNetworkError(err)
          ? t('receipts.connectionHint')
          : err instanceof Error
            ? err.message
            : t('receipts.failedParseQr'),
      );
      setStatus('idle');
      return false;
    }
  }, [applyParsed, t]);

  const setImageData = React.useCallback((source: string, name: string) => {
    setImage(source);
    setImageName(name);
  }, []);

  const onPickFile = React.useCallback(
    (file: File | null) => {
      setError(null);
      if (!file) {
        setImage(null);
        setImageName(null);
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(t('receipts.imageTooLarge'));
        setImage(null);
        setImageName(null);
        return;
      }
      void readFileAsDataUrl(file)
        .then((source) => setImageData(source, file.name))
        .catch(() => setError(t('receipts.ocrFailed')));
    },
    [setImageData, t],
  );

  const runQrImage = React.useCallback(
    async (source: string) => {
      setStatus('processing');
      setProcessingLabel(t('receipts.parsing'));
      setError(null);
      try {
        const rawValue = await decodeQrFromImage(source);
        if (!rawValue) {
          setError(t('receipts.qrNotFound'));
          setStatus('idle');
          return false;
        }
        const value = normalizeNfceQrValue(rawValue);
        if (!value) {
          setError(t('receipts.cameraNotNfce'));
          setStatus('idle');
          return false;
        }
        return runQr(value);
      } catch {
        setError(t('receipts.qrNotFound'));
        setStatus('idle');
        return false;
      }
    },
    [runQr, t],
  );

  const runQrFile = React.useCallback(
    async (file: File | null) => {
      if (!file) return false;
      if (file.size > MAX_IMAGE_BYTES) {
        setError(t('receipts.imageTooLarge'));
        setStatus('idle');
        return false;
      }
      try {
        const source = await readFileAsDataUrl(file);
        setImageData(source, file.name);
        return runQrImage(source);
      } catch {
        setError(t('receipts.qrNotFound'));
        setStatus('idle');
        return false;
      }
    },
    [runQrImage, setImageData, t],
  );

  const runOcr = React.useCallback(async (source = image) => {
    if (!source) return false;
    setStatus('processing');
    setError(null);
    try {
      // NFC-e QR codes are more reliable than OCR when a receipt photo contains
      // one. A failed image decode is intentionally ignored so ordinary receipt
      // photos continue through the existing OCR path.
      let qrValue: string | null = null;
      try {
        qrValue = normalizeNfceQrValue(await decodeQrFromImage(source));
      } catch {
        qrValue = null;
      }
      if (qrValue) {
        setProcessingLabel(t('receipts.parsing'));
        const result = await scanReceipt(qrValue);
        applyParsed(result, 'nfce');
        return true;
      }

      setProcessingLabel(t('receipts.ocrRunning'));
      // Lazy-loaded so the OCR engine stays out of the initial bundle.
      const Tesseract = (await import('tesseract.js')).default;
      const result = await Tesseract.recognize(source, 'por', { logger: () => {} });
      const rawText = result.data.text;
      if (!rawText.trim()) {
        setError(t('receipts.ocrNoText'));
        setStatus('idle');
        return false;
      }
      const parsed = await scanReceiptOcr(rawText);
      applyParsed(parsed, 'ocr');
      return true;
    } catch (err) {
      setError(
        isNetworkError(err)
          ? t('receipts.connectionHint')
          : err instanceof Error
            ? err.message
            : t('receipts.ocrFailed'),
      );
      setStatus('idle');
      return false;
    }
  }, [image, applyParsed, t]);

  const runOcrFile = React.useCallback(
    async (file: File | null) => {
      if (!file) return false;
      if (file.size > MAX_IMAGE_BYTES) {
        setError(t('receipts.imageTooLarge'));
        setStatus('idle');
        return false;
      }
      try {
        const source = await readFileAsDataUrl(file);
        setImageData(source, file.name);
        return runOcr(source);
      } catch {
        setError(t('receipts.ocrFailed'));
        setStatus('idle');
        return false;
      }
    },
    [runOcr, setImageData, t],
  );

  const updateItem = React.useCallback(
    (index: number, field: keyof EditableReceiptItem, value: string) => {
      setDraft((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item, i) =>
                i === index ? { ...item, [field]: value } : item,
              ),
            }
          : current,
      );
    },
    [],
  );

  const addItem = React.useCallback(() => {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: [
              ...current.items,
              { description: '', quantity: '1', unit_price: '', total_price: '' },
            ],
          }
        : current,
    );
  }, []);

  const removeItem = React.useCallback((index: number) => {
    setDraft((current) =>
      current ? { ...current, items: current.items.filter((_, i) => i !== index) } : current,
    );
  }, []);

  const updateDraft = React.useCallback(
    (patch: Partial<Pick<ReceiptDraft, 'store_name' | 'date' | 'total' | 'cnpj'>>) => {
      setDraft((current) => (current ? { ...current, ...patch } : current));
    },
    [],
  );
  const save = React.useCallback(async () => {
    if (!draft) return false;
    if (!draft.date.trim()) {
      setError(t('receipts.needDate'));
      return false;
    }
    const items = draft.items.filter((item) => item.description.trim().length > 0);
    if (items.length === 0) {
      setError(t('receipts.needOneItem'));
      return false;
    }

    setStatus('processing');
    setProcessingLabel(t('common.saving'));
    setError(null);
    try {
      await saveReceipt({
        store_name: draft.store_name.trim() || t('receipts.unknownStore'),
        cnpj: draft.cnpj,
        date: draft.date,
        total: draft.total || '0',
        source: draft.source,
        items: items.map((item) => ({
          description: item.description.trim(),
          quantity: item.quantity || undefined,
          unit_price: item.unit_price || undefined,
          total_price: item.total_price || undefined,
        })),
      });
      reset();
      // Everything downstream of a receipt (stats, stores, prices) changed.
      await queryClient.invalidateQueries({ queryKey: ['receipts'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['stores'] });
      toast({ title: t('receipts.savedOk'), variant: 'success' });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receipts.failedSave'));
      setStatus('ready');
      return false;
    }
  }, [draft, reset, queryClient, toast, t]);

  return {
    captureIntent,
    startCapture,
    clearCaptureIntent,
    image,
    imageName,
    onPickFile,
    setImageData,
    status,
    error,
    setError,
    draft,
    processingLabel,
    runQr,
    runQrImage,
    runQrFile,
    runOcr,
    runOcrFile,
    updateItem,
    updateDraft,
    addItem,
    removeItem,
    save,
    reset,
  };
}

export type ReceiptScanner = ReturnType<typeof useReceiptScanner>;

