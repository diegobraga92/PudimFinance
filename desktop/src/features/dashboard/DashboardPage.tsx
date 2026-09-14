import * as React from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/app/auth';
import { useI18n } from '@/app/i18n';
import {
  fetchAccountsWithBalance,
  fetchBudgetSummary,
  fetchCategories,
  fetchMonthlyReport,
  fetchSummary,
  fetchTransactions,
} from '@/lib/api';
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
 * summary, budgets, categories and activity; the cash-flow window ends on the
 * selected month and reaches back one extra month for the comparisons.
 */
export function DashboardPage() {
  const { t, shortMonthNames } = useI18n();
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

  // One extra month of history so the summary cards can compare with the
  // previous month without an additional request.
  const flowStart = React.useMemo(
    () => shiftMonth(year, month, -(range + 1)),
    [year, month, range],
  );
  const cashFlowQuery = useQuery({
    queryKey: ['dashboard-cash-flow', flowStart.year, flowStart.month, year, month],
    queryFn: () => fetchMonthlyReport(flowStart.year, flowStart.month, year, month),
  });

  const summary = summaryQuery.data;
  // Memoized so the derived maps/arrays below keep stable identities.
  const accounts = React.useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const categories = React.useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const cashFlowMonths = React.useMemo(
    () => cashFlowQuery.data?.months ?? [],
    [cashFlowQuery.data],
  );

  const income = parseFloat(summary?.income_total ?? '0');
  const expenses = parseFloat(summary?.expense_total ?? '0');
  const net = income - expenses;
  const savingsRate = income > 0 ? (net / income) * 100 : null;

  const totalAssets = accounts
    .filter((account) => account.type === 'asset')
    .reduce((sum, account) => sum + parseFloat(account.balance), 0);

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

  // Exactly `range` points ending on the selected month; months the report omits
  // are rendered as zero so the x axis stays continuous.
  const cashFlowSeries: CashFlowPoint[] = React.useMemo(() => {
    const byPeriod = new Map(cashFlowMonths.map((entry) => [`${entry.year}-${entry.month}`, entry]));
    const points: CashFlowPoint[] = [];
    for (let offset = range - 1; offset >= 0; offset -= 1) {
      const period = shiftMonth(year, month, -offset);
      const entry = byPeriod.get(`${period.year}-${period.month}`);
      points.push({
        label: `${shortMonthNames[period.month - 1]} '${String(period.year).slice(2)}`,
        income: entry ? parseFloat(entry.income_total) : 0,
        expenses: entry ? parseFloat(entry.expense_total) : 0,
        net: entry ? parseFloat(entry.balance) : 0,
      });
    }
    return points;
  }, [cashFlowMonths, year, month, range, shortMonthNames]);

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
          balance={totalAssets}
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

