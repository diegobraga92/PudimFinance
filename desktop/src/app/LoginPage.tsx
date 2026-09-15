import * as React from 'react';
import { Landmark, PlugZap } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { useI18n } from '@/app/i18n';
import { getApiBaseUrl, setApiBaseUrl, testServerConnection } from '@/lib/serverConfig';
import { fetchAuthProviders } from '@/lib/api';
import { isGoogleSignInCancelled } from '@/lib/googleAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LanguageToggle } from '@/components/language-toggle';

type Mode = 'login' | 'register';

/** Full-screen auth page shown when no valid session exists. */
export function LoginPage() {
  const { login, register, googleLogin } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = React.useState<Mode>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [server, setServer] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<'ok' | 'fail' | null>(null);
  const [googleAvailable, setGoogleAvailable] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    const timer = window.setTimeout(() => {
      void fetchAuthProviders()
        .then((providers) => setGoogleAvailable(providers.google))
        .catch(() => setGoogleAvailable(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [server]);

  // Prefill with the address the app is using: the saved one, else the default.
  React.useEffect(() => {
    void (async () => {
      setServer(await getApiBaseUrl());
    })();
  }, []);

  /**
   * Persists the typed address so the sign-in request hits it. Never throws:
   * blank input keeps whatever is already configured.
   */
  const saveServer = async () => {
    if (!server.trim()) return;
    try {
      setServer(await setApiBaseUrl(server));
    } catch {
      // Invalid address, so keep the previously configured one.
    }
  };

  const handleTestServer = async () => {
    if (!server.trim()) return;
    setTesting(true);
    setTestResult(null);
    const ok = await testServerConnection(server);
    setTestResult(ok ? 'ok' : 'fail');
    setTesting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // The server address typed on this screen wins over the stored one.
      await saveServer();
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName.trim() || undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.authFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await saveServer();
      await googleLogin();
    } catch (err) {
      if (!isGoogleSignInCancelled(err)) {
        setError(err instanceof Error ? err.message : t('login.googleFailed'));
      }
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-950 via-indigo-900 to-slate-950 p-10 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex items-center gap-2 text-lg font-semibold">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
            <Landmark className="h-5 w-5" />
          </div>
          PudimFinance
        </div>
        <div className="relative max-w-md">
          <h1 className="text-3xl font-bold leading-tight text-balance">
            Your money, understood at a glance.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-indigo-200/80">
            Track expenses, plan budgets, reconcile bank statements and capture
            payments automatically — on your own server, with your own data.
          </p>
        </div>
        <p className="relative text-xs text-indigo-200/60">Open source · Self-hosted · Private</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="absolute top-4 right-4">
          <LanguageToggle />
        </div>
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground lg:hidden">
              <Landmark className="h-6 w-6" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              {mode === 'login' ? t('login.subtitle') : t('login.registerSubtitle')}
            </h2>
          </div>

          {error && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Server address, so a fresh install can reach a remote backend before signing in. */}
          <div className="mb-4 space-y-1.5">
            <Label htmlFor="pudim-server">{t('server.title')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="pudim-server"
                type="url"
                spellCheck={false}
                autoComplete="url"
                value={server}
                onChange={(e) => {
                  setServer(e.target.value);
                  setTestResult(null);
                }}
                onBlur={() => void saveServer()}
                placeholder={t('login.serverPlaceholder')}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => void handleTestServer()}
                disabled={testing || !server.trim()}
              >
                <PlugZap className="h-4 w-4" />
                {testing ? t('common.loading') : t('server.test')}
              </Button>
            </div>
            {testResult === 'ok' && <p className="text-xs text-income">{t('server.connectionOk')}</p>}
            {testResult === 'fail' && (
              <p className="text-xs text-destructive">{t('server.connectionFailed')}</p>
            )}
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {googleAvailable && mode === 'login' && (
              <>
                <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void handleGoogleLogin()}>
                  {busy ? t('login.googleWaiting') : t('login.continueWithGoogle')}
                </Button>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  <span>{t('common.or')}</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
              </>
            )}
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="pudim-display-name">{t('login.displayName')}</Label>
                <Input
                  id="pudim-display-name"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ada Lovelace"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pudim-email">{t('login.email')}</Label>
              <Input
                id="pudim-email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pudim-password">{t('login.password')}</Label>
              <Input
                id="pudim-password"
                type="password"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? t('login.minChars') : '••••••••'}
              />
            </div>

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t('login.pleaseWait') : mode === 'login' ? t('login.signIn') : t('login.createAccount')}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === 'login' ? t('login.noAccount') : t('login.hasAccount')}{' '}
            <button
              type="button"
              className="font-semibold text-primary hover:underline"
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            >
              {mode === 'login' ? t('login.createOne') : t('login.signIn')}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
