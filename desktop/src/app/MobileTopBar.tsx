import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Check, Landmark, Languages, LogOut, Moon, Sun } from 'lucide-react';

import { useAuth } from '@/app/auth';
import { useI18n } from '@/app/i18n';
import { useTheme } from '@/app/theme';
import type { TranslationKey } from '@shared/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Compact app bar for phone-sized screens. */
export function MobileTopBar({
  titleKey,
  isRoot,
  showBell,
}: {
  titleKey: TranslationKey;
  isRoot: boolean;
  showBell: boolean;
}) {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Android back: leave the app's history if there is any, otherwise land on the
  // More tab (deep links such as a notification open tools directly).
  const goBack = () => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate('/more');
  };

  const initials = React.useMemo(() => {
    const handle = user?.email?.split('@')[0] ?? '';
    if (!handle) return 'PF';
    const parts = handle.split(/[._-]+/).filter(Boolean);
    const letters = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : handle.slice(0, 2);
    return letters.toUpperCase();
  }, [user?.email]);

  return (
    <header className="sticky top-0 z-30 flex min-h-[56px] items-center gap-2 border-b border-border bg-surface/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      {isRoot ? (
        <Link
          to="/dashboard"
          className="flex min-w-0 flex-1 items-center gap-2"
          aria-label={t('app.name')}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Landmark className="h-[18px] w-[18px]" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">
            <span className="text-foreground">Pudim</span>
            <span className="text-primary">Finance</span>
          </span>
        </Link>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={goBack}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{t(titleKey)}</h1>
        </>
      )}

      {showBell && (
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => navigate('/notifications')}
          aria-label={t('nav.notifications')}
        >
          <Bell className="h-[18px] w-[18px]" />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#10B981] to-[#3B82F6] text-xs font-semibold text-white ring-2 ring-border"
            aria-label={t('header.signedInAs', { email: user?.email ?? '' })}
          >
            {initials}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[15rem]">
          <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
            {user?.email}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggle} className="gap-2">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
          </DropdownMenuItem>
          <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
            <Languages className="h-4 w-4" />
            {t('app.language')}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setLocale('en')} className="gap-2">
            <span className="w-4">{locale === 'en' && <Check className="h-4 w-4 text-primary" />}</span>
            {t('app.languageEn')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLocale('pt-BR')} className="gap-2">
            <span className="w-4">
              {locale === 'pt-BR' && <Check className="h-4 w-4 text-primary" />}
            </span>
            {t('app.languagePt')}
          </DropdownMenuItem>
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
    </header>
  );
}
