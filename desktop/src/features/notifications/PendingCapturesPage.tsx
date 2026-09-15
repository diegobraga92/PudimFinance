import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Edit3, Inbox, Loader2, X } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { fetchCategories } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useNotificationCapture } from '@/notifications/NotificationCaptureProvider';
import { appLabelFor, type PendingCapture } from '@/notifications/capture';

/**
 * The Pending review screen under Tools. Captured but unconfirmed transactions (ask mode).
 * Each entry can be imported as-is, edited, or skipped. The inbox is durable
 * (localStorage) and grouped by the source bank app.
 */
export function PendingCapturesPage() {
  const { t, formatMoney } = useI18n();
  const { pendingItems, approve, approveAll, skip } = useNotificationCapture();
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const categories = categoriesQuery.data ?? [];

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<PendingCapture | null>(null);
  const [editDescription, setEditDescription] = React.useState('');
  const [editAmount, setEditAmount] = React.useState('');
  const [editCategoryId, setEditCategoryId] = React.useState<string | null>(null);

  const categoryById = React.useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  // Group by source app label, preserving capture order within each group.
  const grouped = React.useMemo(() => {
    const map = new Map<string, PendingCapture[]>();
    for (const item of pendingItems) {
      const label = appLabelFor(item.appName);
      const list = map.get(label) ?? [];
      list.push(item);
      map.set(label, list);
    }
    return Array.from(map.entries());
  }, [pendingItems]);

  const openEdit = (item: PendingCapture) => {
    setEditing(item);
    setEditDescription(item.description);
    setEditAmount(item.amount);
    setEditCategoryId(item.categoryId);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const amount = editAmount.replace(',', '.').trim();
    if (!amount || !(parseFloat(amount) > 0)) return;
    try {
      await approve(editing.id, {
        description: editDescription.trim() || editing.description,
        amount,
        categoryId: editCategoryId,
      });
      setEditing(null);
    } catch {
      // approve() already surfaced the error via toast.
    }
  };

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      await approve(id);
    } catch {
      // approve() already surfaced the error via toast.
    } finally {
      setBusyId(null);
    }
  };

  if (pendingItems.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 md:space-y-6">
        <PageHeader
          titleKey="notifications.reviewTitle"
          subtitleKey="notifications.askBeforeDesc"
        />
        <EmptyState
          icon={<Inbox className="h-7 w-7" />}
          title={t('notifications.reviewEmpty')}
          description={t('notifications.reviewEmptyDesc')}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 md:space-y-6">
      <PageHeader
        titleKey="notifications.reviewTitle"
        subtitleKey="notifications.askBeforeDesc"
        actions={
          <Button onClick={() => void approveAll()} className="gap-1.5">
            <Check className="h-4 w-4" />
            {t('notifications.approveAll')}
          </Button>
        }
      />

      {grouped.map(([label, items]) => (
        <Card key={label} className="shadow-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t('notifications.fromApp', { app: label })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-xs font-semibold uppercase tracking-wide',
                        item.type === 'income' ? 'text-income' : 'text-destructive',
                      )}
                    >
                      {item.type === 'income' ? t('notifications.income') : t('notifications.expense')}
                    </span>
                    <span className="font-semibold">{formatMoney(item.amount)}</span>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{item.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {item.categoryId && categoryById.get(item.categoryId) && (
                      <Badge variant="secondary">
                        <CategoryIcon
                          name={categoryById.get(item.categoryId)!.icon}
                          className="mr-1 inline h-3.5 w-3.5"
                        />
                        {categoryById.get(item.categoryId)!.name}
                      </Badge>
                    )}
                    <span className="text-xs text-dim">{item.date}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('notifications.edit')}
                    aria-label={t('notifications.edit')}
                    onClick={() => openEdit(item)}
                  >
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('notifications.skip')}
                    aria-label={t('notifications.skip')}
                    onClick={() => void skip(item.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleApprove(item.id)}
                    disabled={busyId === item.id}
                    className="gap-1"
                  >
                    {busyId === item.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    {t('notifications.approve')}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}


      {editing && (
        <Dialog open onOpenChange={(next) => !next && setEditing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('notifications.captureTitle')}</DialogTitle>
              <DialogDescription>{t('notifications.askBeforeDesc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="nc-description">{t('notifications.description')}</Label>
                <Input
                  id="nc-description"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={t('notifications.descriptionPlaceholder')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nc-amount">{t('common.amount')}</Label>
                <Input
                  id="nc-amount"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('common.category')}</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setEditCategoryId(null)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                      editCategoryId === null
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover',
                    )}
                  >
                    {t('common.none')}
                  </button>
                  {categories
                    .filter((c) => c.type === editing.type)
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setEditCategoryId(c.id)}
                        className={cn(
                          'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                          editCategoryId === c.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover',
                        )}
                      >
                        <CategoryIcon name={c.icon} className="mr-1 inline h-3.5 w-3.5" />
                        {c.name}
                      </button>
                    ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void saveEdit()}>{t('notifications.create')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

