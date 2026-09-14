import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Native tri-state checkbox styled with the theme's accent color.
 *
 * The project has no `@radix-ui/react-checkbox`, and a native input keeps the
 * accessibility (`checked` / `indeterminate`) for free — the indeterminate dash
 * can only be set imperatively, hence the effect below.
 */
const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { indeterminate?: boolean }
>(({ className, indeterminate = false, ...props }, ref) => {
  const innerRef = React.useRef<HTMLInputElement>(null);

  React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

  React.useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={innerRef}
      type="checkbox"
      className={cn(
        'h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
Checkbox.displayName = 'Checkbox';

export { Checkbox };
