import * as React from 'react';

import { ErrorFallback } from '@/components/ErrorFallback';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a render error inside one screen.
 *
 * Without this, a crash in any page unmounts the whole tree and leaves a blank
 * window with no way back (the reported accounts bug). The shell — nav, tabs,
 * quick add — stays mounted, and remounting on navigation (the `key` the layout
 * passes) means switching screens clears the error.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('Screen crashed:', error);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      return <ErrorFallback error={error} onRetry={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}
