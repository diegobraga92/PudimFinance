import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckSquare, Plus, Wallet } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  anticipateInstallments,
  createCardPurchase,
  fetchCardBills,
  fetchCategories,
  fetchCreditCards,
  fetchInstallmentPlan,
  fetchInstallmentPlans,
  fetchSettings,
  payCardBill,
  updateSettings,
  type CardBill,
  type CardExpenseDating,
  type CreateCardPurchaseRequest,
  type PayCardBillRequest,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface AnticipatableItem {
  installmentId: string;
  planDescription: string;
  number: number;
  total: number;
  amount: string;
  dueDate: string;
}

/** Options of the card-expense dating preference, shown as a segmented control. */
const DATING_OPTIONS: {
  value: CardExpenseDating;
  labelKey: 'creditCards.dating.purchase' | 'creditCards.dating.due';
  hintKey: 'creditCards.dating.purchaseHint' | 'creditCards.dating.dueHint';
}[] = [
  {
    value: 'purchase_date',
    labelKey: 'creditCards.dating.purchase',
    hintKey: 'creditCards.dating.purchaseHint',
  },
  { value: 'due_date', labelKey: 'creditCards.dating.due', hintKey: 'creditCards.dating.dueHint' },
];

/** Query keys whose data depends on the card-expense dating preference. */
const DATING_DEPENDENT_QUERIES = [
  'summary',
  'transactions',
  'budget-summary',
  'dashboard-cash-flow',
  'report-overview',
  'report-breakdown',
  'report-trends',
];

export function CreditCardsPage() {
  const { t, formatMoney, formatDate } = useI18n();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [bills, setBills] = React.useState<CardBill[]>([]);
  const [billsLoading, setBillsLoading] = React.useState(false);

  const [purchaseOpen, setPurchaseOpen] = React.useState(false);
  const [purchaseDesc, setPurchaseDesc] = React.useState('');
  const [purchaseAmount, setPurchaseAmount] = React.useState('');
  const [purchaseCategory, setPurchaseCategory] = React.useState('');
  const [purchaseDate, setPurchaseDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [purchaseSaving, setPurchaseSaving] = React.useState(false);
  const [purchaseError, setPurchaseError] = React.useState<string | null>(null);

  const [payOpen, setPayOpen] = React.useState(false);
  const [payBillId, setPayBillId] = React.useState('');
  const [payAmount, setPayAmount] = React.useState('');
  const [paySaving, setPaySaving] = React.useState(false);
  const [payError, setPayError] = React.useState<string | null>(null);

  const [anticipateOpen, setAnticipateOpen] = React.useState(false);
  const [anticipatable, setAnticipatable] = React.useState<AnticipatableItem[]>([]);
  const [checkedInstallments, setCheckedInstallments] = React.useState<string[]>([]);
  const [discountPercent, setDiscountPercent] = React.useState('');
  const [anticipateSaving, setAnticipateSaving] = React.useState(false);
  const [anticipateError, setAnticipateError] = React.useState<string | null>(null);

  const cardsQuery = useQuery({ queryKey: ['credit-cards'], queryFn: () => fetchCreditCards() });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => fetchSettings() });
  const queryClient = useQueryClient();
  const cards = React.useMemo(() => cardsQuery.data ?? [], [cardsQuery.data]);
  const categories = React.useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const selected = cards.find((c) => c.id === selectedId) ?? null;
  const currentBill = selected?.current_bill ?? null;
  const dating: CardExpenseDating =
    settingsQuery.data?.card_expense_dating === 'due_date' ? 'due_date' : 'purchase_date';
  const [savingDating, setSavingDating] = React.useState(false);

  /** Persists the dating preference and refreshes every view it affects. */
  const changeDating = async (value: CardExpenseDating) => {
    if (value === dating) return;
    setSavingDating(true);
    try {
      const saved = await updateSettings({ card_expense_dating: value });
      queryClient.setQueryData(['settings'], saved);
      for (const key of DATING_DEPENDENT_QUERIES) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast({ title: t('creditCards.dating.saved'), variant: 'success' });
    } catch (err) {
      toast({
        title: t('creditCards.dating.failed'),
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      });
    } finally {
      setSavingDating(false);
    }
  };

  const loadBills = React.useCallback(async (cardId: string) => {
    setBillsLoading(true);
    try {
      setBills(await fetchCardBills(cardId));
    } catch {
      setBills([]);
    } finally {
      setBillsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (cards.length > 0 && !selectedId) {
      setSelectedId(cards[0].id);
    }
  }, [cards, selectedId]);

  React.useEffect(() => {
    if (selectedId) void loadBills(selectedId);
  }, [selectedId, loadBills]);

  const refreshCards = async () => {
    await cardsQuery.refetch();
    if (selectedId) await loadBills(selectedId);
  };

  const openPurchase = () => {
    setPurchaseDesc('');
    setPurchaseAmount('');
    setPurchaseCategory('');
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setPurchaseError(null);
    setPurchaseOpen(true);
  };

  const handlePurchase = async () => {
    const amountNum = parseFloat(purchaseAmount.replace(',', '.'));
    if (!purchaseDesc.trim()) {
      setPurchaseError(t('creditCards.validation.desc'));
      return;
    }
    if (!(amountNum > 0)) {
      setPurchaseError(t('creditCards.validation.amount'));
      return;
    }
    if (!selected) return;
    setPurchaseSaving(true);
    setPurchaseError(null);
    const payload: CreateCardPurchaseRequest = {
      description: purchaseDesc.trim(),
      amount: purchaseAmount.replace(',', '.'),
      category_id: purchaseCategory || null,
      date: purchaseDate,
    };
    try {
      await createCardPurchase(selected.id, payload);
      setPurchaseOpen(false);
      await refreshCards();
      toast({ title: t('creditCards.recorded'), variant: 'success' });
    } catch (err) {
      setPurchaseError(err instanceof Error ? err.message : t('creditCards.failedRecord'));
    } finally {
      setPurchaseSaving(false);
    }
  };

  const openPay = () => {
    setPayBillId(currentBill?.id ?? '');
    setPayAmount('');
    setPayError(null);
    setPayOpen(true);
  };

  const handlePay = async () => {
    if (!selected) return;
    const amountNum = payAmount ? parseFloat(payAmount.replace(',', '.')) : NaN;
    if (payAmount && !(amountNum > 0)) {
      setPayError(t('creditCards.validation.amount'));
      return;
    }
    setPaySaving(true);
    setPayError(null);
    const payload: PayCardBillRequest = {
      bill_id: payBillId || null,
      amount: payAmount ? payAmount.replace(',', '.') : null,
    };
    try {
      const res = await payCardBill(selected.id, payBillId, payload);
      setPayOpen(false);
      await refreshCards();
      toast({
        title: t('creditCards.billPaid', {
          amount: formatMoney(res.amount_paid),
          remaining: formatMoney(res.remaining),
        }),
        variant: 'success',
      });
    } catch (err) {
      setPayError(err instanceof Error ? err.message : t('creditCards.failedPay'));
    } finally {
      setPaySaving(false);
    }
  };

  const openAnticipate = async () => {
    if (!selected) return;
    setAnticipateError(null);
    setDiscountPercent('');
    setCheckedInstallments([]);
    setAnticipatable([]);
    setAnticipateOpen(true);
    try {
      const plans = (await fetchInstallmentPlans()).filter((p) => p.account_id === selected.id);
      // Only installments belonging to a *future* billing cycle can be
      // anticipated. Anything due within the current open bill is not.
      const cutoff = currentBill?.due_date ?? new Date().toISOString().slice(0, 10);
      const items: AnticipatableItem[] = [];
      for (const plan of plans) {
        const detail = await fetchInstallmentPlan(plan.id);
        for (const inst of detail.installments) {
          if (inst.status === 'paid' || inst.anticipated_at) continue;
          if (inst.due_date <= cutoff) continue;
          items.push({
            installmentId: inst.id,
            planDescription: plan.description,
            number: inst.installment_number,
            total: plan.installments,
            amount: plan.installment_amount,
            dueDate: inst.due_date,
          });
        }
      }
      setAnticipatable(items);
    } catch {
      setAnticipateError(t('creditCards.failedLoadInstallments'));
    }
  };

  const handleAnticipate = async () => {
    if (!selected) return;
    if (checkedInstallments.length === 0) {
      setAnticipateError(t('creditCards.validation.installment'));
      return;
    }
    setAnticipateSaving(true);
    setAnticipateError(null);
    try {
      const res = await anticipateInstallments(selected.id, {
        installment_ids: checkedInstallments,
        discount_percent: discountPercent.trim() ? discountPercent.trim() : null,
      });
      setAnticipateOpen(false);
      await refreshCards();
      toast({
        title: t('creditCards.anticipated', {
          count: res.installments_anticipated,
          amount: formatMoney(res.discount_amount),
        }),
        variant: 'success',
      });
    } catch (err) {
      setAnticipateError(err instanceof Error ? err.message : t('creditCards.failedAnticipate'));
    } finally {
      setAnticipateSaving(false);
    }
  };

  const toggleInstallment = (id: string) => {
    setCheckedInstallments((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.creditCards')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('creditCards.loading')}</p>
        </div>
        {selected && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openPurchase}>
              <Plus className="h-4 w-4" />
              {t('creditCards.purchase')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openPay}
              disabled={!currentBill || currentBill.status === 'paid'}
            >
              <Wallet className="h-4 w-4" />
              {t('creditCards.payBill')}
            </Button>
            <Button size="sm" onClick={() => void openAnticipate()}>
              <CalendarClock className="h-4 w-4" />
              {t('creditCards.anticipateShort')}
            </Button>
          </div>
        )}
      </div>

      {/* How card expenses are dated in the dashboard, budgets and reports */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="h-4 w-4 text-primary" />
              {t('creditCards.dating.title')}
            </p>
            <p className="mt-1 text-xs text-dim">
              {settingsQuery.isError
                ? t('creditCards.dating.unavailable')
                : t('creditCards.dating.desc')}
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label={t('creditCards.dating.title')}
            className="flex shrink-0 gap-1 rounded-md bg-muted p-1"
          >
            {DATING_OPTIONS.map((option) => {
              const active = dating === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={settingsQuery.isLoading || settingsQuery.isError || savingDating}
                  onClick={() => void changeDating(option.value)}
                  title={t(option.hintKey)}
                  className={cn(
                    'rounded-sm px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    active
                      ? 'bg-surface text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {cardsQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-48 lg:col-span-2" />
        </div>
      ) : cards.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-medium">{t('creditCards.noTitle')}</p>
            <p className="max-w-md text-sm text-dim">{t('creditCards.noDesc')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Card list */}
          <div className="space-y-2">
            {cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => setSelectedId(card.id)}
                className={cn(
                  'w-full rounded-lg border p-4 text-left transition-colors',
                  selectedId === card.id
                    ? 'border-primary bg-accent'
                    : 'border-border bg-surface hover:bg-surface-hover',
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-expense/10 text-lg">
                    💳
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{card.name}</p>
                    <p className="text-xs text-dim">
                      {card.closing_day && card.due_day
                        ? `${t('accounts.form.closingDay')}: ${card.closing_day} · ${t('accounts.form.dueDay')}: ${card.due_day}`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-sm">
                  <span className="tabular-nums text-expense">{formatMoney(card.balance)}</span>
                  {card.credit_limit && (
                    <span className="text-xs text-dim">
                      {t('common.limit', { amount: formatMoney(card.credit_limit) })}
                    </span>
                  )}
                </div>
                {card.current_bill && card.current_bill.status === 'open' && (
                  <div className="mt-2 flex items-center justify-between rounded-md bg-muted/60 px-2 py-1.5 text-xs">
                    <span className="text-muted-foreground">{t('creditCards.currentBill')}</span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(card.current_bill.total_amount)}
                    </span>
                  </div>
                )}
              </button>
            ))}
          </div>


          {/* Billing cycles */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('creditCards.billingCycles')}</CardTitle>
                <CardDescription>
                  {selected ? t('accounts.detail.title', { name: selected.name }) : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {billsLoading ? (
                  <Skeleton className="h-32" />
                ) : bills.length === 0 ? (
                  <p className="py-8 text-center text-sm text-dim">{t('creditCards.noCycles')}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {bills.map((bill) => {
                      const open = bill.status === 'open';
                      return (
                        <li key={bill.id} className="flex flex-wrap items-center gap-3 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">
                              {t('creditCards.periodRange', {
                                start: formatDate(bill.period_start),
                                end: formatDate(bill.period_end),
                              })}
                            </p>
                            <p className="text-xs text-dim">
                              {t('common.due', { date: formatDate(bill.due_date) })} ·{' '}
                              {open ? t('common.open') : t('common.paid')}
                            </p>
                          </div>
                          <Badge variant={open ? 'warning' : 'income'}>
                            {open ? t('common.pending') : t('common.paid')}
                          </Badge>
                          <div className="text-right">
                            <p className="text-sm font-semibold tabular-nums">
                              {formatMoney(bill.total_amount)}
                            </p>
                            {open && (
                              <p className="text-xs text-dim">
                                {formatMoney(bill.remaining_amount)} {t('common.remaining')}
                              </p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}


      {/* Record purchase */}
      <Dialog open={purchaseOpen} onOpenChange={(next) => !purchaseSaving && setPurchaseOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('creditCards.purchaseModalTitle')}</DialogTitle>
            <DialogDescription>{selected?.name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {purchaseError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {purchaseError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="cc-desc">{t('common.description')}</Label>
              <Input
                id="cc-desc"
                value={purchaseDesc}
                onChange={(e) => setPurchaseDesc(e.target.value)}
                placeholder={t('creditCards.descPlaceholder')}
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cc-amount">{t('common.amount')}</Label>
                <Input
                  id="cc-amount"
                  inputMode="decimal"
                  value={purchaseAmount}
                  onChange={(e) => setPurchaseAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cc-date">{t('common.date')}</Label>
                <Input
                  id="cc-date"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-category">{t('common.category')}</Label>
              <select
                id="cc-category"
                className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={purchaseCategory}
                onChange={(e) => setPurchaseCategory(e.target.value)}
              >
                <option value="">— {t('common.none')} —</option>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurchaseOpen(false)} disabled={purchaseSaving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handlePurchase()} disabled={purchaseSaving}>
              {purchaseSaving ? t('common.saving') : t('creditCards.record')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay bill */}
      <Dialog open={payOpen} onOpenChange={(next) => !paySaving && setPayOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('creditCards.payModalTitle')}</DialogTitle>
            <DialogDescription>
              {currentBill
                ? t('creditCards.bill', { amount: formatMoney(currentBill.total_amount) })
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {payError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {payError}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">{t('creditCards.payAmountHint')}</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder={currentBill ? formatMoney(currentBill.remaining_amount) : '0.00'}
              />
            </div>
            {currentBill && (
              <p className="text-xs text-dim">
                {t('common.bill', { amount: formatMoney(currentBill.remaining_amount) })} ·{' '}
                {t('creditCards.currentOpenBill')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paySaving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void handlePay()} disabled={paySaving}>
              {paySaving ? t('common.saving') : t('creditCards.pay')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Anticipate installments */}
      <Dialog open={anticipateOpen} onOpenChange={(next) => !anticipateSaving && setAnticipateOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('creditCards.anticipateTitle')}</DialogTitle>
            <DialogDescription>{t('creditCards.anticipateDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {anticipateError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {anticipateError}
              </div>
            )}

            {anticipatable.length === 0 ? (
              <p className="py-6 text-center text-sm text-dim">
                {t('creditCards.noFutureInstallments')}
              </p>
            ) : (
              <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {anticipatable.map((item) => {
                  const checked = checkedInstallments.includes(item.installmentId);
                  return (
                    <button
                      key={item.installmentId}
                      type="button"
                      onClick={() => toggleInstallment(item.installmentId)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        checked
                          ? 'border-primary bg-accent'
                          : 'border-border bg-surface hover:bg-surface-hover',
                      )}
                    >
                      <CheckSquare className={cn('h-4 w-4 shrink-0', checked ? 'text-primary' : 'text-dim')} />
                      <span className="min-w-0 flex-1 truncate">
                        {t('creditCards.installmentItem', {
                          number: item.number,
                          total: item.total,
                          description: item.planDescription,
                        })}
                      </span>
                      <span className="shrink-0 text-xs text-dim">{formatDate(item.dueDate)}</span>
                      <span className="shrink-0 font-medium tabular-nums">{formatMoney(item.amount)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="discount-pct">{t('creditCards.discountLabel')}</Label>
              <Input
                id="discount-pct"
                type="number"
                min={0}
                max={100}
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAnticipateOpen(false)}
              disabled={anticipateSaving}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void handleAnticipate()}
              disabled={anticipateSaving || anticipatable.length === 0}
            >
              {anticipateSaving ? t('common.saving') : t('creditCards.anticipateShort')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

