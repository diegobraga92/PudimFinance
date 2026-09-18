import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';

import { useI18n } from '@/app/i18n';

/** Floating add-transaction button for phones. */
export function QuickAddFab() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate('/transactions?add=1')}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_20px_rgb(0_0_0_/_0.35)] transition-transform active:scale-95 md:hidden"
      aria-label={t('header.addTransaction')}
    >
      <Plus className="h-6 w-6" />
    </button>
  );
}
