import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Info, PlugZap, Save, Terminal } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { fetchAccountsWithBalance, fetchCategories } from '@/lib/api';
import {
  getApiBaseUrl,
  getDefaultServerUrl,
  setApiBaseUrl,
  testServerConnection,
} from '@/lib/serverConfig';
import { configureNativeSync } from '@/offline/native-outbox';
import {
  getNotificationSettings,
  pruneStaleCaptureSettings,
  saveNotificationSettings,
} from '@/notifications/capture';
import { syncCaptureSettings } from '@/notifications/native';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Configures the backend address at runtime. */
export function ServerPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [current, setCurrent] = React.useState('');
  const [value, setValue] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<'ok' | 'fail' | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const base = await getApiBaseUrl();
      setCurrent(base);
      setValue(base);
    })();
  }, []);

  const handleTest = async () => {
    if (!value.trim()) return;
    setTesting(true);
    setTestResult(null);
    const ok = await testServerConnection(value);
    setTestResult(ok ? 'ok' : 'fail');
    setTesting(false);
  };

  /**
   * Re-validates the notification-capture settings against the server that was
   * just selected. Account/category ids are server-specific UUIDs, so ids from
   * the previous server would make the server reject every capture import.
   */
  const pruneCaptureSettingsForServer = async (): Promise<boolean> => {
    try {
      const [accounts, categories, settings] = await Promise.all([
        fetchAccountsWithBalance(),
        fetchCategories(),
        getNotificationSettings(),
      ]);
      const pruned = pruneStaleCaptureSettings(settings, { accounts, categories });
      if (!pruned.changed) return false;
      await saveNotificationSettings(pruned.settings);
      await syncCaptureSettings(pruned.settings);
      return true;
    } catch {
      // The new server may be unreachable right now; the notifications screen
      // prunes the same settings as soon as its lists load.
      return false;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const normalized = await setApiBaseUrl(value);
      await configureNativeSync();
      // Cached rows belong to the previous server.
      await queryClient.invalidateQueries();
      const pruned = await pruneCaptureSettingsForServer();
      setCurrent(normalized);
      setValue(normalized);
      setTestResult(null);
      toast({ title: t('server.saved'), variant: 'success' });
      if (pruned) {
        toast({ title: t('server.captureSettingsReset'), variant: 'info' });
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : t('server.failedSave'), variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const isDefault = current === getDefaultServerUrl();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.server')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('server.hint')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/logs')}>
          <Terminal className="mr-2 h-4 w-4" />
          {t('nav.logs')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('server.backendAddress')}</CardTitle>
          <CardDescription>
            {t('server.current')}: <span className="font-mono text-foreground">{current}</span>
            {isDefault && <span className="ml-1 text-dim">({t('server.default')})</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="server-url">{t('server.new')}</Label>
            <Input
              id="server-url"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setTestResult(null);
              }}
              onFocus={(e) => e.currentTarget.select()}
              placeholder={t('login.serverPlaceholder')}
              spellCheck={false}
            />
          </div>

          {testResult === 'ok' && (
            <div className="rounded-md border border-income/30 bg-income/10 px-3 py-2 text-sm text-income">
              {t('server.connectionOk')}
            </div>
          )}
          {testResult === 'fail' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t('server.connectionFailed')}
              <p className="mt-1 text-xs opacity-80">{t('server.connectionFailedDesc')}</p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void handleTest()} disabled={testing || !value.trim()}>
              <PlugZap className="h-4 w-4" />
              {testing ? t('common.loading') : t('server.test')}
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !value.trim()}>
              <Save className="h-4 w-4" />
              {saving ? t('common.saving') : t('server.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/40">
        <CardContent className="flex gap-3 p-5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{t('server.whyTitle')}</p>
            <p>{t('server.whyDesc')}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
