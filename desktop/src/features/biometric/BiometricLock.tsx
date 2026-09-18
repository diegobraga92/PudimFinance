import * as React from 'react';
import { Fingerprint, ShieldCheck } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { authenticateBiometric, biometricAvailable } from '@/notifications/native';

interface BiometricLockProps {
  children: React.ReactNode;
  /** Start locked on mount. True for a restored session, false after a fresh login. */
  lockOnMount: boolean;
}

/** A hung OS biometric dialog must never leave the Unlock button dead. */
const PROMPT_TIMEOUT_MS = 60_000;
/** Background duration after which the app requires biometric authentication. */
const RELOCK_AFTER_MS = 60_000;

/** Locks restored sessions behind the native biometric prompt. */
export function BiometricLock({ children, lockOnMount }: BiometricLockProps) {
  const { t } = useI18n();
  const [supported, setSupported] = React.useState(false);
  const [locked, setLocked] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const prompting = React.useRef(false);
  const [promptBusy, setPromptBusy] = React.useState(false);
  const didAutoPrompt = React.useRef(false);
  /** Timestamp when the app went to the background, or null while visible. */
  const awaySince = React.useRef<number | null>(null);
  const prevVisible = React.useRef(document.visibilityState);

  /** Releases the in-flight guard before Android suspends the webview. */
  const releasePromptGuard = React.useCallback(() => {
    prompting.current = false;
    setPromptBusy(false);
  }, []);

  const prompt = React.useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    setPromptBusy(true);
    try {
      const result = await Promise.race([
        authenticateBiometric(),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), PROMPT_TIMEOUT_MS)),
      ]);
      if (result) {
        setLocked(false);
      }
    } catch {
      // Stay locked if the prompt fails for any reason.
    } finally {
      releasePromptGuard();
    }
  }, [releasePromptGuard]);

  // Check for biometric hardware/enrollment and decide the initial lock state.
  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      const ok = await biometricAvailable();
      if (!mounted) return;
      setSupported(ok);
      setLocked(ok && lockOnMount);
      setReady(true);
    })();
    return () => {
      mounted = false;
    };
  }, [lockOnMount]);

  // Auto-prompt once when the app opens locked (restored session).
  React.useEffect(() => {
    if (didAutoPrompt.current) return;
    if (!ready || !supported || !locked) return;
    didAutoPrompt.current = true;
    void prompt();
  }, [ready, supported, locked, prompt]);

  // Re-lock only after a longer absence, and re-prompt when that happens.
  React.useEffect(() => {
    const onVisibility = () => {
      const next = document.visibilityState;
      const prev = prevVisible.current;
      prevVisible.current = next;
      if (next === 'hidden') {
        // Record the departure and drop any in-flight guard: JS is about to be
        // suspended, so a pending native call can never resolve. Whether to
        // re-lock is decided from the elapsed time when we come back.
        awaySince.current = Date.now();
        releasePromptGuard();
      } else if (next === 'visible' && prev === 'hidden') {
        const away = awaySince.current === null ? 0 : Date.now() - awaySince.current;
        awaySince.current = null;
        // Brief round-trips (the biometric sheet, system settings) keep the
        // session open; only a longer absence re-locks.
        if (supported && away > RELOCK_AFTER_MS) {
          setLocked(true);
          void prompt();
        }
      }
    };
    const onFocus = () => {
      if (document.visibilityState === 'visible' && prevVisible.current === 'hidden') {
        onVisibility();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [supported, prompt, releasePromptGuard]);

  if (!ready) return null;
  if (!supported || !locked) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
          <Fingerprint className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-xl font-bold tracking-tight">{t('biometric.lockedTitle')}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t('biometric.lockedSubtitle')}
        </p>
        <Button
          className="mt-8 w-full"
          onClick={() => void prompt()}
          disabled={promptBusy}
        >
          <ShieldCheck className="h-4 w-4" />
          {t('biometric.unlock')}
        </Button>
      </div>
    </div>
  );
}
