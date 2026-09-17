import {
  Banknote,
  Bitcoin,
  Building2,
  ChartCandlestick,
  CircleDollarSign,
  Briefcase,
  CreditCard,
  FileText,
  HandCoins,
  Home,
  Layers,
  Landmark,
  MoreHorizontal,
  PiggyBank,
  Scale,
  ShieldCheck,
  TrendingUp,
  Vault,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  ACCOUNT_BRANDS,
  ACCOUNT_INSTRUMENTS,
  resolveAccountIconId,
} from '@shared/account-icons';

const ACCOUNT_ICON_COMPONENTS: Record<string, LucideIcon> = {
  bank: Landmark,
  money: Banknote,
  card: CreditCard,
  loan: HandCoins,
  'trending-up': TrendingUp,
  wallet: Wallet,
  safe: Vault,
  scale: Scale,
  briefcase: Briefcase,
  home: Home,
  'more-horizontal': MoreHorizontal,
};

const ACCOUNT_INSTRUMENT_COMPONENTS: Record<string, LucideIcon> = {
  tesouro: Landmark,
  cdb: FileText,
  poupanca: PiggyBank,
  fgts: Building2,
  previdencia: ShieldCheck,
  acoes: ChartCandlestick,
  fii: Building2,
  fundos: Layers,
  cripto: Bitcoin,
  moedas: CircleDollarSign,
};

/** Resolve a generic/instrument icon to its Lucide component. */
export function resolveAccountIcon(name?: string | null, kind?: string | null): LucideIcon {
  const identifier = resolveAccountIconId(name, kind);
  return ACCOUNT_ICON_COMPONENTS[identifier] ?? ACCOUNT_INSTRUMENT_COMPONENTS[identifier] ?? MoreHorizontal;
}

type AccountIconProps = {
  name?: string | null;
  kind?: string | null;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
  style?: React.CSSProperties;
};

export function AccountIcon({ name, kind, className, ...props }: AccountIconProps) {
  const identifier = resolveAccountIconId(name, kind);
  const brand = ACCOUNT_BRANDS.find((option) => option.name === identifier);
  if (brand) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-flex shrink-0 items-center justify-center text-[0.62em] font-bold leading-none', className)}
        style={{ ...props.style, color: brand.color }}
      >
        {brand.monogram}
      </span>
    );
  }

  const instrument = ACCOUNT_INSTRUMENTS.find((option) => option.name === identifier);
  const Icon = instrument ? ACCOUNT_INSTRUMENT_COMPONENTS[instrument.name] : resolveAccountIcon(identifier);
  return <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0', className)} {...props} />;
}
