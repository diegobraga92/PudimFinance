import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import * as React from 'react';
import { Landmark, LogOut, Moon, Plus, Sun } from 'lucide-react';

import { useAuth } from '@/app/auth';
import { useI18n } from '@/app/i18n';
import { useTheme } from '@/app/theme';
import {
  PRIMARY_NAV,
  PLANNING_NAV,
  CARDS_NAV,
  TOOLS_NAV,
  SYSTEM_NAV,
  type NavItem,
} from '@/app/navigation';
import { OfflineBanner } from '@/components/OfflineBanner';
import {
  captureSupported as isCaptureSupported,
  subscribeDeepLinks,
  takeDeepLink,
} from '@/notifications/native';
import { refreshWidgetSpentToday } from '@/lib/widget';
import { syncSilently } from '@/offline/sync-engine';
import { clearServerProbeCache } from '@/offline/net';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function NavSection({ title, items }: { title?: string; items: NavItem[] }) {
  const { t } = useI18n();
  return (
    <nav className="space-y-1 px-3" aria-label={title ?? t('nav.main')}>
      {title && (
        <p className="px-2 pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-wider text-dim">
          {title}
        </p>
      )}
      {items.map((item) => (
        <NavLink
          key={item.key}
          to={item.route}
          className={({ isActive }) =>
            cn(
              'group flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{t(item.labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Maps a widget deep link (e.g. "add?type=expense") to a route. */
function routeFromDeepLink(link: string): string | null {
  if (link.startsWith('add')) {
    const type = link.includes('type=income') ? 'income' : 'expense';
    return `/transactions?add=1&type=${type}`;
  }
  return null;
}

/** Application shell with a fixed sidebar, top header, and routed content. */
export function RootLayout() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Android-only nav items (notification capture) are hidden on desktop where
  // the native NotificationListenerService doesn't exist.
  const [captureSupported, setCaptureSupported] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void isCaptureSupported().then((ok) => {
      if (active) setCaptureSupported(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  const visibleItems = (items: NavItem[]) =>
    items.filter((i) => !i.androidOnly || captureSupported);

  const goQuickAdd = () => navigate('/transactions?add=1');

  // Offline-first. Seed the local mirror on startup and whenever connectivity
  // returns. Failures are non-fatal (the app falls back to the mirror).
  React.useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      try {
        await syncSilently();
        void refreshWidgetSpentToday();
      } catch {
        // Non-fatal.
      }
    };
    void run();
    const onOnline = () => {
      clearServerProbeCache();
      void run();
    };
    const onFocus = () => void refreshWidgetSpentToday();
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // Home-screen widget deep links (Android) route to the add-transaction form.
  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    const go = (link: string) => {
      const route = routeFromDeepLink(link);
      if (route) navigate(route);
    };
    void (async () => {
      const pending = await takeDeepLink();
      if (pending) go(pending);
      unlisten = await subscribeDeepLinks(go);
    })();
    return () => {
      unlisten?.();
    };
  }, [navigate]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen overflow-hidden bg-background">
        {/* Sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
          <div className="flex h-14 items-center gap-2 border-b border-border px-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Landmark className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">PudimFinance</span>
          </div>

          <div className="flex-1 overflow-y-auto py-3">
            <NavSection items={visibleItems(PRIMARY_NAV)} />
            <NavSection title={t('nav.planning')} items={visibleItems(PLANNING_NAV)} />
            <NavSection title={t('nav.cards')} items={visibleItems(CARDS_NAV)} />
            <NavSection title={t('nav.tools')} items={visibleItems(TOOLS_NAV)} />
            <NavSection title={t('nav.system')} items={visibleItems(SYSTEM_NAV)} />
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-center gap-3 rounded-md px-2 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
                {user?.email?.charAt(0).toUpperCase() ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{user?.email}</p>
                <p className="text-[0.6875rem] text-dim">
                  {locale === 'pt-BR' ? 'pt-BR' : 'en'}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full justify-start text-muted-foreground hover:text-destructive"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
              {t('nav.signOut')}
            </Button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBanner />
          {/* Header */}
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
            <div className="flex-1" />
            <Button
              variant="default"
              size="sm"
              onClick={goQuickAdd}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              {t('dashboard.addTransaction')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocale(locale === 'pt-BR' ? 'en' : 'pt-BR')}
              title={t('app.language')}
              aria-label={t('app.language')}
            >
              {locale === 'pt-BR' ? 'EN' : 'PT'}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggle}
                  title={theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
                  aria-label={theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
              </TooltipContent>
            </Tooltip>
          </header>

          {/* Routed content */}
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="container py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
