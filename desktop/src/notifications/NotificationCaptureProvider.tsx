import * as React from 'react';
import { createTransaction } from '@/lib/api';
import { useToast } from '@/components/ui/toaster';
import { useI18n } from '@/app/i18n';
import {
  addPendingCapture,
  getNotificationSettings,
  getPendingCaptures,
  parseNotification,
  removePendingCapture,
  toPendingCapture,
  type NotificationSettings,
  type ParsedTransaction,
  type PendingCapture,
} from './capture';
import {
  drainNativeNotifications,
  subscribeNativeNotifications,
  type CapturedNotification,
} from './native';
import { refreshWidgetSpentToday } from '@/lib/widget';

/** How long a "just imported" capture stays suppressed to avoid double-imports. */
const DEDUP_WINDOW_MS = 30_000;

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
        // In ask mode, queue for review.
        void addPendingCapture(toPendingCapture(parsed, notification.app_name)).then((next) => {
          setPendingItems(next);
        });
      }
    },
    [persistTransaction],
  );
  const handleParsedRef = React.useRef(handleParsed);
  handleParsedRef.current = handleParsed;

  React.useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      settingsRef.current = await getNotificationSettings();
      if (mounted) setPendingItems(await getPendingCaptures());
      // Notifications captured while the app was killed (Android).
      for (const payload of await drainNativeNotifications()) {
        const settings = settingsRef.current;
        if (!settings?.enabled) continue;
        const text = [payload.title, payload.text].filter(Boolean).join(' ').trim();
        if (!text) continue;
        const parsed = parseNotification(text, [], settings.defaultCategoryId);
        if (parsed) handleParsedRef.current(parsed, payload);
      }
      // Live subscription.
      unsubscribe = await subscribeNativeNotifications((payload) => {
        const settings = settingsRef.current;
        if (!settings?.enabled) return;
        if (
          settings.monitoredApps.length > 0 &&
          !settings.monitoredApps.includes(payload.app_name)
        ) {
          return;
        }
        const text = [payload.title, payload.text].filter(Boolean).join(' ').trim();
        if (!text) return;
        const parsed = parseNotification(text, [], settings.defaultCategoryId);
        if (parsed) handleParsedRef.current(parsed, payload);
      });
    })();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const approve = React.useCallback(
    async (
      id: string,
      overrides?: { description?: string; amount?: string; categoryId?: string | null },
    ) => {
      const item = pendingItems.find((c) => c.id === id);
      if (!item) return;
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

