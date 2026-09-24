import * as React from 'react';
import { createTransaction, fetchAccountsWithBalance, fetchCategories } from '@/lib/api';
import { useToast } from '@/components/ui/toaster';
import { useI18n } from '@/app/i18n';
import {
  addPendingCapture,
  accountIdForAction,
  appLabelFor,
  captureDefaultAccountId,
  captureFromAction,
  categoryIdForCapture,
  dedupKeyOf,
  FALLBACK_CAPTURE_DESCRIPTION,
  getNotificationSettings,
  getNotificationSettingsSync,
  getPendingCaptures,
  hasImportedCapture,
  isCaptureActionKind,
  isoDateOrToday,
  markCapturePrompted,
  markCaptureImported,
  nativeImportTransaction,
  parseNotification,
  pruneStaleCaptureSettings,
  removePendingCapture,
  removePendingCaptureByDedupKey,
  saveNotificationSettings,
  toPendingCapture,
  transactionTypeForAction,
  type NotificationSettings,
  type ParsedTransaction,
  type PendingCapture,
} from './capture';
import {
  ackCaptureActions,
  cancelCapturePrompt,
  drainNativeNotifications,
  notificationPostingAllowed,
  peekPendingCaptureActions,
  showCapturePrompt,
  subscribeCaptureActions,
  subscribeNativeNotifications,
  syncCaptureSettings,
  type CaptureAction,
  type CapturedNotification,
} from './native';
import { isOnline } from '@/offline/net';
import { requestSync } from '@/offline/sync-scheduler';
import { adoptNativeTransaction, reconcileNativeSyncResults } from '@/offline/native-outbox';
import { getDefaultAccountId } from '@/lib/preferences';
import { logError, logEvent } from '@/lib/app-log';

/** How long a "just imported" capture stays suppressed to avoid double-imports. */
const DEDUP_WINDOW_MS = 30_000;

/** Amount shown by a review placeholder whose capture carried no usable value. */
const PLACEHOLDER_AMOUNT = '0.00';

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
    overrides?: {
      description?: string;
      amount?: string;
      categoryId?: string | null;
      accountId?: string | null;
      installments?: number;
    },
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
      appName: item.appName,
      description: item.description,
      amount: item.amount,
      date: item.date,
      categoryId: item.categoryId,
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
        logEvent(
          'info',
          'capture',
          `captured ${parsed.type} ${parsed.amount} "${parsed.description}" from ${appName || 'unknown app'}`,
        );
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

  /**
   * Clears capture settings that reference ids this server does not have.
   *
   * A restored server database (or a server switch that bypassed the server
   * page) leaves account/category ids the server rejects, which made every
   * native capture import fail while the app showed nothing. The settings page
   * prunes on sight; this runs the same check before the settings are handed to
   * the native listener, once per session.
   */
  const healedRef = React.useRef(false);
  const healCaptureSettings = React.useCallback(async (): Promise<NotificationSettings> => {
    const settings = await getNotificationSettings();
    if (healedRef.current) return settings;
    healedRef.current = true;
    try {
      if (!(await isOnline())) return settings;
      const [accounts, categories] = await Promise.all([fetchAccountsWithBalance(), fetchCategories()]);
      const pruned = pruneStaleCaptureSettings(settings, { accounts, categories });
      if (!pruned.changed) return settings;
      await saveNotificationSettings(pruned.settings);
      logEvent(
        'warn',
        'capture',
        'capture settings referenced ids missing from this server; cleared them',
      );
      toastRef.current({ title: tRef.current('notifications.staleSettingsCleared'), variant: 'warning' });
      return pruned.settings;
    } catch (err) {
      logError('capture', err, 'capture settings check failed');
      return settings;
    }
  }, []);

  /**
   * Surfaces closed-app sync problems: a capture the server stored with a
   * downgrade, or one it rejected permanently. The local mirror is kept pending
   * for both, so the toast points at a capture that is still there instead of
   * one that vanished.
   */
  const reportNativeSyncIssues = React.useCallback(async () => {
    const issues = await reconcileNativeSyncResults();
    for (const issue of issues) {
      logEvent('warn', 'capture', `native sync ${issue.kind} for ${issue.clientId}: ${issue.message}`);
      toastRef.current({
        title: tRef.current(
          issue.kind === 'failed' ? 'notifications.syncFailedTitle' : 'notifications.syncWarningTitle',
        ),
        description: issue.message,
        variant: issue.kind === 'failed' ? 'error' : 'warning',
      });
    }
  }, []);

  /**
   * Mirrors a transaction the native side imported while the app was asleep.
   *
   * The capture never reached this inbox: it was imported into the encrypted
   * outbox and dropped from the native queue, so the local row has to be built
   * from the event and settled with the worker's result.
   */
  const adoptNativeImport = React.useCallback(async (action: CaptureAction): Promise<PendingCapture[]> => {
    if (!action.client_id) return getPendingCaptures();
    const parsed = nativeImportTransaction(action);
    logEvent(
      'info',
      'capture',
      `native import ${action.client_id} received` +
        (parsed ? ` (${parsed.type} ${parsed.amount} "${parsed.description}")` : ''),
    );
    if (parsed) {
      // Skip the local row when the same capture was already imported through the
      // WebView (dedup journal hit); mirroring it again would show two rows.
      if (!hasImportedCapture(dedupKeyOf(parsed))) {
        await adoptNativeTransaction({
          client_id: action.client_id,
          type: action.type,
          amount: action.amount,
          description: action.description,
          date: action.date,
          category_id: action.category_id,
          account_id: action.account_id,
          notes: action.notes,
        });
      }
      const dedupKey = dedupKeyOf(parsed);
      await markCaptureImported(dedupKey);
      await removePendingCaptureByDedupKey(dedupKey);
      // The inbox entry that carried this capture is superseded by the import.
      if (action.capture_id) await removePendingCapture(action.capture_id);
    } else {
      // The native side did import it, but the journal entry no longer describes
      // a usable amount. Surface an editable review item instead of dropping the
      // tap silently — the transaction is already in the native outbox.
      await addPendingCapture(
        toPendingCapture(
          {
            type: action.type === 'income' ? 'income' : 'expense',
            amount: nativeImportTransaction({ amount: action.amount })?.amount ?? PLACEHOLDER_AMOUNT,
            description: action.description?.trim() || FALLBACK_CAPTURE_DESCRIPTION,
            date: isoDateOrToday(action.date),
            categoryId: action.category_id ?? null,
          },
          action.app_label ?? action.app_name ?? '',
          { id: action.capture_id },
        ),
      );
      logEvent(
        'warn',
        'capture',
        `native import ${action.client_id} carried no usable amount; kept for review`,
      );
      toastRef.current({ title: tRef.current('notifications.failedCreate'), variant: 'error' });
    }
    // The worker may already have settled it; draining now avoids a local row
    // that keeps looking unsynced for a transaction the server accepted.
    await reportNativeSyncIssues();
    return getPendingCaptures();
  }, [reportNativeSyncIssues]);

  /**
   * Imports a queued capture from a prompt action (income/debit/credit).
   *
   * Resolves whether the action is settled: `false` keeps it in the native
   * journal so the next drain retries instead of losing the tap.
   */
  const importFromAction = React.useCallback(async (action: CaptureAction): Promise<boolean> => {
    // Settings may change while this provider remains mounted. Reload them so
    // push actions use the current account and default-category selections.
    const settings = await getNotificationSettings();
    settingsRef.current = settings;
    if (action.native_import && action.client_id) {
      setPendingItems(await adoptNativeImport(action));
      return true;
    }
    const kind = action.action;
    if (!isCaptureActionKind(kind)) {
      // Nothing to import and nothing to retry: drop it instead of replaying it.
      logEvent('warn', 'capture', `capture ${action.capture_id} carried no import action`);
      return true;
    }
    logEvent('info', 'capture', `action ${kind} for capture ${action.capture_id}`);
    let item = (await getPendingCaptures()).find((c) => c.id === action.capture_id);
    if (!item) {
      // The listener posted the prompt while the app was dead, so the inbox
      // entry may not exist yet (or carries a different id). Rebuild it from the
      // raw notification text or the parsed fields that travelled with the tap.
      const rebuilt = captureFromAction(
        {
          action: kind,
          amount: action.amount,
          description: action.description,
          date: action.date,
          categoryId: action.category_id,
          title: action.title,
          text: action.text,
          app_name: action.app_name,
          app_label: action.app_label,
        },
        settings,
      );
      if (rebuilt) {
        item = toPendingCapture(rebuilt.parsed, rebuilt.appName, { id: action.capture_id });
      }
    }
    if (!item) {
      // Never swallow a tap: keep an editable placeholder so the capture still
      // reaches the review inbox instead of vanishing with the prompt.
      setPendingItems(
        await addPendingCapture(
          toPendingCapture(
            {
              type: transactionTypeForAction(kind),
              amount: '0.00',
              description: action.description?.trim() || FALLBACK_CAPTURE_DESCRIPTION,
              date: isoDateOrToday(action.date),
              categoryId: settings.defaultCategoryId,
            },
            action.app_label ?? action.app_name ?? '',
            { id: action.capture_id },
          ),
        ),
      );
      toastRef.current({ title: tRef.current('notifications.failedCreate'), variant: 'error' });
      logEvent(
        'warn',
        'capture',
        `action ${kind} for capture ${action.capture_id} could not be rebuilt; kept for review`,
      );
      return true;
    }
    const { dedupKey } = item;
    // The dedup journal is only written after a successful import, by this path,
    // by approve(), or by adoptNativeImport(), so a hit here is a genuine
    // duplicate notification rather than an unimported capture.
    if (hasImportedCapture(dedupKey)) {
      setPendingItems(await removePendingCaptureByDedupKey(dedupKey));
      logEvent('info', 'capture', `action ${kind} skipped: ${item.description} was already imported`);
      return true;
    }
    const accountId = accountIdForAction(kind, settings, getDefaultAccountId());
    const categoryId = categoryIdForCapture(item, settings);
    try {
      await createTransaction({
        description: item.description,
        amount: item.amount,
        type: transactionTypeForAction(kind),
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
      const online = await isOnline();
      logEvent('info', 'capture', `imported ${kind} ${item.amount} "${item.description}"`);
      toastRef.current({
        title: online
          ? tRef.current('notifications.created', { amount: item.amount })
          : tRef.current('notifications.createdOffline', { amount: item.amount }),
        variant: 'success',
      });
      return true;
    } catch (err) {
      logError('capture', err, `action ${kind} for capture ${action.capture_id}`);
      toastRef.current({
        title: err instanceof Error ? err.message : tRef.current('notifications.failedCreate'),
        variant: 'error',
      });
      // Leave the tap journaled so the next drain retries the import.
      return false;
    }
  }, [adoptNativeImport]);
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

  /** Guards against overlapping drains (visibility + focus can fire together). */
  const drainInFlightRef = React.useRef(false);

  const drainQueuedCaptures = React.useCallback(async () => {
    // Two overlapping drains would apply the same unacknowledged entry twice.
    if (drainInFlightRef.current) return;
    drainInFlightRef.current = true;
    try {
      // Settings may have changed while this provider stayed mounted or while the
      // app was backgrounded. Use the persisted values for every drain.
      const settings = await getNotificationSettings();
      settingsRef.current = settings;
      if (settings.enabled) {
        const queued = await drainNativeNotifications();
        if (queued.length > 0) {
          logEvent('info', 'capture', `drained ${queued.length} queued notification(s)`);
        }
        for (const payload of queued) {
          const label = sourceLabel(payload);
          if (settings.monitoredApps.length > 0 && !settings.monitoredApps.includes(label)) continue;
          const text = [payload.title, payload.text].filter(Boolean).join(' ').trim();
          if (!text) continue;
          const parsed = parseNotification(text, [], settings.defaultCategoryId);
          if (parsed) handleParsedRef.current(parsed, payload);
        }
      }
      // Peek, apply, acknowledge: an action the WebView cannot apply stays in
      // the native journal instead of being destroyed by the read.
      const actions = await peekPendingCaptureActions();
      if (actions.length > 0) {
        logEvent('info', 'capture', `peeked ${actions.length} queued capture action(s)`);
      }
      let acknowledged = 0;
      for (const action of actions) {
        let applied = false;
        try {
          applied = await importFromActionRef.current(action);
        } catch (err) {
          logError('capture', err, `draining capture ${action.capture_id}`);
        }
        // Acknowledge per entry so a later failure cannot drop an earlier import.
        if (applied) acknowledged += await ackCaptureActions([action.capture_id]);
      }
      if (acknowledged > 0) {
        logEvent('info', 'capture', `acknowledged ${acknowledged} queued capture action(s)`);
      }
      setPendingItems(await getPendingCaptures());
    } finally {
      drainInFlightRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    let mounted = true;

    void (async () => {
      settingsRef.current = await healCaptureSettings();
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
  }, [drainQueuedCaptures, healCaptureSettings, subscribeLive, unsubscribeLive]);

  React.useEffect(() => {
    // Re-registers the live listeners and applies anything the native side
    // journaled while they were unsubscribed (e.g. a tap on the prompt).
    const resume = () => {
      void (async () => {
        await subscribeLive();
        await drainQueuedCaptures();
      })();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // A registered Tauri listener remains alive while Android backgrounds
        // the Activity. Unregister so the native service persists captures for
        // the next foreground drain instead of sending into a suspended WebView.
        unsubscribeLive();
      } else if (document.visibilityState === 'visible') {
        resume();
      }
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible') resume();
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
      overrides?: {
        description?: string;
        amount?: string;
        categoryId?: string | null;
        accountId?: string | null;
        installments?: number;
      },
    ) => {
      const item = pendingItems.find((c) => c.id === id);
      if (!item) return;
      void cancelCapturePrompt(id);
      const settings = settingsRef.current ?? getNotificationSettingsSync();
      const defaultAccountId = captureDefaultAccountId(item.type, settings, getDefaultAccountId());
      try {
        await createTransaction({
          description: overrides?.description ?? item.description,
          amount: overrides?.amount ?? item.amount,
          type: item.type,
          category_id:
            overrides && overrides.categoryId !== undefined ? overrides.categoryId : item.categoryId,
          account_id:
            overrides && overrides.accountId !== undefined
              ? overrides.accountId
              : defaultAccountId,
          installments:
            overrides && overrides.installments !== undefined && overrides.installments > 1
              ? overrides.installments
              : undefined,
          date: item.date,
          notes: tRef.current('notifications.notes'),
        });
        const next = await removePendingCapture(id);
        await markCaptureImported(item.dedupKey);
        setPendingItems(next);
        requestSync();
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
    const settings = settingsRef.current ?? getNotificationSettingsSync();
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
          account_id: captureDefaultAccountId(item.type, settings, getDefaultAccountId()),
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

