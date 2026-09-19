import * as React from 'react';
import { CloudOff, RefreshCw, Trash2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import {
  discardPendingOperations,
  getFailedPendingOperations,
  retryFailedOperations,
  syncAll,
  subscribePendingCount,
  subscribeSync,
  type PendingOperation,
} from '@/offline/sync-engine';
import { subscribeConnectivity } from '@/offline/net';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type BannerState = 'online' | 'offline';

/** Translation key for the entity an operation belongs to. */
function entityLabelKey(
  entity: PendingOperation['entity_type'],
): 'nav.transactions' | 'nav.categories' | 'nav.accounts' {
  if (entity === 'transaction') return 'nav.transactions';
  if (entity === 'category') return 'nav.categories';
  return 'nav.accounts';
}

/** Translation key for the operation verb. */
function operationLabelKey(
  operation: PendingOperation['operation_type'],
): 'offline.opCreate' | 'offline.opUpdate' | 'offline.opDelete' {
  if (operation === 'create') return 'offline.opCreate';
  if (operation === 'update') return 'offline.opUpdate';
  return 'offline.opDelete';
}

/** Displays connectivity, pending-sync status, and failed changes. */
export function OfflineBanner() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [pendingCount, setPendingCount] = React.useState(0);
  const [syncing, setSyncing] = React.useState(false);
  const [failed, setFailed] = React.useState<PendingOperation[]>([]);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [reviewing, setReviewing] = React.useState(false);
  const [state, setState] = React.useState<BannerState>('offline');

  const refreshFailed = React.useCallback(async () => {
    setFailed(await getFailedPendingOperations());
  }, []);

  React.useEffect(() => {
    let mounted = true;
    void refreshFailed();
    const unsubPending = subscribePendingCount((count) => {
      if (mounted) setPendingCount(count);
    });
    const unsubSync = subscribeSync((result) => {
      if (mounted) {
        setSyncing(false);
        // The server message is what makes a rejection actionable ("account_id
        // does not reference an existing account" instead of a silent drop).
        setLastError(result.ok ? null : result.firstError ?? null);
        void refreshFailed();
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
  }, [refreshFailed]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result =
        failed.length > 0 ? await retryFailedOperations() : await syncAll();
      setLastError(result.ok ? null : result.firstError ?? null);
      setState(result.error === 'offline' ? 'offline' : 'online');
    } finally {
      setSyncing(false);
      void refreshFailed();
    }
  };

  const handleDiscard = async (ids: number[]) => {
    const discarded = await discardPendingOperations(ids);
    await refreshFailed();
    if (discarded > 0) {
      toast({ title: t('offline.discarded'), variant: 'success' });
    }
    const remaining = await getFailedPendingOperations();
    if (remaining.length === 0) setReviewing(false);
  };

  // Nothing to surface. Online, nothing pending, nothing failed.
  if (state === 'online' && pendingCount === 0 && failed.length === 0 && !syncing) {
    return null;
  }

  if (state === 'offline' && pendingCount === 0 && failed.length === 0) {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-1.5 text-xs text-warning">
        <CloudOff className="h-3.5 w-3.5" />
        <span>{t('offline.offline')}</span>
      </div>
    );
  }

  return (
    <>
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
            : failed.length > 0
              ? t(failed.length === 1 ? 'offline.failed_one' : 'offline.failed_other', {
                  count: failed.length,
                })
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
        {!syncing && lastError && (
          <span
            className="hidden max-w-[40%] shrink truncate opacity-80 md:inline"
            title={lastError}
          >
            {lastError}
          </span>
        )}
        {!syncing && failed.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setReviewing(true)}
          >
            {t('offline.review')}
          </Button>
        )}
        {!syncing && pendingCount > 0 && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void handleSync()}>
            <RefreshCw className="h-3 w-3" />
            {t('common.retry')}
          </Button>
        )}
      </div>

      {reviewing && (
        <Dialog open onOpenChange={(next) => !next && setReviewing(false)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('offline.failedTitle')}</DialogTitle>
              <DialogDescription>{t('offline.failedDesc')}</DialogDescription>
            </DialogHeader>
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {failed.map((op) => (
                <li
                  key={op.id}
                  className="rounded-md border border-border bg-surface p-3 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {t(entityLabelKey(op.entity_type))} ·{' '}
                      {t(operationLabelKey(op.operation_type))}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => void handleDiscard([op.id])}
                    >
                      <Trash2 className="h-3 w-3" />
                      {t('offline.discard')}
                    </Button>
                  </div>
                  {op.last_error && (
                    <p className="mt-1 break-words text-muted-foreground">{op.last_error}</p>
                  )}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewing(false)}>
                {t('common.close')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDiscard(failed.map((op) => op.id))}
              >
                {t('offline.discardAll')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
