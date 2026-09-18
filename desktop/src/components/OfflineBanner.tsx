import * as React from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import {
  retryFailedOperations,
  syncAll,
  subscribePendingCount,
  subscribeSync,
} from '@/offline/sync-engine';
import { subscribeConnectivity } from '@/offline/net';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type BannerState = 'online' | 'offline';

/** Displays connectivity and pending-sync status. */
export function OfflineBanner() {
  const { t } = useI18n();
  const [pendingCount, setPendingCount] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const [failedCount, setFailedCount] = React.useState(0);
  const [state, setState] = React.useState<BannerState>('offline');

  React.useEffect(() => {
    let mounted = true;
    const unsubPending = subscribePendingCount((count) => {
      if (mounted) setPendingCount(count);
    });
    const unsubSync = subscribeSync((result) => {
      if (mounted) {
        setSyncing(false);
        setFailedCount(result.failed);
      }
    });
    const unsubConnectivity = subscribeConnectivity((online) => {
      if (mounted) setState(online ? 'online' : 'offline');
    });
    return () => {
      mounted = false;
      unsubPending();
      unsubSync();
      unsubConnectivity();
    };
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    const result = failedCount > 0 ? await retryFailedOperations() : await syncAll();
    setSyncing(false);
    setState(result.ok || result.error !== 'offline' ? 'online' : 'offline');
  };

  // Nothing to surface. Online with no pending changes.
  if (state === 'online' && pendingCount === 0 && failedCount === 0 && !syncing) {
    return null;
  }

  if (state === 'offline' && pendingCount === 0 && failedCount === 0) {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-1.5 text-xs text-warning">
        <CloudOff className="h-3.5 w-3.5" />
        <span>{t('offline.offline')}</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b px-4 py-1.5 text-xs',
        syncing
          ? 'border-border bg-muted/40 text-muted-foreground'
          : state === 'offline'
            ? 'border-border bg-warning/10 text-warning'
            : 'border-border bg-income/10 text-income',
      )}
    >
      {syncing ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : state === 'offline' ? (
        <CloudOff className="h-3.5 w-3.5" />
      ) : (
        <CloudOff className="h-3.5 w-3.5 opacity-60" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {syncing
          ? t('offline.syncing')
          : failedCount > 0
            ? t(
                failedCount === 1 ? 'offline.failed_one' : 'offline.failed_other',
                { count: failedCount },
              )
          : state === 'offline'
            ? t(
                pendingCount === 1
                  ? 'offline.pending_one'
                  : 'offline.pending_other',
                { count: pendingCount },
              )
            : t(
                pendingCount === 1
                  ? 'offline.syncPending_one'
                  : 'offline.syncPending_other',
                { count: pendingCount },
              )}
      </span>
      {!syncing && pendingCount > 0 && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void handleSync()}>
          <RefreshCw className="h-3 w-3" />
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}
