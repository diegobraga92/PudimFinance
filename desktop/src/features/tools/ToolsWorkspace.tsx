import * as React from 'react';
import { NavLink } from 'react-router-dom';

import { useI18n } from '@/app/i18n';
import { ACCOUNTING_TOOLS } from '@/app/navigation';
import { cn } from '@/lib/utils';

interface Props {
  children: React.ReactNode;
}

/**
 * Shell for the Accounting & Data tools.
 *
 * Ledger, Reconciliation and the Audit Log are three views of the same workspace,
 * so they share one header and one tab strip; the tab that is active comes from
 * the route, which keeps every screen directly linkable.
 */
export function ToolsWorkspace({ children }: Props) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="max-md:hidden">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">
          {t('tools.title')}
        </h1>
        <p className="mt-1.5 max-w-2xl text-base text-muted-foreground">{t('tools.subtitle')}</p>
      </div>

      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-3 md:gap-3 md:overflow-visible md:px-0 md:pb-0"
        role="tablist"
        aria-label={t('tools.title')}
      >
        {ACCOUNTING_TOOLS.map((item) => (
          <NavLink
            key={item.key}
            to={item.route}
            role="tab"
            className={({ isActive }) =>
              cn(
                'flex items-start gap-2.5 rounded-[14px] border px-3 py-3 transition-colors max-md:shrink-0 max-md:whitespace-nowrap md:gap-3 md:px-4 md:py-3.5',
                isActive
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-surface hover:border-primary/40 hover:bg-primary/[0.05]',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md md:h-9 md:w-9',
                    isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <item.icon className="h-4 w-4 md:h-5 md:w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-[13px] font-semibold md:text-sm',
                      isActive ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {t(item.labelKey)}
                  </span>
                  {item.descKey && (
                    <span className="mt-0.5 hidden truncate text-xs text-dim md:block">
                      {t(item.descKey)}
                    </span>
                  )}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>

      {children}
    </div>
  );
}
