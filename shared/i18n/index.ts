/**
 * Shared PudimFinance i18n module.
 *
 * Both the Vite web app and the Expo mobile app import from this single
 * source of truth. The `en` dictionary defines the canonical key set, and `pt-BR`
 * is type-checked to have exactly the same keys.
 */

import { en } from './en';
import { ptBR } from './pt-BR';

export type Locale = 'en' | 'pt-BR';

/** Every translation value is a plain string (flat dotted keys). */
export type Translation = Record<string, string>;

/** Union of every valid key, derived from the English dictionary. */
export type TranslationKey = keyof typeof en;

/**
 * Compile-time guards ensure `pt-BR` defines exactly the same keys as `en`.
 * If a key is missing (or extra) in pt-BR, this module fails to compile.
 */
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

/**
 * Substitutes `{placeholder}` tokens with the provided parameters.
 * Unknown placeholders are left untouched.
 */
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
