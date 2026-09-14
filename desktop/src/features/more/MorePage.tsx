import * as React from 'react';
import { NavLink } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Languages,
  Moon,
  Palette,
  ReceiptText,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Wallet,
} from 'lucide-react';

import { useAuth } from '@/app/auth';
import { useI18n } from '@/app/i18n';
import { useTheme } from '@/app/theme';
import type { TranslationKey } from '@shared/i18n';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface Row {
  key: string;
  labelKey: TranslationKey;
  descKey: TranslationKey;
  icon: typeof ReceiptText;
  route?: string;
  onSelect?: () => void;
  active?: boolean;
}

/**
 * "More" tab: everything that is not a daily money surface.
 *
 * Receipts, the accounting tools and settings live here so the bottom bar can
 * stay at five destinations, and each row says what it does.
 */
export function MorePage() {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, logout } = useAuth();

  const tools: Row[] = [
    {
      key: 'receipts',
      labelKey: 'nav.receipts',
      descKey: 'nav.descReceipts',
      icon: ReceiptText,
      route: '/receipts',
    },
    {
      key: 'reconciliation',
      labelKey: 'nav.reconciliation',
      descKey: 'nav.descReconciliation',
      icon: RefreshCw,
      route: '/reconciliation',
    },
    {
      key: 'ledger',
      labelKey: 'nav.ledger',
      descKey: 'nav.descLedger',
      icon: BookOpen,
      route: '/ledger',
    },
    {
      key: 'audit',
      labelKey: 'nav.audit',
      descKey: 'nav.descAudit',
      icon: ShieldCheck,
      route: '/audit',
    },
    {
      key: 'creditCards',
      labelKey: 'nav.creditCards',
      descKey: 'nav.descCreditCards',
      icon: Wallet,
      route: '/credit-cards',
    },
  ];

  const settings: Row[] = [
    {
      key: 'server',
      labelKey: 'nav.server',
      descKey: 'nav.descServer',
      icon: Server,
      route: '/server',
    },
    {
      key: 'theme-dark',
      labelKey: 'more.themeDark',
      descKey: 'more.themeHint',
      icon: Moon,
      onSelect: () => setTheme('dark'),
      active: theme === 'dark',
    },
    {
      key: 'theme-light',
      labelKey: 'more.themeLight',
      descKey: 'more.themeHint',
      icon: Sun,
      onSelect: () => setTheme('light'),
      active: theme === 'light',
    },
    {
      key: 'lang-en',
      labelKey: 'app.languageEn',
      descKey: 'more.languageHint',
      icon: Languages,
      onSelect: () => setLocale('en'),
      active: locale === 'en',
    },
    {
      key: 'lang-pt',
      labelKey: 'app.languagePt',
      descKey: 'more.languageHint',
      icon: Languages,
      onSelect: () => setLocale('pt-BR'),
      active: locale === 'pt-BR',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-[-0.01em] md:text-[28px]">{t('nav.more')}</h1>
        <p className="mt-1 text-sm text-muted-foreground md:text-base">{t('more.subtitle')}</p>
      </div>

      <Section titleKey="more.tools">
        {tools.map((row) => (
          <MoreRow key={row.key} row={row} />
        ))}
      </Section>

      <Section titleKey="more.settings">
        {settings.map((row) => (
          <MoreRow key={row.key} row={row} />
        ))}
      </Section>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#10B981] to-[#3B82F6] text-sm font-semibold text-white">
            {(user?.email?.[0] ?? 'P').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.email}</p>
            <p className="text-xs text-dim">{t('more.signedIn')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={logout} className="shrink-0 text-destructive">
            {t('nav.signOut')}
          </Button>
        </div>
      </Card>

      <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-xs text-dim">
        <Palette className="h-3.5 w-3.5" />
        {t('more.footer')}
      </p>
    </div>
  );
}

/** A titled group of rows inside one card. */
function Section({ titleKey, children }: { titleKey: TranslationKey; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-dim">
        {t(titleKey)}
      </h2>
      <Card className="divide-y divide-border/60 overflow-hidden p-0">{children}</Card>
    </section>
  );
}

/** One tappable row (link or immediate action) with an icon and a description. */
function MoreRow({ row }: { row: Row }) {
  const { t } = useI18n();
  const content = (
    <>
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          row.active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <row.icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{t(row.labelKey)}</span>
        <span className="block truncate text-xs text-dim">{t(row.descKey)}</span>
      </span>
      {row.active ? (
        <span className="shrink-0 text-xs font-medium text-primary">{t('more.active')}</span>
      ) : (
        <ArrowRight className="h-4 w-4 shrink-0 text-dim" />
      )}
    </>
  );

  const className =
    'flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-surface-hover';

  if (row.route) {
    return (
      <NavLink to={row.route} className={className}>
        {content}
      </NavLink>
    );
  }
  return (
    <button type="button" onClick={row.onSelect} className={className}>
      {content}
    </button>
  );
}

