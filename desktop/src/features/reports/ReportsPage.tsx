import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useI18n } from '@/app/i18n';
import {
  fetchCategoryBreakdown,
  fetchMonthlyReport,
  fetchTrends,
} from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { resolveCategoryColors } from '@/lib/category-colors';
import { CategoryIcon } from '@/components/CategoryIcon';
import { cn } from '@/lib/utils';
import { rowInteractiveClass, tapClass } from '@/lib/interactive';
import { transactionsLink } from '@/lib/links';
import { chartPointAtIndex, useChartTooltipTrigger } from '@/lib/chart-events';

type ReportTab = 'overview' | 'breakdown' | 'trends';

export function ReportsPage() {
  const { t, formatMoney, shortMonthNames } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tooltipTrigger = useChartTooltipTrigger();
  const rawTab = searchParams.get('tab');
  const tab: ReportTab = rawTab === 'breakdown' || rawTab === 'trends' ? rawTab : 'overview';
  const selectedCategory = searchParams.get('category');
  const [trendMonths, setTrendMonths] = React.useState(6);

  const now = React.useMemo(() => new Date(), []);

  const overviewRange = React.useMemo(() => {
    const endMonth = now.getMonth() + 1;
    const endYear = now.getFullYear();
    let startMonth = endMonth - 5;
    let startYear = endYear;
    if (startMonth <= 0) {
      startYear -= 1;
      startMonth += 12;
    }
    return { startYear, startMonth, endYear, endMonth };
  }, [now]);

  const breakdownRange = React.useMemo(() => {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    return { firstDay, today };
  }, [now]);

  const overviewQuery = useQuery({
    queryKey: ['report-overview', overviewRange],
    queryFn: () =>
      fetchMonthlyReport(
        overviewRange.startYear,
        overviewRange.startMonth,
        overviewRange.endYear,
        overviewRange.endMonth,
      ),
  });
  const breakdownQuery = useQuery({
    queryKey: ['report-breakdown', breakdownRange],
    queryFn: () => fetchCategoryBreakdown(breakdownRange.firstDay, breakdownRange.today),
  });
  const trendsQuery = useQuery({
    queryKey: ['report-trends', trendMonths],
    queryFn: () => fetchTrends(trendMonths),
  });

  const overviewData = React.useMemo(() => {
    const months = overviewQuery.data?.months ?? [];
    return months.map((m) => ({
      ...m,
      label: `${shortMonthNames[m.month - 1]} '${String(m.year).slice(2)}`,
    }));
  }, [overviewQuery.data, shortMonthNames]);

  const totals = React.useMemo(() => {
    const months = overviewQuery.data?.months ?? [];
    return {
      income: months.reduce((sum, m) => sum + parseFloat(m.income_total), 0),
      expenses: months.reduce((sum, m) => sum + parseFloat(m.expense_total), 0),
      net: months.reduce((sum, m) => sum + parseFloat(m.balance), 0),
    };
  }, [overviewQuery.data]);

  const breakdownData = React.useMemo(
    () => breakdownQuery.data?.categories ?? [],
    [breakdownQuery.data],
  );
  const breakdownColors = React.useMemo(
    () =>
      resolveCategoryColors(
        breakdownData.map((category, index) => ({
          key: category.category_id ?? `uncategorised-${index}`,
          color: category.color,
        })),
      ),
    [breakdownData],
  );

  const trendsData = React.useMemo(
    () =>
      (trendsQuery.data?.trends ?? []).map((t) => ({
        ...t,
        label: t.month_label,
      })),
    [trendsQuery.data],
  );

  const setReportTab = (next: ReportTab) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const openCategoryTransactions = (categoryId: string | null | undefined) => {
    if (!categoryId) return;
    navigate(
      transactionsLink({
        categoryId,
        startDate: breakdownRange.firstDay,
        endDate: breakdownRange.today,
      }),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('nav.reports')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('reports.currentMonth')}</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setReportTab(v as ReportTab)}>
        <TabsList className="h-auto min-h-11 md:h-9 md:min-h-0">
          <TabsTrigger className="min-h-9 md:min-h-0" value="overview">{t('reports.overview')}</TabsTrigger>
          <TabsTrigger className="min-h-9 md:min-h-0" value="breakdown">{t('reports.breakdown')}</TabsTrigger>
          <TabsTrigger className="min-h-9 md:min-h-0" value="trends">{t('reports.trends')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Link to={transactionsLink({ type: 'income' })} className="card-surface block p-4 transition-colors hover:bg-surface-hover/60 active:bg-surface-hover">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('reports.totalIncome')}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-income">{formatMoney(totals.income)}</p>
            </Link>
            <Link to={transactionsLink({ type: 'expense' })} className="card-surface block p-4 transition-colors hover:bg-surface-hover/60 active:bg-surface-hover">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('reports.totalExpenses')}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-expense">{formatMoney(totals.expenses)}</p>
            </Link>
            <Link to={transactionsLink()} className="card-surface block p-4 transition-colors hover:bg-surface-hover/60 active:bg-surface-hover">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('reports.net')}</p>
              <p className={cn('mt-1 text-lg font-semibold tabular-nums', totals.net >= 0 ? 'text-income' : 'text-expense')}>
                {formatMoney(totals.net)}
              </p>
            </Link>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('reports.incomeVsExpenses')}</CardTitle>
              <CardDescription>
                {`${shortMonthNames[overviewRange.startMonth - 1]} '${String(overviewRange.startYear).slice(2)} – ${shortMonthNames[overviewRange.endMonth - 1]} '${String(overviewRange.endYear).slice(2)}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overviewQuery.isLoading ? (
                <Skeleton className="h-72" />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={overviewData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgb(var(--surface-elevated))',
                          border: '1px solid rgb(var(--border))',
                          borderRadius: '0.5rem',
                          fontSize: '0.875rem',
                        }}
                        formatter={(value) => formatMoney(Number(value))}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="income_total" name={t('reports.income')} stroke="rgb(var(--income))" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="expense_total" name={t('reports.expenses')} stroke="rgb(var(--expense))" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}


      {tab === 'breakdown' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.spendingByCategory')}</CardTitle>
              <CardDescription>{t('reports.categorySpending')}</CardDescription>
            </CardHeader>
            <CardContent>
              {breakdownQuery.isLoading ? (
                <Skeleton className="h-72" />
              ) : breakdownData.length === 0 ? (
                <p className="py-16 text-center text-sm text-dim">{t('reports.noExpensesMonth')}</p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={breakdownData}
                        dataKey="total"
                        nameKey="category_name"
                        innerRadius={55}
                        outerRadius={100}
                        paddingAngle={2}
                        className="cursor-pointer"
                        onClick={(sector) => openCategoryTransactions(String(sector.payload?.category_id ?? ''))}
                        activeShape={{ outerRadius: 104 }}
                      >
                        {breakdownData.map((category, i) => (
                          <Cell
                            key={category.category_id ?? `uncategorised-${i}`}
                            fill={breakdownColors.get(category.category_id ?? `uncategorised-${i}`)}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [formatMoney(Number(value)), String(name)]}
                        contentStyle={{
                          backgroundColor: 'rgb(var(--surface-elevated))',
                          border: '1px solid rgb(var(--border))',
                          borderRadius: '0.5rem',
                          fontSize: '0.875rem',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('reports.detailedBreakdown')}</CardTitle>
            </CardHeader>
            <CardContent>
              {breakdownData.length === 0 ? (
                <p className="py-8 text-center text-sm text-dim">{t('reports.noExpensesMonth')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {breakdownData.map((cat, i) => (
                    <li
                      key={cat.category_id ?? `uncat-${i}`}
                      className={cn(
                        'flex min-h-11 items-center text-sm',
                        selectedCategory === cat.category_id && 'rounded-md bg-primary/10',
                      )}
                    >
                      {cat.category_id ? (
                        <button
                          type="button"
                          onClick={() => openCategoryTransactions(cat.category_id)}
                          className={cn('flex w-full items-center gap-3 rounded-sm px-2 py-1 text-left', rowInteractiveClass, tapClass)}
                        >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{
                          backgroundColor: breakdownColors.get(cat.category_id ?? `uncategorised-${i}`),
                        }}
                      />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                        <CategoryIcon name={cat.icon} className="h-3.5 w-3.5" />
                        {cat.category_name ?? t('common.uncategorised')}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {cat.transaction_count} {t('common.entries')}
                      </span>
                      <span className="w-24 text-right font-medium tabular-nums">
                        {formatMoney(cat.total)}
                      </span>
                      <span className="w-14 text-right text-xs text-dim">
                        {Math.round(parseFloat(cat.percentage))}%
                      </span>
                        </button>
                      ) : (
                        <>
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: breakdownColors.get(`uncategorised-${i}`) }}
                          />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                            <CategoryIcon name={cat.icon} className="h-3.5 w-3.5" />
                            {cat.category_name ?? t('common.uncategorised')}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {cat.transaction_count} {t('common.entries')}
                          </span>
                          <span className="w-24 text-right font-medium tabular-nums">{formatMoney(cat.total)}</span>
                          <span className="w-14 text-right text-xs text-dim">{Math.round(parseFloat(cat.percentage))}%</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}


      {tab === 'trends' && (
        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle>{t('reports.monthlyTrends')}</CardTitle>
              <CardDescription>{t('reports.lastMonths', { count: trendMonths })}</CardDescription>
            </div>
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {[6, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTrendMonths(n)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    trendMonths === n ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground active:bg-surface-hover',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {trendsQuery.isLoading ? (
              <Skeleton className="h-72" />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={trendsData}
                    margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
                    onClick={(state) => {
                      const point = chartPointAtIndex(state, trendsData);
                      if (!point?.month || !point.year) return;
                      const startDate = `${point.year}-${String(point.month).padStart(2, '0')}-01`;
                      const endDate = new Date(point.year, point.month, 0).toISOString().slice(0, 10);
                      navigate(transactionsLink({ startDate, endDate }));
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      trigger={tooltipTrigger}
                      formatter={(value) => formatMoney(Number(value))}
                      contentStyle={{
                        backgroundColor: 'rgb(var(--surface-elevated))',
                        border: '1px solid rgb(var(--border))',
                        borderRadius: '0.5rem',
                        fontSize: '0.875rem',
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="income_total" name={t('reports.income')} stroke="rgb(var(--income))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="expense_total" name={t('reports.expenses')} stroke="rgb(var(--expense))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="net" name={t('reports.net')} stroke="rgb(var(--info))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

