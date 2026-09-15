import {
  Banknote,
  Briefcase,
  CreditCard,
  HandCoins,
  Home,
  Landmark,
  MoreHorizontal,
  Scale,
  TrendingUp,
  Vault,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { DEFAULT_ACCOUNT_ICON } from '@shared/account-icons';

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

export function resolveAccountIcon(name?: string | null, kind?: string | null): LucideIcon {
  const identifier = name ?? (kind ? DEFAULT_ACCOUNT_ICON[kind] : undefined);
  return (identifier && ACCOUNT_ICON_COMPONENTS[identifier]) || MoreHorizontal;
}

type AccountIconProps = Omit<React.SVGProps<SVGSVGElement>, 'name'> & {
  name?: string | null;
  kind?: string | null;
};

export function AccountIcon({ name, kind, className, ...props }: AccountIconProps) {
  const Icon = resolveAccountIcon(name, kind);
  return <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0', className)} {...props} />;
}