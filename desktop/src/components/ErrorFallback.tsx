import { TriangleAlert } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';

/** Message + retry shown in place of a crashed screen. */
export function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="h-7 w-7" />
      </span>
      <p className="mt-4 text-base font-semibold">{t('errors.screenTitle')}</p>
      <p className="mt-2 text-sm text-muted-foreground">{t('errors.screenDesc')}</p>
      <p className="mt-3 break-words rounded-md bg-muted/60 px-3 py-2 text-xs text-dim">
        {error.message}
      </p>
      <Button className="mt-6" onClick={onRetry}>
        {t('errors.retry')}
      </Button>
    </div>
  );
}
