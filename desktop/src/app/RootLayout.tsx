import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import * as React from 'react';
import { ChevronDown, Landmark, LogOut, Menu, Moon, Plus, Sun } from 'lucide-react';

import { useAuth } from '@/app/auth';
import { useI18n } from '@/app/i18n';
import { useTheme } from '@/app/theme';
import {
  PRIMARY_NAV,
  TOOL_GROUPS,
  isMobileRoot,
  screenTitleKey,
  type NavGroup,
  type NavItem,
} from '@/app/navigation';
import { MobileTabBar } from '@/app/MobileTabBar';
import { MobileTopBar } from '@/app/MobileTopBar';
import { QuickAddFab } from '@/app/QuickAddFab';
import { OfflineBanner } from '@/components/OfflineBanner';
import { LanguageToggle } from '@/components/language-toggle';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** Shared pill styling for nav entries (top bar trigger, links and menus). */
function navItemClass(isActive: boolean): string {
  return cn(
    'flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary/15 text-foreground'
      : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
  );
}

/** Two-letter avatar initials derived from the signed-in email (`diego.b@…` → `DB`). */
function initialsFromEmail(email?: string): string {
  const handle = email?.split('@')[0] ?? '';
  if (!handle) return 'PF';
  const parts = handle.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : handle.slice(0, 2);
  return letters.toUpperCase();
}

/** A link inside the dropdown menus, optionally with a one-line description. */
function MenuLink({ item }: { item: NavItem }) {
  const { t } = useI18n();
  return (
    <DropdownMenuItem asChild>
      <NavLink to={item.route} className="w-full">
        <span className="flex w-full items-start gap-2.5">
          <item.icon className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate">{t(item.labelKey)}</span>
            {item.descKey && (
              <span className="block truncate text-xs text-dim">{t(item.descKey)}</span>
            )}
          </span>
        </span>
      </NavLink>
    </DropdownMenuItem>
  );
}

/** Accounting, power tools and administration, grouped inside one menu. */
function ToolsMenu({ groups }: { groups: NavGroup[] }) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const items = groups.flatMap((group) => group.items);
  const isActive = items.some((item) => pathname.startsWith(item.route));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(navItemClass(isActive), 'outline-none')}>
        {t('nav.tools')}
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[16.5rem]">
        {groups.map((group, index) => (
          <div key={group.key}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-dim">
              {t(group.labelKey)}
            </DropdownMenuLabel>
            {group.items.map((item) => (
              <MenuLink key={item.key} item={item} />
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Compact navigation for narrow viewports: everything in one menu. */
function MobileNavMenu({
  primary,
  groups,
}: {
  primary: NavItem[];
  groups: NavGroup[];
}) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={t('nav.ariaOpenMenu')}
          title={t('nav.toggle')}
        >
          <Menu className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[16.5rem]">
        {primary.map((item) => (
          <MenuLink key={item.key} item={item} />
        ))}
        {groups.map((group) => (
          <div key={group.key}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-dim">
              {t(group.labelKey)}
            </DropdownMenuLabel>
            {group.items.map((item) => (
              <MenuLink key={item.key} item={item} />
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Maps a widget/notification deep link (e.g. "add?type=expense") to a route. */
function routeFromDeepLink(link: string): string | null {
  if (link.startsWith('add')) {
    const type = link.includes('type=income') ? 'income' : 'expense';
    return `/transactions?add=1&type=${type}`;
  }
  // Capture-prompt notifications open the pending-review inbox.
  if (link.startsWith('pending-review')) {
    return '/pending-review';
  }
  return null;
}

/** Application shell: desktop top bar, Android app bar + bottom tabs. */
export function RootLayout() {
  const { t } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
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
  const primaryItems = visibleItems(PRIMARY_NAV);
  const toolGroups: NavGroup[] = TOOL_GROUPS.map((group) => ({
    ...group,
    items: visibleItems(group.items),
  })).filter((group) => group.items.length > 0);
  const userInitials = initialsFromEmail(user?.email);

  // Phone layout: the app bar names the screen and the FAB is offered on the two
  // screens where entering a transaction is the point.
  const mobileIsRoot = isMobileRoot(pathname);
  const mobileTitle = screenTitleKey(pathname);
  const showFab = pathname.startsWith('/dashboard') || pathname.startsWith('/transactions');

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
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        {/* Desktop top navigation */}
        <header className="relative z-30 flex h-[68px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:gap-5 lg:px-6 max-md:hidden">
          <Link to="/dashboard" className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Landmark className="h-5 w-5" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">
              <span className="text-foreground">Pudim</span>
              <span className="text-primary">Finance</span>
            </span>
          </Link>

          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label={t('nav.main')}>
            {primaryItems.map((item) => (
              <NavLink
                key={item.key}
                to={item.route}
                className={({ isActive }) => navItemClass(isActive)}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </NavLink>
            ))}
            {toolGroups.length > 0 && <ToolsMenu groups={toolGroups} />}
          </nav>

          <div className="flex-1 lg:hidden" />

          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" onClick={goQuickAdd} className="gap-1.5">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t('header.addTransaction')}</span>
            </Button>
            <MobileNavMenu primary={primaryItems} groups={toolGroups} />
            <LanguageToggle />
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#10B981] to-[#3B82F6] text-sm font-semibold text-white ring-2 ring-border transition-opacity hover:opacity-90"
                  aria-label={t('header.signedInAs', { email: user?.email ?? '' })}
                  title={t('header.signedInAs', { email: user?.email ?? '' })}
                >
                  {userInitials}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[15rem]">
                <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
                  {user?.email}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" />
                  {t('nav.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Android app bar */}
        <MobileTopBar
          titleKey={mobileTitle}
          isRoot={mobileIsRoot}
          showBell={captureSupported}
        />

        <OfflineBanner />

        {/* Routed content. Extra bottom room on phones for the tab bar + FAB. */}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pb-28 pt-4 sm:px-6 md:pb-12 md:pt-6 lg:px-8 lg:pt-7">
            <Outlet />
          </div>
        </main>

        {showFab && <QuickAddFab />}
        <MobileTabBar />
      </div>
    </TooltipProvider>
  );
}
