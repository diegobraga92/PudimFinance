import * as React from 'react';
import { createTransaction } from '@/lib/api';
import { useToast } from '@/components/ui/toaster';
import { useI18n } from '@/app/i18n';
import {
  addPendingCapture,
  accountIdForAction,
  appLabelFor,
  categoryIdForCapture,
  dedupKeyOf,
  getNotificationSettings,
  getPendingCaptures,
  hasImportedCapture,
  isCaptureActionKind,
  markCapturePrompted,
  markCaptureImported,
  parseNotification,
  removePendingCapture,
  removePendingCaptureByDedupKey,
  toPendingCapture,
  transactionTypeForAction,
  type NotificationSettings,
  type ParsedTransaction,
  type PendingCapture,
} from './capture';
import {
  cancelCapturePrompt,
  drainCaptureActions,
  drainNativeNotifications,
  notificationPostingAllowed,
  showCapturePrompt,
  subscribeCaptureActions,
  subscribeNativeNotifications,
  syncCaptureSettings,
  type CaptureAction,
  type CapturedNotification,
} from './native';
import { refreshWidgetSpentToday } from '@/lib/widget';
import { isOnline } from '@/offline/net';
import { requestSync } from '@/offline/sync-scheduler';

/** How long a "just imported" capture stays suppressed to avoid double-imports. */
const DEDUP_WINDOW_MS = 30_000;

/** Prefers the resolved app label over the raw package name. */
function sourceLabel(notification: CapturedNotification): string {
  return notification.app_label?.trim() || notification.app_name;
}

interface NotificationCaptureContextValue {
  /** Number of captured transactions waiting for review (ask mode). */
  pendingCount: number;
  pendingItems: PendingCapture[];
  refresh: () => Promise<void>;
  approve: (
    id: string,
    overrides?: { description?: string; amount?: string; categoryId?: string | null },
  ) => Promise<void>;
  approveAll: () => Promise<void>;
  skip: (id: string) => Promise<void>;
}

const NotificationCaptureContext = React.createContext<NotificationCaptureContextValue | null>(null);

export function useNotificationCapture(): NotificationCaptureContextValue {
  const ctx = React.useContext(NotificationCaptureContext);
  if (!ctx) throw new Error('useNotificationCapture requires NotificationCaptureProvider');
  return ctx;
}

export function NotificationCaptureProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [pendingItems, setPendingItems] = React.useState<PendingCapture[]>([]);
  const settingsRef = React.useRef<NotificationSettings | null>(null);
  const recentImportsRef = React.useRef<Map<string, number>>(new Map());
  const nativeUnsubscribeRef = React.useRef<(() => void) | null>(null);
  const actionUnsubscribeRef = React.useRef<(() => void) | null>(null);
  const toastRef = React.useRef(toast);
  toastRef.current = toast;
  const tRef = React.useRef(t);
  tRef.current = t;

  const refresh = React.useCallback(async () => {
    settingsRef.current = await getNotificationSettings();
    if (settingsRef.current) void syncCaptureSettings(settingsRef.current);
    setPendingItems(await getPendingCaptures());
  }, []);

  const persistTransaction = React.useCallback(
    async (parsed: ParsedTransaction, categoryId: string | null, accountId?: string | null) =>
      createTransaction({
        description: parsed.description,
        amount: parsed.amount,
        type: parsed.type,
        category_id: categoryId,
        account_id: accountId ?? undefined,
        date: parsed.date,
        notes: tRef.current('notifications.notes'),
      }),
    [],
  );

  /** Posts the OS import prompt for a freshly queued capture (Android). */
  const promptCapture = React.useCallback(async (item: PendingCapture): Promise<boolean> => {
    if (!(await notificationPostingAllowed())) return false;
    const appLabel = appLabelFor(item.appName);
    await showCapturePrompt({
      id: item.id,
      appLabel,
      title: tRef.current('notifications.promptTitle', { app: appLabel }),
      body: tRef.current('notifications.promptBody', {
        description: item.description,
        amount: item.amount,
      }),
    });
    return true;
  }, []);

  const handleParsed = React.useCallback(
    (parsed: ParsedTransaction, notification: CapturedNotification) => {
      const settings = settingsRef.current;
      if (!settings) return;

      if (settings.mode === 'auto') {
        // Avoid importing the same transaction twice within a short window.
        const key = `${parsed.type}|${parsed.amount}|${parsed.description}|${parsed.date}`;
        const dedupKey = dedupKeyOf(parsed);
        if (hasImportedCapture(dedupKey)) return;
        const last = recentImportsRef.current.get(key);
        if (last !== undefined && Date.now() - last < DEDUP_WINDOW_MS) return;
        recentImportsRef.current.set(key, Date.now());

        void persistTransaction(
          parsed,
          parsed.categoryId,
          parsed.type === 'expense' ? settings.debitAccountId : null,
        )
          .then(() => {
            void markCaptureImported(dedupKey);
            requestSync();
            void refreshWidgetSpentToday();
            void isOnline().then((online) => toastRef.current({
              title: online
                ? tRef.current('notifications.captured', {
                    type: parsed.type,
                    amount: parsed.amount,
                    description: parsed.description,
                  })
                : tRef.current('notifications.createdOffline', { amount: parsed.amount }),
              variant: 'success',
            }));
          })
          .catch(() => {});
      } else {
        // In ask mode, queue for review and (Android) post a system notification
        // with Income / Debit / Credit import actions. Each capture prompts at
        // most once, even if its (drained) notification is re-processed later.
        const appName = sourceLabel(notification);
        void addPendingCapture(
          toPendingCapture(parsed, appName, {
            id: notification.capture_id,
            prompted: notification.prompted,
          }),
        ).then(async (next) => {
          setPendingItems(next);
          const item = next.find((c) => c.dedupKey === dedupKeyOf(parsed));
          if (!item || !settings.pushPrompt || item.prompted) return;
          if (await promptCapture(item)) setPendingItems(await markCapturePrompted(item.id));
        });
      }
    },
    [persistTransaction, promptCapture],
  );
  const handleParsedRef = React.useRef(handleParsed);
  handleParsedRef.current = handleParsed;

  /** Imports a queued capture from a prompt action (income/debit/credit). */
  const importFromAction = React.useCallback(async (action: CaptureAction) => {
    if (!isCaptureActionKind(action.action)) return;
    // Settings may change while this provider remains mounted. Reload them so
    // push actions use the current account and default-category selections.
    const settings = await getNotificationSettings();
    settingsRef.current = settings;
    let item = (await getPendingCaptures()).find((c) => c.id === action.capture_id);
    if (!item) {
      // The listener posted the prompt while the app was dead, so the inbox
      // entry may not exist yet (or carries a different id). Rebuild it from the
      // raw notification that travelled with the action.
      const text = [action.title, action.text].filter(Boolean).join(' ').trim();
      const parsed = text
        ? parseNotification(text, [], settings.defaultCategoryId)
        : null;
      if (parsed) {
        item = toPendingCapture(parsed, action.app_label ?? action.app_name ?? '', {
          id: action.capture_id,
        });
      }
    }
    if (!item) return;
    const { dedupKey } = item;
    if (hasImportedCapture(dedupKey)) {
      setPendingItems(await removePendingCaptureByDedupKey(dedupKey));
      return;
    }
    const accountId = accountIdForAction(action.action, settings);
    const categoryId = categoryIdForCapture(item, settings);
    try {
      await createTransaction({
        description: item.description,
        amount: item.amount,
        type: transactionTypeForAction(action.action),
        category_id: categoryId,
        date: item.date,
        account_id: accountId,
        notes: tRef.current('notifications.notes'),
      });
      await removePendingCapture(item.id);
      const next = await removePendingCaptureByDedupKey(dedupKey);
      await markCaptureImported(dedupKey);
      setPendingItems(next);
      requestSync();
      void refreshWidgetSpentToday();
      const online = await isOnline();
      toastRef.current({
        title: online
          ? tRef.current('notifications.created', { amount: item.amount })
          : tRef.current('notifications.createdOffline', { amount: item.amount }),
        variant: 'success',
      });
    } catch (err) {
      toastRef.current({
        title: err instanceof Error ? err.message : tRef.current('notifications.failedCreate'),
        variant: 'error',
      });
    }
  }, []);
  const importFromActionRef = React.useRef(importFromAction);
  importFromActionRef.current = importFromAction;

  const subscribeLive = React.useCallback(async () => {
    if (!nativeUnsubscribeRef.current) {
      nativeUnsubscribeRef.current = await subscribeNativeNotifications((payload) => {
        void (async () => {
          const settings = await getNotificationSettings();
          settingsRef.current = settings;
          const label = sourceLabel(payload);
          if (!settings.enabled) return;
          if (settings.monitoredApps.length > 0 && !settings.monitoredApps.includes(label)) return;
          const text = [payload.title, payload.text].filter(Boolean).join(' ').trim();
          if (!text) return;
          const parsed = parseNotification(text, [], settings.defaultCategoryId);
          if (parsed) handleParsedRef.current(parsed, payload);
        })();
      });
    }
    if (!actionUnsubscribeRef.current) {
      actionUnsubscribeRef.current = await subscribeCaptureActions((action) => {
        void importFromActionRef.current(action);
      });
    }
  }, []);

  const unsubscribeLive = React.useCallback(() => {
    nativeUnsubscribeRef.current?.();
    actionUnsubscribeRef.current?.();
    nativeUnsubscribeRef.current = null;
    actionUnsubscribeRef.current = null;
  }, []);

  const drainQueuedCaptures = React.useCallback(async () => {
    // Settings may have changed while this provider stayed mounted or while the
    // app was backgrounded. Use the persisted values for every drain.
    const settings = await getNotificationSettings();
    settingsRef.current = settings;
    if (settings.enabled) {
      for (const payload of await drainNativeNotifications()) {
        const label = sourceLabel(payload);
        if (settings.monitoredApps.length > 0 && !settings.monitoredApps.includes(label)) continue;
        const text = [payload.title, payload.text].filter(Boolean).join(' ').trim();
        if (!text) continue;
        const parsed = parseNotification(text, [], settings.defaultCategoryId);
        if (parsed) handleParsedRef.current(parsed, payload);
      }
    }
    for (const action of await drainCaptureActions()) {
      await importFromActionRef.current(action);
    }
    setPendingItems(await getPendingCaptures());
  }, []);

  React.useEffect(() => {
    let mounted = true;

    void (async () => {
      settingsRef.current = await getNotificationSettings();
      if (settingsRef.current) void syncCaptureSettings(settingsRef.current);
      if (mounted) setPendingItems(await getPendingCaptures());
      // Register the live listener before draining cold-start captures. This
      // closes the startup window where the native plugin is alive but JS has
      // not subscribed yet.
      await subscribeLive();
      // Drain after both live listeners are registered. This avoids losing an
      // event in the startup window and also refreshes the review inbox on a
      // cold start, rather than relying on a later focus event.
      await drainQueuedCaptures();
    })();

    return () => {
      mounted = false;
      unsubscribeLive();
    };
  }, [drainQueuedCaptures, subscribeLive, unsubscribeLive]);

  React.useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // A registered Tauri listener remains alive while Android backgrounds
        // the Activity. Unregister so the native service persists captures for
        // the next foreground drain instead of sending into a suspended WebView.
        unsubscribeLive();
      } else if (document.visibilityState === 'visible') {
        void (async () => {
          await subscribeLive();
          await drainQueuedCaptures();
        })();
      }
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') void subscribeLive();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [drainQueuedCaptures, subscribeLive, unsubscribeLive]);

  const approve = React.useCallback(
    async (
      id: string,
      overrides?: { description?: string; amount?: string; categoryId?: string | null },
    ) => {
      const item = pendingItems.find((c) => c.id === id);
      if (!item) return;
      void cancelCapturePrompt(id);
      try {
        await createTransaction({
          description: overrides?.description ?? item.description,
          amount: overrides?.amount ?? item.amount,
          type: item.type,
          category_id:
            overrides && overrides.categoryId !== undefined ? overrides.categoryId : item.categoryId,
          date: item.date,
          notes: tRef.current('notifications.notes'),
        });
        const next = await removePendingCapture(id);
        await markCaptureImported(item.dedupKey);
        setPendingItems(next);
        requestSync();
        void refreshWidgetSpentToday();
        const online = await isOnline();
        toastRef.current({
          title: online
            ? tRef.current('notifications.created', { amount: overrides?.amount ?? item.amount })
            : tRef.current('notifications.createdOffline', {
                amount: overrides?.amount ?? item.amount,
              }),
          variant: 'success',
        });
      } catch (err) {
        toastRef.current({
          title: err instanceof Error ? err.message : tRef.current('notifications.failedCreate'),
          variant: 'error',
        });
        throw err;
      }
    },
    [pendingItems],
  );

  const approveAll = React.useCallback(async () => {
    const items = await getPendingCaptures();
    let imported = 0;
    let importedOffline = false;
    for (const item of items) {
      void cancelCapturePrompt(item.id);
      try {
        await createTransaction({
          description: item.description,
          amount: item.amount,
          type: item.type,
          category_id: item.categoryId,
          date: item.date,
          notes: tRef.current('notifications.notes'),
        });
        await removePendingCapture(item.id);
        await markCaptureImported(item.dedupKey);
        if (!(await isOnline())) importedOffline = true;
        imported += 1;
      } catch {
        // Keep failed items in the inbox so the user can retry or edit them.
      }
    }
    setPendingItems(await getPendingCaptures());
    requestSync();
    void refreshWidgetSpentToday();
    if (imported > 0) {
      toastRef.current({
        title: importedOffline
          ? tRef.current(
              imported === 1
                ? 'notifications.approveAllDoneOffline_one'
                : 'notifications.approveAllDoneOffline_other',
              { count: imported },
            )
          : tRef.current(
              imported === 1
                ? 'notifications.approveAllDone_one'
                : 'notifications.approveAllDone_other',
              { count: imported },
            ),
        variant: 'success',
      });
    }
  }, []);

  const skip = React.useCallback(async (id: string) => {
    void cancelCapturePrompt(id);
    const next = await removePendingCapture(id);
    setPendingItems(next);
  }, []);

  const value = React.useMemo(
    () => ({ pendingCount: pendingItems.length, pendingItems, refresh, approve, approveAll, skip }),
    [pendingItems, refresh, approve, approveAll, skip],
  );

  return (
    <NotificationCaptureContext.Provider value={value}>
      {children}
    </NotificationCaptureContext.Provider>
  );
}

