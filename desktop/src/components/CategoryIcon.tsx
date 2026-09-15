import {
  Book,
  Briefcase,
  Car,
  Film,
  Gift,
  Heart,
  Home,
  Laptop,
  MoreHorizontal,
  Plane,
  PlusCircle,
  Repeat,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Tag,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const CATEGORY_ICON_COMPONENTS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  laptop: Laptop,
  'trending-up': TrendingUp,
  gift: Gift,
  'plus-circle': PlusCircle,
  'shopping-cart': ShoppingCart,
  home: Home,
  car: Car,
  zap: Zap,
  film: Film,
  heart: Heart,
  book: Book,
  'shopping-bag': ShoppingBag,
  plane: Plane,
  repeat: Repeat,
  shield: Shield,
  'more-horizontal': MoreHorizontal,
};

export function resolveCategoryIcon(name?: string | null): LucideIcon {
  return (name && CATEGORY_ICON_COMPONENTS[name]) || Tag;
}

type CategoryIconProps = Omit<React.SVGProps<SVGSVGElement>, 'name'> & {
  name?: string | null;
};

export function CategoryIcon({ name, className, ...props }: CategoryIconProps) {
  const Icon = resolveCategoryIcon(name);
  return <Icon aria-hidden="true" className={cn('h-4 w-4 shrink-0', className)} {...props} />;
}