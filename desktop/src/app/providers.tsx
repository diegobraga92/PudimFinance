import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';

import { ThemeProvider } from './theme';
import { I18nProvider } from './i18n';
import { AuthProvider } from './auth';
import { Toaster } from '@/components/ui/toaster';
import { NotificationCaptureProvider } from '@/notifications/NotificationCaptureProvider';
import { isNetworkError } from '@/lib/request';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => !isNetworkError(error) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Composes every cross-cutting provider for the app. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <Toaster>
              <AuthProvider>
                <NotificationCaptureProvider>
                  {/* HashRouter keeps routing stable under the file:// protocol used by Tauri. */}
                  <HashRouter>{children}</HashRouter>
                </NotificationCaptureProvider>
              </AuthProvider>
            </Toaster>
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}
