import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Settings2, Smartphone } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { fetchAccountsWithBalance, fetchCategories } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/CategoryIcon';
import { cn } from '@/lib/utils';
import {
  KNOWN_APPS,
  getNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from '@/notifications/capture';
import {
  captureSupported,
  notificationAccessGranted,
  notificationPostingAllowed,
  getLastNativeError,
  openNotificationAccessSettings,
  requestNotificationPermission,
  syncCaptureSettings,
} from '@/notifications/native';

/**
 * The Notifications section of Settings. Controls Android push-notification capture
 * (master switch, watched apps, capture mode, fallback category).
 *
 * On desktop the screen renders the same UI but with an "Android only" notice,
 * since no desktop OS API exposes other apps' notifications.
 */
export function NotificationSettingsPage() {
  const { t } = useI18n();
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const categories = categoriesQuery.data ?? [];
  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => fetchAccountsWithBalance() });
  const accounts = accountsQuery.data ?? [];

  const [settings, setSettings] = React.useState<NotificationSettings | null>(null);
  const [supported, setSupported] = React.useState<boolean | null>(null);
  const [accessGranted, setAccessGranted] = React.useState<boolean | null>(null);
  // Whether Android lets the app post its own (import-prompt) notifications.
  const [postingAllowed, setPostingAllowed] = React.useState<boolean | null>(null);
  const [nativeError, setNativeError] = React.useState<string | null>(null);

  const refreshPermissions = React.useCallback(async () => {
    if (!supported) return;
    const granted = await notificationAccessGranted();
    const posting = await notificationPostingAllowed();
    setAccessGranted(granted);
    setPostingAllowed(posting);
    setNativeError(getLastNativeError());
  }, [supported]);

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      const isSupported = await captureSupported();
      const s = await getNotificationSettings();
      if (!mounted) return;
      // This screen is only exposed as an Android feature in the Tauri shell.
      // Keep it usable if the capability probe races plugin registration or an
      // older native build does not expose `is_supported` yet.
      const tauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      setSupported(isSupported || tauriRuntime);
      setSettings(s);
      if (isSupported || tauriRuntime) {
        const granted = await notificationAccessGranted();
        const posting = await notificationPostingAllowed();
        setAccessGranted(granted);
        setPostingAllowed(posting);
        setNativeError(getLastNativeError());
      } else {
        setAccessGranted(false);
        setPostingAllowed(false);
        setNativeError(getLastNativeError());
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Refresh the access/permission flags when the window regains focus (the user
  // may have just toggled them in the Android system settings).
  React.useEffect(() => {
    const onFocus = () => void refreshPermissions();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshPermissions();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshPermissions]);

  const update = React.useCallback((patch: Partial<NotificationSettings>) => {
    setSettings((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      void saveNotificationSettings(next);
      // Keep the native listener's copy in sync so it can prompt while dead.
      void syncCaptureSettings(next);
      return next;
    });
  }, []);

  const handleEnabledChange = React.useCallback(
    (enabled: boolean) => {
      update({ enabled });
      if (enabled && supported && accessGranted !== true) {
        // Android notification access is a special permission: it must be
        // granted from the system settings screen rather than an in-app dialog.
        void openNotificationAccessSettings();
      }
    },
    [accessGranted, supported, update],
  );

  if (!settings || supported === null) return null;
  const canCapture = supported && settings.enabled && accessGranted === true;

  return (
    <div className="mx-auto max-w-3xl space-y-4 md:space-y-6">
      <PageHeader titleKey="notifications.title" subtitleKey="notifications.autoCaptureDesc" />

      {!supported && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <Smartphone className="h-4 w-4 shrink-0" />
          <span>{t('notifications.unavailable')}</span>
        </div>
      )}

      {supported && accessGranted === false && (
        <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-3">
            <BellRing className="h-4 w-4 shrink-0" />
            <span>{t('notifications.permissionDenied')}</span>
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void openNotificationAccessSettings().then((opened) => {
                  setNativeError(opened ? null : getLastNativeError());
                });
              }}
            >
              <Settings2 className="h-4 w-4" />
              {t('notifications.openSettings')}
            </Button>
          </div>
        </div>
      )}

      {supported && settings.pushPrompt && postingAllowed === false && (
        <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <div className="flex items-start gap-3">
            <BellRing className="h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">{t('notifications.pushBlocked')}</p>
              <p className="text-xs">{t('notifications.pushBlockedDesc')}</p>
            </div>
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // The system dialog resolves asynchronously, so re-check shortly
                // after instead of trusting the immediate (pre-answer) state.
                void requestNotificationPermission().then(() => {
                  setNativeError(getLastNativeError());
                  window.setTimeout(
                    () => void refreshPermissions(),
                    800,
                  );
                });
              }}
            >
              <BellRing className="h-4 w-4" />
              {t('notifications.enableNotifications')}
            </Button>
          </div>
        </div>
      )}

      {nativeError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          <p className="font-medium">{t('notifications.nativeError')}</p>
          <p className="mt-1 break-words font-mono opacity-80">{nativeError}</p>
        </div>
      )}

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{t('notifications.autoCapture')}</CardTitle>
          <CardDescription>{t('notifications.autoCaptureDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            {canCapture
              ? t('notifications.askBeforeDesc')
              : settings.enabled
                ? t('notifications.permissionNeeded')
                : t('notifications.autoCaptureDesc')}
          </span>
          <Switch
            checked={settings.enabled}
            onCheckedChange={handleEnabledChange}
            disabled={!supported}
            aria-label={t('notifications.autoCapture')}
          />
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{t('notifications.monitoredApps')}</CardTitle>
          <CardDescription>
            {settings.monitoredApps.length === 0
              ? t('notifications.watchingAll')
              : t('notifications.clearSelection')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {KNOWN_APPS.map((app) => {
              const active = settings.monitoredApps.includes(app.appName);
              return (
                <button
                  key={app.appName}
                  type="button"
                  disabled={!canCapture}
                  onClick={() =>
                    update({
                      monitoredApps: active
                        ? settings.monitoredApps.filter((a) => a !== app.appName)
                        : [...settings.monitoredApps, app.appName],
                    })
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover',
                  )}
                >
                  {app.label}
                </button>
              );
            })}
          </div>
          {settings.monitoredApps.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {settings.monitoredApps.map((name) => (
                <Badge key={name} variant="secondary">
                  {name}
                </Badge>
              ))}
            </div>
          )}
          {settings.monitoredApps.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!canCapture}
              onClick={() => update({ monitoredApps: [] })}
            >
              {t('notifications.clearSelection')}
            </Button>
          )}
        </CardContent>
      </Card>


      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{t('notifications.pushPrompt')}</CardTitle>
          <CardDescription>{t('notifications.pushPromptDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">{t('notifications.promptHint')}</span>
          <Switch
            checked={settings.pushPrompt}
            onCheckedChange={(pushPrompt) => update({ pushPrompt })}
            disabled={!canCapture || settings.mode !== 'ask'}
            aria-label={t('notifications.pushPrompt')}
          />
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{t('notifications.captureMode')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <button
            type="button"
            disabled={!canCapture}
            onClick={() => update({ mode: 'ask' })}
            className="flex w-full items-start justify-between gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            <div>
              <p className="text-sm font-medium">{t('notifications.askBefore')}</p>
              <p className="text-xs text-muted-foreground">{t('notifications.askBeforeDesc')}</p>
            </div>
            <span
              className={cn(
                'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                settings.mode === 'ask' ? 'border-primary' : 'border-muted-foreground/40',
              )}
            >
              {settings.mode === 'ask' && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
          </button>
          <button
            type="button"
            disabled={!canCapture}
            onClick={() => update({ mode: 'auto' })}
            className="flex w-full items-start justify-between gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-surface-hover disabled:opacity-40"
          >
            <div>
              <p className="text-sm font-medium">{t('notifications.autoCreate')}</p>
              <p className="text-xs text-muted-foreground">{t('notifications.autoCreateDesc')}</p>
            </div>
            <span
              className={cn(
                'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                settings.mode === 'auto' ? 'border-primary' : 'border-muted-foreground/40',
              )}
            >
              {settings.mode === 'auto' && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
          </button>
        </CardContent>
      </Card>


      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>{t('notifications.defaultCategory')}</CardTitle>
          <CardDescription>{t('notifications.defaultCategoryDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canCapture}
              onClick={() => update({ defaultCategoryId: null })}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
                settings.defaultCategoryId === null
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover',
              )}
            >
              {t('common.none')}
            </button>
            {categories
              .filter((c) => c.type === 'expense')
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={!canCapture}
                  onClick={() => update({ defaultCategoryId: c.id })}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40',
                    settings.defaultCategoryId === c.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover',
                  )}
                >
                  <CategoryIcon name={c.icon} className="mr-1 inline h-3.5 w-3.5" />
                  {c.name}
                </button>
              ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('notifications.importAccounts')}</CardTitle>
          <CardDescription>{t('notifications.importAccountsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="nc-debit-account">{t('notifications.debitAccount')}</Label>
            <select
              id="nc-debit-account"
              disabled={!canCapture}
              value={settings.debitAccountId ?? ''}
              onChange={(e) => update({ debitAccountId: e.target.value || null })}
              className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <option value="">— {t('common.none')} —</option>
              {accounts
                .filter((a) => a.type === 'asset')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nc-credit-account">{t('notifications.creditAccount')}</Label>
            <select
              id="nc-credit-account"
              disabled={!canCapture}
              value={settings.creditAccountId ?? ''}
              onChange={(e) => update({ creditAccountId: e.target.value || null })}
              className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              <option value="">— {t('common.none')} —</option>
              {accounts
                .filter((a) => a.type === 'liability')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

