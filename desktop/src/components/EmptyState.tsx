import * as React from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps {
  /** Lucide icon (or any node) shown inside the circular badge. */
  icon: React.ReactNode;
  title: string;
  description?: string;
  /** Primary call to action, usually a `<Button>` or a link. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Dashed-border empty state: a circular icon badge, a short title/description
 * and an optional call to action. Shared by the dashboard and the transactions
 * list so "nothing here yet" always looks intentional.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-[12px] border border-dashed border-border bg-foreground/[0.01] px-5 py-14 text-center',
        className,
      )}
    >
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="mt-4 text-base font-semibold">{title}</p>
      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
