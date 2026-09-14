import * as React from 'react';
import { translations, toIntlLocale, translate, type Locale, type TranslationKey } from '@shared/i18n';

const LOCALE_KEY = 'pudim_locale';

const MONTH_NAMES: Record<Locale, string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  'pt-BR': ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
};

const SHORT_MONTH_NAMES: Record<Locale, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  'pt-BR': ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
};

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  formatMoney: (value: string | number) => string;
  formatDate: (isoDate: string) => string;
  formatDateTime: (iso: string) => string;
  formatNumber: (value: number) => string;
  monthNames: string[];
  shortMonthNames: string[];
}

const I18nContext = React.createContext<I18nValue | null>(null);

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === 'en' || stored === 'pt-BR') return stored;
    const system = navigator.language.toLowerCase();
    return system.startsWith('pt') ? 'pt-BR' : 'en';
  } catch {
    return 'en';
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);

  const setLocale = React.useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      // Non-fatal.
    }
    document.documentElement.lang = next;
  }, []);

  // Keep the html lang attribute in sync on first render.
  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = React.useMemo<I18nValue>(() => {
    const intl = toIntlLocale(locale);
    return {
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      formatMoney: (value) => {
        const n = typeof value === 'string' ? parseFloat(value) : value;
        if (Number.isNaN(n)) return 'R$ 0,00';
        // Format the number separately and prepend an explicit `R$ ` so the
        // symbol is always spaced from the digits (`R$1,00` in `en-US` would
        // otherwise look cramped).
        const amount = Math.abs(n).toLocaleString(intl, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        return `${n < 0 ? '-' : ''}R$ ${amount}`;
      },
      formatDate: (isoDate) => {
        const d = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
        if (Number.isNaN(d.getTime())) return isoDate;
        return d.toLocaleDateString(intl, { day: '2-digit', month: 'short', year: 'numeric' });
      },
      formatDateTime: (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        return d.toLocaleString(intl, {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      },
      formatNumber: (value) =>
        new Intl.NumberFormat(intl, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(value),
      monthNames: MONTH_NAMES[locale],
      shortMonthNames: SHORT_MONTH_NAMES[locale],
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

export { translations, type Locale, type TranslationKey };
