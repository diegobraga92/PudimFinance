import { Camera, FileCode2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { cn } from '@/lib/utils';

interface Props {
  /** `nfce` (QR code) or `ocr` (photo); null for receipts saved before sources. */
  source: string | null | undefined;
  className?: string;
}

/** Small pill telling where a receipt came from. */
export function SourceBadge({ source, className }: Props) {
  const { t } = useI18n();

  if (source !== 'nfce' && source !== 'ocr') {
    return (
      <span className={cn('text-xs text-dim', className)}>{t('receipts.sourceUnknown')}</span>
    );
  }

  const isQr = source === 'nfce';
  const Icon = isQr ? FileCode2 : Camera;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        isQr ? 'bg-primary/12 text-primary' : 'bg-purple/12 text-purple',
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {isQr ? t('receipts.sourceNfce') : t('receipts.sourceOcr')}
    </span>
  );
}
