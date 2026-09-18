/** Shared translations and locale helpers. */

import { en } from './en';
import { ptBR } from './pt-BR';

export type Locale = 'en' | 'pt-BR';

/** Every translation value is a plain string (flat dotted keys). */
export type Translation = Record<string, string>;

/** Union of every valid key, derived from the English dictionary. */
export type TranslationKey = keyof typeof en;

/** Compile-time check that the Portuguese dictionary matches the English keys. */
type _MissingKeys = Exclude<TranslationKey, keyof typeof ptBR>;
type _ExtraKeys = Exclude<keyof typeof ptBR, TranslationKey>;
export const _assertPtBRKeys: [never] extends [_MissingKeys]
  ? [never] extends [_ExtraKeys]
    ? true
    : never
  : never = true;

export const translations: Record<Locale, Translation> = { en, 'pt-BR': ptBR };

/** Map a locale to the `Intl` locale tag used for dates/numbers. */
export function toIntlLocale(locale: Locale): string {
  return locale === 'pt-BR' ? 'pt-BR' : 'en-US';
}

/** Substitutes known `{placeholder}` tokens and preserves unknown ones. */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Resolve a key for a locale, falling back to English when missing. */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = translations[locale] ?? translations.en;
  const template = dict[key] ?? translations.en[key] ?? key;
  return interpolate(template, params);
}
