import * as React from 'react';
import { createTransaction } from '@/lib/api';
import { useToast } from '@/components/ui/toaster';
import { useI18n } from '@/app/i18n';
import {
  addPendingCapture,
  appLabelFor,
  dedupKeyOf,
  getNotificationSettings,
  getPendingCaptures,
  isCaptureActionKind,
  markCapturePrompted,
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
    async (parsed: ParsedTransaction, categoryId: string | null) =>
      createTransaction({
        description: parsed.description,
        amount: parsed.amount,
        type: parsed.type,
        category_id: categoryId,
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
        const last = recentImportsRef.current.get(key);
        if (last !== undefined && Date.now() - last < DEDUP_WINDOW_MS) return;
        recentImportsRef.current.set(key, Date.now());

        void persistTransaction(parsed, parsed.categoryId)
          .then(() => {
            void refreshWidgetSpentToday();
            toastRef.current({
              title: tRef.current('notifications.captured', {
                type: parsed.type,
                amount: parsed.amount,
                description: parsed.description,
              }),
              variant: 'success',
            });
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
    let item = (await getPendingCaptures()).find((c) => c.id === action.capture_id);
    if (!item) {
      // The listener posted the prompt while the app was dead, so the inbox
      // entry may not exist yet (or carries a different id). Rebuild it from the
      // raw notification that travelled with the action.
      const text = [action.title, action.text].filter(Boolean).join(' ').trim();
      const parsed = text
        ? parseNotification(text, [], settingsRef.current?.defaultCategoryId ?? null)
        : null;
      if (parsed) {
        item = toPendingCapture(parsed, action.app_label ?? action.app_name ?? '', {
          id: action.capture_id,
        });
      }
    }
    if (!item) return;
    const { dedupKey } = item;
    const settings = settingsRef.current;
    const accountId =
      action.action === 'debit'
        ? settings?.debitAccountId ?? null
        : action.action === 'credit'
          ? settings?.creditAccountId ?? null
          : null;
    try {
      await createTransaction({
        description: item.description,
        amount: item.amount,
        type: transactionTypeForAction(action.action),
        category_id: item.categoryId,
        date: item.date,
        account_id: accountId,
        notes: tRef.current('notifications.notes'),
      });
      await removePendingCapture(item.id);
      const next = await removePendingCaptureByDedupKey(dedupKey);
      setPendingItems(next);
      void refreshWidgetSpentToday();
      toastRef.current({
        title: tRef.current('notifications.created', { amount: item.amount }),
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

  const drainQueuedCaptures = React.useCallback(async () => {
    const settings = settingsRef.current ?? (await getNotificationSettings());
    settingsRef.current = settings;
    if (!settings.enabled) return;
    for (const payload of await drainNativeNotifications()) {
      const label = sourceLabel(payload);
      if (settings.monitoredApps.length > 0 && !settings.monitoredApps.includes(label)) continue;
      const text = [payload.title, payload.text].filter(Boolean).join(' ').trim();
      if (!text) continue;
      const parsed = parseNotification(text, [], settings.defaultCategoryId);
      if (parsed) handleParsedRef.current(parsed, payload);
    }
    for (const action of await drainCaptureActions()) {
      await importFromActionRef.current(action);
    }
    setPendingItems(await getPendingCaptures());
  }, []);

  React.useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    let unsubscribeActions: (() => void) | null = null;

    void (async () => {
      settingsRef.current = await getNotificationSettings();
      if (settingsRef.current) void syncCaptureSettings(settingsRef.current);
      if (mounted) setPendingItems(await getPendingCaptures());
      // Register the live listener before draining cold-start captures. This
      // closes the startup window where the native plugin is alive but JS has
      // not subscribed yet.
      unsubscribe = await subscribeNativeNotifications((payload) => {
        const settings = settingsRef.current;
        if (!settings?.enabled) return;
        const label = sourceLabel(payload);
        if (settings.monitoredApps.length > 0 && !settings.monitoredApps.includes(label)) {
          return;
        }
        const text = [payload.title, payload.text].filter(Boolean).join(' ').trim();
        if (!text) return;
        const parsed = parseNotification(text, [], settings.defaultCategoryId);
        if (parsed) handleParsedRef.current(parsed, payload);
      });
      // Notifications captured while the app was killed (Android).
      for (const payload of await drainNativeNotifications()) {
        const settings = settingsRef.current;
        if (!settings?.enabled) continue;
        const label = sourceLabel(payload);
        if (settings.monitoredApps.length > 0 && !settings.monitoredApps.includes(label)) {
          continue;
        }
        const text = [payload.title, payload.text].filter(Boolean).join(' ').trim();
        if (!text) continue;
        const parsed = parseNotification(text, [], settings.defaultCategoryId);
        if (parsed) handleParsedRef.current(parsed, payload);
      }
      // Import actions tapped while the app was killed (Android).
      for (const action of await drainCaptureActions()) {
        await importFromActionRef.current(action);
      }
      // Live capture-prompt action subscription.
      unsubscribeActions = await subscribeCaptureActions((action) => {
        void importFromActionRef.current(action);
      });
    })();

    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeActions?.();
    };
  }, []);

  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void drainQueuedCaptures();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [drainQueuedCaptures]);

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
        setPendingItems(next);
        void refreshWidgetSpentToday();
        toastRef.current({
          title: tRef.current('notifications.created', { amount: overrides?.amount ?? item.amount }),
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
        imported += 1;
      } catch {
        // Keep failed items in the inbox so the user can retry or edit them.
      }
    }
    setPendingItems(await getPendingCaptures());
    void refreshWidgetSpentToday();
    if (imported > 0) {
      toastRef.current({
        title: tRef.current(
          imported === 1 ? 'notifications.approveAllDone_one' : 'notifications.approveAllDone_other',
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

