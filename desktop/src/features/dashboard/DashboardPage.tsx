import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/app/auth';
import { useI18n } from '@/app/i18n';
import {
  fetchAccountsWithBalance,
  fetchBudgetSummary,
  fetchCategories,
  fetchCashFlow,
  fetchMonthlyReport,
  fetchSummary,
  fetchTransactions,
} from '@/lib/api';
import { toIntlLocale } from '@shared/i18n';
import { DashboardHeader } from './DashboardHeader';
import { SummaryCards, type SummaryDeltas } from './SummaryCards';
import { CashFlowCard, type CashFlowPoint, type CashFlowRange } from './CashFlowCard';
import { CategoryBreakdownCard } from './CategoryBreakdownCard';
import { RecentTransactionsCard } from './RecentTransactionsCard';
import { BudgetsCard } from './BudgetsCard';
import { QuickActions } from './QuickActions';

/** Shift a `{ year, month }` pair by `delta` months (month is 1-12). */
function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  let m = month + delta;
  let y = year;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  return { year: y, month: m };
}

/**
 * Personal-finance dashboard: the month's headline numbers, cash-flow trend,
 * category breakdown, recent activity, budgets and shortcuts into real flows.
 *
 * Every value comes from the existing APIs — the selected month drives the
 * summary, budgets, categories and activity. The cash-flow chart changes its
 * server-side aggregation based on the selected window.
 */
export function DashboardPage() {
  const { t, locale, shortMonthNames } = useI18n();
  const { user } = useAuth();

  const now = React.useMemo(() => new Date(), []);
  const [year, setYear] = React.useState(now.getFullYear());
  const [month, setMonth] = React.useState(now.getMonth() + 1);
  const [range, setRange] = React.useState<CashFlowRange>(6);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const prevMonth = () => {
    const next = shiftMonth(year, month, -1);
    setYear(next.year);
    setMonth(next.month);
  };
  const nextMonth = () => {
    if (isCurrentMonth) return;
    const next = shiftMonth(year, month, 1);
    setYear(next.year);
    setMonth(next.month);
  };
  const goCurrentMonth = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  };


  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const summaryQuery = useQuery({
    queryKey: ['summary', year, month],
    queryFn: () => fetchSummary({ month, year }),
  });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetchAccountsWithBalance(),
  });
  const budgetsQuery = useQuery({
    queryKey: ['budget-summary', year, month],
    queryFn: () => fetchBudgetSummary(year, month),
  });
  const recentQuery = useQuery({
    queryKey: ['transactions', 'recent', year, month],
    queryFn: () =>
      fetchTransactions({
        page: 0,
        page_size: 8,
        start_date: monthStart,
        end_date: monthEnd,
      }),
  });

  const previousMonth = shiftMonth(year, month, -1);
  const comparisonQuery = useQuery({
    queryKey: ['dashboard-cash-flow-comparison', previousMonth.year, previousMonth.month, year, month],
    queryFn: () => fetchMonthlyReport(previousMonth.year, previousMonth.month, year, month),
  });
  const cashFlowWindow = React.useMemo(() => {
    const startPeriod = range === 1 ? shiftMonth(year, month, 0) : shiftMonth(year, month, -(range - 1));
    const startDate = `${startPeriod.year}-${String(startPeriod.month).padStart(2, '0')}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    return {
      startDate,
      endDate,
      granularity: range === 1 ? ('day' as const) : range === 3 ? ('week' as const) : ('month' as const),
    };
  }, [year, month, range]);
  const cashFlowQuery = useQuery({
    queryKey: ['dashboard-cash-flow', cashFlowWindow],
    queryFn: () =>
      fetchCashFlow(cashFlowWindow.startDate, cashFlowWindow.endDate, cashFlowWindow.granularity),
  });

  const summary = summaryQuery.data;
  // Memoized so the derived maps/arrays below keep stable identities.
  const accounts = React.useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const categories = React.useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const cashFlowMonths = React.useMemo(() => comparisonQuery.data?.months ?? [], [comparisonQuery.data]);

  const income = parseFloat(summary?.income_total ?? '0');
  const expenses = parseFloat(summary?.expense_total ?? '0');
  const net = income - expenses;
  const savingsRate = income > 0 ? (net / income) * 100 : null;

  const accountById = React.useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const categoryById = React.useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const cardsLoading = summaryQuery.isLoading || accountsQuery.isLoading;
  const recentLoading =
    recentQuery.isLoading || categoriesQuery.isLoading || accountsQuery.isLoading;

  // Real month-over-month comparisons derived from the monthly report. A missing
  // previous month (or a zero baseline) yields `null`, and the card then shows
  // its caption instead of a made-up percentage.
  const previousPeriod = React.useMemo(() => shiftMonth(year, month, -1), [year, month]);
  const deltas: SummaryDeltas = React.useMemo(() => {
    const previous = cashFlowMonths.find(
      (entry) => entry.year === previousPeriod.year && entry.month === previousPeriod.month,
    );
    if (!previous) return { income: null, expenses: null, savings: null };

    const change = (current: number, base: number): number | null =>
      base === 0 ? null : ((current - base) / Math.abs(base)) * 100;

    const previousIncome = parseFloat(previous.income_total);
    const previousExpenses = parseFloat(previous.expense_total);
    const previousRate =
      previousIncome > 0 ? ((previousIncome - previousExpenses) / previousIncome) * 100 : null;

    return {
      income: change(income, previousIncome),
      expenses: change(expenses, previousExpenses),
      savings: savingsRate !== null && previousRate !== null ? savingsRate - previousRate : null,
    };
  }, [cashFlowMonths, previousPeriod, income, expenses, savingsRate]);

  // Format the server-provided period starts for the selected chart resolution.
  const cashFlowSeries: CashFlowPoint[] = React.useMemo(() => {
    const intl = toIntlLocale(locale);
    return (cashFlowQuery.data?.points ?? []).map((point) => {
      const date = new Date(`${point.period_start}T00:00:00`);
      const label =
        range === 1
          ? date.toLocaleDateString(intl, { day: 'numeric', month: 'short' })
          : range === 3
            ? `${shortMonthNames[date.getMonth()]} ${date.getDate()}`
            : `${shortMonthNames[date.getMonth()]} '${String(date.getFullYear()).slice(2)}`;
      return {
        label,
        income: parseFloat(point.income_total),
        expenses: parseFloat(point.expense_total),
        net: parseFloat(point.balance),
      };
    });
  }, [cashFlowQuery.data, locale, range, shortMonthNames]);

  const greeting = React.useMemo(() => {
    const handle = user?.email?.split('@')[0] ?? '';
    const name = handle ? handle.charAt(0).toUpperCase() + handle.slice(1) : t('nav.dashboard');
    const hour = now.getHours();
    const key =
      hour < 12
        ? 'dashboard.greetingMorning'
        : hour < 18
          ? 'dashboard.greetingAfternoon'
          : 'dashboard.greetingEvening';
    return t(key, { name });
  }, [user?.email, now, t]);

  const periodQuery = `month=${month}&year=${year}`;
  const viewAllBudgets = `/budgets?${periodQuery}`;
  const newBudgetLink = `/budgets?${periodQuery}&add=1`;

  return (
    <div className="flex flex-col gap-4">
      {/* Extra 8px so the header sits 24px above the summary row. */}
      <div className="order-1 pb-2">
        <DashboardHeader
          year={year}
          month={month}
          isCurrentMonth={isCurrentMonth}
          greeting={greeting}
          onPrev={prevMonth}
          onNext={nextMonth}
          onCurrentMonth={goCurrentMonth}
        />
      </div>

      <div className="order-2">
        <SummaryCards
          loading={cardsLoading}
          available={summary !== undefined}
          net={net}
          income={income}
          expenses={expenses}
          savingsRate={savingsRate}
          deltas={deltas}
        />
      </div>

      {/* Phones surface activity and budgets before the charts. */}
      <div className="order-3 grid gap-4 md:order-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <RecentTransactionsCard
          transactions={recentQuery.data?.items ?? []}
          categoryById={categoryById}
          accountById={accountById}
          loading={recentLoading}
        />
        <div className="flex flex-col gap-4">
          <BudgetsCard
            items={budgetsQuery.data?.items ?? []}
            loading={budgetsQuery.isLoading}
            month={month}
            year={year}
            viewAllLink={viewAllBudgets}
          />
          <QuickActions newBudgetLink={newBudgetLink} />
        </div>
      </div>

      <div className="order-4 grid gap-4 md:order-3 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <CashFlowCard
          data={cashFlowSeries}
          loading={cashFlowQuery.isLoading}
          range={range}
          onRangeChange={setRange}
        />
        <CategoryBreakdownCard
          items={summary?.by_category ?? []}
          total={expenses}
          loading={summaryQuery.isLoading}
        />
      </div>
    </div>
  );
}

