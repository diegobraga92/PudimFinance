import * as React from 'react';
import { Info, PlugZap, Save } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  getApiBaseUrl,
  getDefaultServerUrl,
  setApiBaseUrl,
  testServerConnection,
} from '@/lib/serverConfig';
import { configureNativeSync } from '@/offline/native-outbox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** The Server screen under Settings. Configures the PudimFinance backend address at runtime. */
export function ServerPage() {
  const { t } = useI18n();
  const { toast } = useToast();

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const normalized = await setApiBaseUrl(value);
      await configureNativeSync();
      setCurrent(normalized);
      setValue(normalized);
      setTestResult(null);
      toast({ title: t('server.saved'), variant: 'success' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : t('server.failedSave'), variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const isDefault = current === getDefaultServerUrl();

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('nav.server')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('server.hint')}</p>
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
