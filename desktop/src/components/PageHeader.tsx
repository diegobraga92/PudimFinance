import * as React from 'react';

import { useI18n } from '@/app/i18n';
import type { TranslationKey } from '@shared/i18n';
import { cn } from '@/lib/utils';

interface Props {
  /** Screen title. Shown on desktop; on phones the app bar carries the name. */
  titleKey: TranslationKey;
  subtitleKey?: TranslationKey;
  /** Extra line rendered on phones instead of the title (e.g. a greeting). */
  mobileLead?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** Responsive page heading with title, subtitle, and actions. */
export function PageHeader({ titleKey, subtitleKey, mobileLead, actions, className }: Props) {
  const { t } = useI18n();

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="hidden flex-wrap items-end justify-between gap-3 md:flex">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em]">{t(titleKey)}</h1>
          {subtitleKey && (
            <p className="mt-1.5 text-base text-muted-foreground">{t(subtitleKey)}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      <div className="flex items-center gap-2 md:hidden">
        {mobileLead ? (
          <div className="min-w-0 flex-1">{mobileLead}</div>
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold tracking-[-0.01em]">
            {t(titleKey)}
          </h1>
        )}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
