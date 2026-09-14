import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { saveReceipt, scanReceipt, scanReceiptOcr } from '@/lib/api';

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
  /** Where the data came from, stored with the receipt. */
  source: 'nfce' | 'ocr';
}

type ScanMethod = 'qr' | 'photo';
type ScanStatus = 'idle' | 'processing' | 'ready';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Scanning, OCR parsing and saving of receipts, shared by the Overview and Scan
 * tabs so both drive one draft instead of keeping two copies of it.
 */
export function useReceiptScanner() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [method, setMethod] = React.useState<ScanMethod>('qr');
  const [qrData, setQrData] = React.useState('');
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
    setQrData('');
    setImage(null);
    setImageName(null);
  }, []);

  /** Turns a raw parse response into a draft the user can review. */
  const applyParsed = React.useCallback(
    (result: Record<string, unknown>, source: 'nfce' | 'ocr') => {
      const items = (result.items as Array<Record<string, unknown>> | undefined) ?? [];
      setDraft({
        store_name: (result.store_name as string | undefined) ?? t('receipts.unknownStore'),
        cnpj: (result.cnpj as string | null | undefined) ?? null,
        date: (result.date as string | undefined) ?? new Date().toISOString().slice(0, 10),
        total: (result.total as string | undefined) ?? '0',
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

  const runQr = React.useCallback(async () => {
    if (!qrData.trim()) return false;
    setStatus('processing');
    setProcessingLabel(t('receipts.parsing'));
    setError(null);
    try {
      const result = await scanReceipt(qrData.trim());
      applyParsed(result, 'nfce');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('receipts.failedParseQr'));
      setStatus('idle');
      return false;
    }
  }, [qrData, applyParsed, t]);

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
      const reader = new FileReader();
      reader.onload = () => {
        setImage(typeof reader.result === 'string' ? reader.result : null);
        setImageName(file.name);
      };
      reader.readAsDataURL(file);
    },
    [t],
  );

  const runOcr = React.useCallback(async () => {
    if (!image) return false;
    setStatus('processing');
    setProcessingLabel(t('receipts.ocrRunning'));
    setError(null);
    try {
      // Lazy-loaded so the OCR engine stays out of the initial bundle.
      const Tesseract = (await import('tesseract.js')).default;
      const result = await Tesseract.recognize(image, 'por', { logger: () => {} });
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
      setError(err instanceof Error ? err.message : t('receipts.ocrFailed'));
      setStatus('idle');
      return false;
    }
  }, [image, applyParsed, t]);

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
    method,
    setMethod,
    qrData,
    setQrData,
    image,
    imageName,
    onPickFile,
    status,
    error,
    setError,
    draft,
    processingLabel,
    runQr,
    runOcr,
    updateItem,
    updateDraft,
    addItem,
    removeItem,
    save,
    reset,
  };
}

export type ReceiptScanner = ReturnType<typeof useReceiptScanner>;

