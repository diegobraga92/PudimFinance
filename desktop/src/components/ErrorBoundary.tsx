import * as React from 'react';

import { ErrorFallback } from '@/components/ErrorFallback';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps render errors inside the current screen. */
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
