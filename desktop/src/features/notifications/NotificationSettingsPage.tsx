import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Settings2, Smartphone } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { fetchCategories } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { categoryIcon } from '@shared/category-icons';
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
  openNotificationAccessSettings,
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

  const [settings, setSettings] = React.useState<NotificationSettings | null>(null);
  const [supported, setSupported] = React.useState<boolean | null>(null);
  const [accessGranted, setAccessGranted] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      const isSupported = await captureSupported();
      const s = await getNotificationSettings();
      if (!mounted) return;
      setSupported(isSupported);
      setSettings(s);
      setAccessGranted(isSupported ? await notificationAccessGranted() : false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Refresh the access flag when the window regains focus (the user may have
  // just toggled it in the Android system settings).
  React.useEffect(() => {
    const onFocus = () => {
      if (supported) void notificationAccessGranted().then(setAccessGranted);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [supported]);

  const update = React.useCallback((patch: Partial<NotificationSettings>) => {
    setSettings((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...patch };
      void saveNotificationSettings(next);
      return next;
    });
  }, []);

  if (!settings || supported === null) return null;
  const canCapture = supported && settings.enabled;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('notifications.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('notifications.autoCaptureDesc')}</p>
      </div>

      {!supported && (
        <div className="flex items-center gap-3 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <Smartphone className="h-4 w-4 shrink-0" />
          <span>{t('notifications.unavailable')}</span>
        </div>
      )}

      {supported && accessGranted === false && (
        <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-3">
            <BellRing className="h-4 w-4 shrink-0" />
            <span>{t('notifications.permissionDenied')}</span>
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openNotificationAccessSettings()}
            >
              <Settings2 className="h-4 w-4" />
              {t('notifications.openSettings')}
            </Button>
          </div>
        </div>
      )}

      <Card>
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
            onCheckedChange={(enabled) => update({ enabled })}
            aria-label={t('notifications.autoCapture')}
          />
        </CardContent>
      </Card>

      <Card>
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


      <Card>
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


      <Card>
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
                  {c.icon ? `${categoryIcon(c.icon)} ` : ''}
                  {c.name}
                </button>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

