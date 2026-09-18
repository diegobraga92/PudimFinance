/** Shared account icon catalog. */
import type { TranslationKey } from './i18n';

const LEGACY_ACCOUNT_ICON_NAMES = [
  'bank', 'money', 'card', 'loan', 'trending-up', 'wallet', 'safe', 'scale',
  'briefcase', 'home', 'more-horizontal',
] as const;

const BRAND_ACCOUNT_ICON_NAMES = [
  'nubank', 'itau', 'bradesco', 'bb', 'caixa', 'santander', 'inter', 'c6',
  'btg', 'xp', 'picpay', 'mercadopago', 'neon', 'sicoob', 'sicredi', 'pagbank',
] as const;

const INSTRUMENT_ACCOUNT_ICON_NAMES = [
  'tesouro', 'cdb', 'poupanca', 'fgts', 'previdencia', 'acoes', 'fii', 'fundos',
  'cripto', 'moedas',
] as const;

/** Canonical icon identifiers, including the original generic identifiers. */
export const ACCOUNT_ICON_NAMES = [
  ...LEGACY_ACCOUNT_ICON_NAMES,
  ...BRAND_ACCOUNT_ICON_NAMES,
  ...INSTRUMENT_ACCOUNT_ICON_NAMES,
] as const;

export type AccountIconName = (typeof ACCOUNT_ICON_NAMES)[number];
export type AccountIconGroup = 'banks' | 'investments' | 'money' | 'other';

export interface AccountIconOption {
  name: AccountIconName;
  group: AccountIconGroup;
  labelKey: TranslationKey;
  aliases?: readonly string[];
}

export interface AccountIconBrand extends AccountIconOption {
  kind?: 'brand';
  monogram: string;
  color: string;
}

export interface AccountIconInstrument extends AccountIconOption {
  kind?: 'instrument';
}

const GENERIC_ACCOUNT_ICON_OPTIONS: readonly AccountIconOption[] = [
  { name: 'bank', group: 'banks', labelKey: 'accounts.icon.bank' },
  { name: 'money', group: 'money', labelKey: 'accounts.icon.money' },
  { name: 'card', group: 'money', labelKey: 'accounts.icon.card' },
  { name: 'loan', group: 'other', labelKey: 'accounts.icon.loan' },
  { name: 'trending-up', group: 'investments', labelKey: 'accounts.icon.trendingUp' },
  { name: 'wallet', group: 'money', labelKey: 'accounts.icon.wallet' },
  { name: 'safe', group: 'money', labelKey: 'accounts.icon.safe' },
  { name: 'scale', group: 'other', labelKey: 'accounts.icon.scale' },
  { name: 'briefcase', group: 'other', labelKey: 'accounts.icon.briefcase' },
  { name: 'home', group: 'money', labelKey: 'accounts.icon.home' },
  { name: 'more-horizontal', group: 'other', labelKey: 'accounts.icon.other' },
];

/** Brazilian banks and payment accounts represented by compact monograms. */
export const ACCOUNT_BRANDS: readonly AccountIconBrand[] = [
  { name: 'nubank', group: 'banks', labelKey: 'accounts.icon.nubank', monogram: 'Nu', color: '#820AD1', aliases: ['nubank', 'nu'] },
  { name: 'itau', group: 'banks', labelKey: 'accounts.icon.itau', monogram: 'It', color: '#EC7000', aliases: ['itau', 'itaú', 'itaú uniclass'] },
  { name: 'bradesco', group: 'banks', labelKey: 'accounts.icon.bradesco', monogram: 'Br', color: '#CC092F', aliases: ['bradesco'] },
  { name: 'bb', group: 'banks', labelKey: 'accounts.icon.bb', monogram: 'BB', color: '#1E4FA3', aliases: ['bb', 'banco do brasil'] },
  { name: 'caixa', group: 'banks', labelKey: 'accounts.icon.caixa', monogram: 'CX', color: '#0070AF', aliases: ['caixa', 'caixa econômica', 'caixa economica'] },
  { name: 'santander', group: 'banks', labelKey: 'accounts.icon.santander', monogram: 'St', color: '#E30613', aliases: ['santander'] },
  { name: 'inter', group: 'banks', labelKey: 'accounts.icon.inter', monogram: 'In', color: '#FF7A00', aliases: ['inter', 'banco inter'] },
  { name: 'c6', group: 'banks', labelKey: 'accounts.icon.c6', monogram: 'C6', color: '#4B5563', aliases: ['c6', 'c6 bank'] },
  { name: 'btg', group: 'banks', labelKey: 'accounts.icon.btg', monogram: 'BT', color: '#1B2C5C', aliases: ['btg', 'btg pactual'] },
  { name: 'xp', group: 'banks', labelKey: 'accounts.icon.xp', monogram: 'XP', color: '#4B5563', aliases: ['xp', 'xp investimentos'] },
  { name: 'picpay', group: 'banks', labelKey: 'accounts.icon.picpay', monogram: 'Pi', color: '#21C25E', aliases: ['picpay', 'pic pay'] },
  { name: 'mercadopago', group: 'banks', labelKey: 'accounts.icon.mercadopago', monogram: 'MP', color: '#009EE3', aliases: ['mercadopago', 'mercado pago'] },
  { name: 'neon', group: 'banks', labelKey: 'accounts.icon.neon', monogram: 'Ne', color: '#00AEEF', aliases: ['neon'] },
  { name: 'sicoob', group: 'banks', labelKey: 'accounts.icon.sicoob', monogram: 'Sc', color: '#00857C', aliases: ['sicoob'] },
  { name: 'sicredi', group: 'banks', labelKey: 'accounts.icon.sicredi', monogram: 'Si', color: '#3FA110', aliases: ['sicredi'] },
  { name: 'pagbank', group: 'banks', labelKey: 'accounts.icon.pagbank', monogram: 'PB', color: '#00A88A', aliases: ['pagbank', 'pag bank', 'pagseguro'] },
];

/** Brazilian savings and investment instruments. */
export const ACCOUNT_INSTRUMENTS: readonly AccountIconInstrument[] = [
  { name: 'tesouro', group: 'investments', labelKey: 'accounts.icon.tesouro', aliases: ['tesouro', 'tesouro direto', 'tesouro selic', 'tesouro ipca'] },
  { name: 'cdb', group: 'investments', labelKey: 'accounts.icon.cdb', aliases: ['cdb', 'rdb', 'lci', 'lca'] },
  { name: 'poupanca', group: 'money', labelKey: 'accounts.icon.poupanca', aliases: ['poupanca', 'poupança'] },
  { name: 'fgts', group: 'money', labelKey: 'accounts.icon.fgts', aliases: ['fgts'] },
  { name: 'previdencia', group: 'investments', labelKey: 'accounts.icon.previdencia', aliases: ['previdencia', 'previdência', 'pgbl', 'vgbl'] },
  { name: 'acoes', group: 'investments', labelKey: 'accounts.icon.acoes', aliases: ['acao', 'ação', 'acoes', 'ações', 'stocks'] },
  { name: 'fii', group: 'investments', labelKey: 'accounts.icon.fii', aliases: ['fii', 'fiis', 'fundo imobiliario', 'fundo imobiliário'] },
  { name: 'fundos', group: 'investments', labelKey: 'accounts.icon.fundos', aliases: ['fundo', 'fundos', 'fundo de investimento', 'fundo de investimentos'] },
  { name: 'cripto', group: 'investments', labelKey: 'accounts.icon.cripto', aliases: ['cripto', 'criptomoeda', 'criptomoedas', 'bitcoin', 'ethereum'] },
  { name: 'moedas', group: 'money', labelKey: 'accounts.icon.moedas', aliases: ['dolar', 'dólar', 'euro', 'moeda estrangeira', 'conta internacional'] },
];

/** All picker options grouped in a predictable order for the account form. */
export const ACCOUNT_ICON_GROUPS: readonly {
  key: AccountIconGroup;
  labelKey: TranslationKey;
  options: readonly AccountIconOption[];
}[] = [
  { key: 'banks', labelKey: 'accounts.icon.group.banks', options: [{ name: 'bank', group: 'banks', labelKey: 'accounts.icon.bank' }, ...ACCOUNT_BRANDS] },
  { key: 'investments', labelKey: 'accounts.icon.group.investments', options: [{ name: 'trending-up', group: 'investments', labelKey: 'accounts.icon.trendingUp' }, ...ACCOUNT_INSTRUMENTS.filter((option) => option.group === 'investments')] },
  { key: 'money', labelKey: 'accounts.icon.group.money', options: GENERIC_ACCOUNT_ICON_OPTIONS.filter((option) => option.group === 'money').concat(ACCOUNT_INSTRUMENTS.filter((option) => option.group === 'money')) },
  { key: 'other', labelKey: 'accounts.icon.group.other', options: GENERIC_ACCOUNT_ICON_OPTIONS.filter((option) => option.group === 'other') },
];

/** Return whether a persisted value is one of the known account icon ids. */
export function isAccountIconName(value?: string | null): value is AccountIconName {
  return typeof value === 'string' && (ACCOUNT_ICON_NAMES as readonly string[]).includes(value);
}

/** Resolve an icon id, preserving valid values and applying the kind fallback. */
export function resolveAccountIconId(name?: string | null, kind?: string | null): AccountIconName {
  if (isAccountIconName(name)) return name;
  const fallback = kind ? DEFAULT_ACCOUNT_ICON[kind] : undefined;
  return isAccountIconName(fallback) ? fallback : 'more-horizontal';
}

function normalizeAccountName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Suggest a known bank or instrument icon from an account name. */
export function suggestAccountIcon(name?: string | null): AccountIconName | null {
  if (!name?.trim()) return null;
  const normalized = normalizeAccountName(name);
  const tokens = new Set(normalized.split(' '));
  const options = [...ACCOUNT_BRANDS, ...ACCOUNT_INSTRUMENTS];
  const matches = options.flatMap((option) =>
    (option.aliases ?? []).flatMap((alias) => {
      const normalizedAlias = normalizeAccountName(alias);
      const position = normalized.indexOf(normalizedAlias);
      const isBoundaryMatch =
        position >= 0 &&
        (position === 0 || normalized[position - 1] === ' ') &&
        (position + normalizedAlias.length === normalized.length || normalized[position + normalizedAlias.length] === ' ');
      return isBoundaryMatch || tokens.has(normalizedAlias)
        ? [{ option, position, length: normalizedAlias.length }]
        : [];
    }),
  );
  matches.sort((a, b) => a.position - b.position || b.length - a.length);
  return matches[0]?.option.name ?? null;
}

export const DEFAULT_ACCOUNT_ICON: Record<string, AccountIconName> = {
  bank: 'bank', cash: 'money', card: 'card', loan: 'loan', investment: 'trending-up',
  equity: 'scale', income: 'briefcase', expense: 'briefcase', other: 'more-horizontal',
};
