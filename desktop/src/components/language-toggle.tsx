import { Languages } from 'lucide-react';
import { useI18n, type Locale } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Compact locale switcher for the header and login page. */
export function LanguageToggle() {
  const { t, locale, setLocale } = useI18n();

  const enLabel = t('app.languageEn');
  const ptLabel = t('app.languagePt');

  const choose = (next: Locale) => {
    setLocale(next);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('app.language')} title={t('app.language')}>
          <Languages className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => choose('en')}>
          {enLabel}
          {locale === 'en' && <span className="ml-auto text-income">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => choose('pt-BR')}>
          {ptLabel}
          {locale === 'pt-BR' && <span className="ml-auto text-income">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

