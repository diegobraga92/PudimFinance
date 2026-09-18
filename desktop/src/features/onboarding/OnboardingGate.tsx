import * as React from 'react';
import { Landmark, ShieldCheck, Target } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TranslationKey } from '@shared/i18n';

const ONBOARDING_KEY = 'pudim_onboarded_v1';

interface OnboardingStep {
  icon: React.ComponentType<{ className?: string }>;
  titleKey: TranslationKey;
  descKey: TranslationKey;
}

const STEPS: OnboardingStep[] = [
  { icon: Landmark, titleKey: 'onboarding.step1Title', descKey: 'onboarding.step1Desc' },
  { icon: Target, titleKey: 'onboarding.step2Title', descKey: 'onboarding.step2Desc' },
  { icon: ShieldCheck, titleKey: 'onboarding.step3Title', descKey: 'onboarding.step3Desc' },
];

/** First-run welcome shown once per device. */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [ready, setReady] = React.useState(false);
  const [onboarded, setOnboarded] = React.useState(false);
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    try {
      setOnboarded(localStorage.getItem(ONBOARDING_KEY) === '1');
    } catch {
      setOnboarded(true);
    }
    setReady(true);
  }, []);

  const complete = React.useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // Continue without persisting the completion flag.
    }
    setOnboarded(true);
  }, []);

  if (!ready) return null;
  if (onboarded) return <>{children}</>;

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={complete}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('onboarding.skip')}
          </button>
        </div>

        <div className="flex flex-col items-center text-center">
          <div className="mb-6 flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-2 rounded-full transition-all duration-200',
                  i === step ? 'w-6 bg-primary' : 'w-2 bg-muted',
                )}
              />
            ))}
          </div>

          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
            <Icon className="h-10 w-10 text-primary" />
          </div>

          <h1 className="text-2xl font-bold tracking-tight">{t(current.titleKey)}</h1>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t(current.descKey)}
          </p>
        </div>

        <div className="mt-8">
          {step < STEPS.length - 1 ? (
            <Button className="w-full" onClick={() => setStep(step + 1)}>
              {t('onboarding.next')}
            </Button>
          ) : (
            <Button className="w-full" onClick={complete}>
              {t('onboarding.getStarted')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
