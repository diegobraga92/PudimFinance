import { NavLink } from 'react-router-dom';

import { useI18n } from '@/app/i18n';
import { MOBILE_TABS } from '@/app/navigation';
import { cn } from '@/lib/utils';

/** Bottom navigation for phone-sized screens. */
export function MobileTabBar() {
  const { t } = useI18n();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label={t('nav.main')}
    >
      {MOBILE_TABS.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.route}
          className="flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5"
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'flex h-8 w-16 items-center justify-center rounded-full transition-colors',
                  isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground',
                )}
              >
                <tab.icon className="h-[19px] w-[19px]" aria-hidden="true" />
              </span>
              <span
                className={cn(
                  'max-w-full truncate text-[11px] font-medium leading-none',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {t(tab.labelKey)}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
