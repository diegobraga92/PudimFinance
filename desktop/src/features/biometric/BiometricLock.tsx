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
/** Skip re-locking for a moment after a successful unlock (dialog teardown). */
const UNLOCK_SUPPRESS_MS = 1_500;

/**
 * Locks the app behind the Android biometric prompt.
 *
 * It locks on a restored session (any launch after the first login) and
 * auto-prompts, while a fresh password login stays unlocked for that session.
 * It re-locks and re-prompts whenever the app returns from the background. On
 * desktop the native commands report "unavailable", so children render directly
 * with no lock.
 */
export function BiometricLock({ children, lockOnMount }: BiometricLockProps) {
  const { t } = useI18n();
  const [supported, setSupported] = React.useState(false);
  const [locked, setLocked] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const prompting = React.useRef(false);
  const didAutoPrompt = React.useRef(false);
  const unlockedAt = React.useRef(0);
  const prevVisible = React.useRef(document.visibilityState);

  const suppressRelock = React.useCallback(
    () => Date.now() - unlockedAt.current < UNLOCK_SUPPRESS_MS,
    [],
  );

  const prompt = React.useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const result = await Promise.race([
        authenticateBiometric(),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), PROMPT_TIMEOUT_MS)),
      ]);
      if (result) {
        unlockedAt.current = Date.now();
        setLocked(false);
      }
    } catch {
      // Stay locked if the prompt fails for any reason.
    } finally {
      prompting.current = false;
    }
  }, []);

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

  // Re-lock on background/hidden and re-prompt when returning to the foreground.
  React.useEffect(() => {
    const onVisibility = () => {
      const next = document.visibilityState;
      const prev = prevVisible.current;
      prevVisible.current = next;
      if (next === 'hidden') {
        // Any in-flight OS dialog is gone now. Clear the guard so a
        // never-settling prompt can't wedge the Unlock button.
        prompting.current = false;
        if (supported && !suppressRelock()) setLocked(true);
      } else if (next === 'visible' && prev === 'hidden') {
        prompting.current = false;
        if (supported && !suppressRelock()) {
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
  }, [supported, prompt, suppressRelock]);

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
          disabled={prompting.current}
        >
          <ShieldCheck className="h-4 w-4" />
          {t('biometric.unlock')}
        </Button>
      </div>
    </div>
  );
}
