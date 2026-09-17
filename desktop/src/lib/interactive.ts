import type * as React from 'react';

/** Shared affordance classes for rows that perform an action when activated. */
export const rowInteractiveClass =
  'cursor-pointer transition-colors hover:bg-surface-hover/60 active:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Prevents delayed taps and accidental text selection on touch controls. */
export const tapClass = 'touch-manipulation max-md:select-none';

/** Makes compact links comfortable to activate on a phone. */
export const linkHitClass = 'min-h-11 px-2 -mx-2';

/** Keyboard equivalent for a non-button row that has a click handler. */
export function rowKeyboardProps(onActivate: () => void): Pick<React.HTMLAttributes<HTMLElement>, 'role' | 'tabIndex' | 'onKeyDown'> {
  return {
    role: 'button',
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onActivate();
      }
    },
  };
}