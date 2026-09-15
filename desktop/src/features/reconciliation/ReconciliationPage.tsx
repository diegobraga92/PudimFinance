import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  Plus,
  RefreshCw,
  Upload,
} from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import {
  fetchReconciliationHistory,
  fetchTransaction,
  uploadReconciliation,
  uploadReconciliationFile,
  type ReconciliationHistoryItem,
  type ReconciliationUploadResponse,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/EmptyState';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ToolsWorkspace } from '@/features/tools/ToolsWorkspace';

interface CsvRow {
  date: string;
  description: string;
  amount: string;
}

/** One statement row of a reconciliation result. */
type ReconRow = ReconciliationUploadResponse['items'][number];

/** Parses a pasted `date,description,amount` CSV (quoted fields supported). */
function parseCsv(text: string): CsvRow[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const rows: CsvRow[] = [];
  for (const line of lines) {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ',' && !inQuotes) {
        parts.push(current);
        current = '';
      } else current += ch;
    }
    parts.push(current);
    if (parts.length >= 3) {
      rows.push({
        date: parts[0].trim(),
        description: parts[1].trim(),
        amount: parts[2].trim(),
      });
    }
  }
  return rows;
}

const DROP_ZONE =
  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-surface-hover/20 px-6 py-8 text-center transition-colors hover:border-primary hover:bg-primary/[0.04]';

/**
 * Reconciliation: import a bank statement and see what matched.
 *
 * The upload flow, the CSV-paste fallback, the auto-create option, the results
 * and the history are the existing behaviour — this screen just makes the
 * workflow (import → match → review) obvious.
 */
export function ReconciliationPage() {
  const { t, formatMoney, formatDate, formatDateTime } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [statementName, setStatementName] = React.useState('');
  const [autoCreate, setAutoCreate] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [rawCsv, setRawCsv] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ReconciliationUploadResponse | null>(null);
  const [createdRows, setCreatedRows] = React.useState(0);
  const [unmatchedOnly, setUnmatchedOnly] = React.useState(false);
  const [showAllHistory, setShowAllHistory] = React.useState(false);
  const [viewing, setViewing] = React.useState<ReconciliationHistoryItem | null>(null);
  const [matchedTransaction, setMatchedTransaction] = React.useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ['reconciliation-history'],
    queryFn: () => fetchReconciliationHistory(),
  });
  const transactionQuery = useQuery({
    queryKey: ['transaction', matchedTransaction],
    queryFn: () => fetchTransaction(matchedTransaction ?? ''),
    enabled: Boolean(matchedTransaction),
  });

  const history = historyQuery.data?.items ?? [];
  const visibleHistory = showAllHistory ? history : history.slice(0, 4);
  const rows = result?.items ?? [];
  const unmatched = rows.filter((row) => row.match_status !== 'matched');
  const shownRows = unmatchedOnly ? unmatched : rows;
  /** Phone wizard: 1 upload, 2 match, 3 review. */
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const matchedPercent =
    result && result.total_rows > 0
      ? Math.round((result.matched_rows / result.total_rows) * 100)
      : 0;

  /** Stores the result and refreshes everything the import touched. */
  const finish = async (res: ReconciliationUploadResponse, autoCreated: boolean) => {
    setResult(res);
    setUnmatchedOnly(false);
    setCreatedRows(autoCreated ? res.unmatched_rows : 0);
    setStep(2);
    await queryClient.invalidateQueries({ queryKey: ['reconciliation-history'] });
    await queryClient.invalidateQueries({ queryKey: ['transactions'] });
    toast({
      title: t('recon.done', { matched: res.matched_rows, unmatched: res.unmatched_rows }),
      variant: 'success',
    });
  };

  const runFileUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadReconciliationFile(file, {
        statementName: statementName.trim() || undefined,
        autoCreateUnmatched: autoCreate,
      });
      setFile(null);
      await finish(res, autoCreate);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('recon.failedFile'));
    } finally {
      setUploading(false);
    }
  };

  const runPasteUpload = async () => {
    const parsed = parseCsv(rawCsv);
    if (parsed.length === 0) {
      setError(t('recon.validation.empty'));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await uploadReconciliation({
        statement_name: statementName.trim() || t('recon.bankStatement'),
        lines: parsed,
        auto_create_unmatched: autoCreate,
      });
      setRawCsv('');
      await finish(res, autoCreate);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('recon.failedUpload'));
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    setError(null);
    setFile(event.dataTransfer.files?.[0] ?? null);
  };


  return (
    <ToolsWorkspace>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-md:hidden">
            <h2 className="text-xl font-semibold">{t('recon.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('recon.subtitle')}</p>
          </div>
          <p className="text-sm text-muted-foreground md:hidden">{t('recon.subtitle')}</p>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => void historyQuery.refetch()}
            disabled={historyQuery.isFetching}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('common.retry')}
          </Button>
        </div>

        <ReconStepper step={step} hasResult={Boolean(result)} onSelect={setStep} />

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className={cn('border-border bg-surface shadow-card', step !== 1 && 'max-md:hidden')}>
            <CardContent className="space-y-4 p-5">
              <div>
                <h3 className="text-lg font-semibold">{t('recon.uploadTitle')}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{t('recon.uploadBlurb')}</p>
              </div>

              <div
                className={cn(DROP_ZONE, dragging && 'border-primary bg-primary/[0.06]')}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
                }}
                aria-label={t('recon.dropLabel')}
              >
                <FileText className="h-7 w-7 text-primary" aria-hidden="true" />
                <p className="text-sm font-medium">{t('recon.dropTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('recon.dropHint')}</p>
                <p className="text-xs text-dim">{t('recon.dropFormats')}</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.ofx"
                className="hidden"
                onChange={(event) => {
                  setError(null);
                  setFile(event.target.files?.[0] ?? null);
                }}
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  {t('recon.chooseFile')}
                </Button>
                {file && (
                  <span className="min-w-0 truncate text-xs text-dim">
                    {t('recon.selected', { name: file.name, size: file.size })}
                  </span>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="recon-name">{t('recon.statementName')}</Label>
                <Input
                  id="recon-name"
                  value={statementName}
                  onChange={(event) => setStatementName(event.target.value)}
                  placeholder={t('recon.statementNamePlaceholder')}
                />
              </div>

              <div className="flex items-start gap-2">
                <input
                  id="recon-auto"
                  type="checkbox"
                  checked={autoCreate}
                  onChange={(event) => setAutoCreate(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <div className="min-w-0">
                  <label
                    htmlFor="recon-auto"
                    className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground"
                  >
                    {t('recon.autoCreateShort')}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex text-dim" aria-label={t('recon.autoCreateHint')}>
                          <Info className="h-3.5 w-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {t('recon.autoCreateHint')}
                      </TooltipContent>
                    </Tooltip>
                  </label>
                  <p className="mt-0.5 text-xs text-dim">{t('recon.autoCreateHelp')}</p>
                </div>
              </div>

              <Button
                className="min-h-[44px] w-full gap-2"
                onClick={() => void runFileUpload()}
                disabled={!file || uploading}
              >
                <Upload className="h-4 w-4" />
                {uploading ? t('recon.reconciling') : t('recon.uploadReconcile')}
              </Button>

              {/* Manual CSV paste stays available, tucked behind a toggle. */}
              <div className="border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setPasteOpen((open) => !open)}
                  className="text-xs font-medium text-primary hover:underline"
                  aria-expanded={pasteOpen}
                >
                  {pasteOpen ? t('recon.hidePaste') : t('recon.showPaste')}
                </button>
                {pasteOpen && (
                  <div className="mt-3 space-y-3">
                    <Textarea
                      value={rawCsv}
                      onChange={(event) => setRawCsv(event.target.value)}
                      placeholder={t('recon.csvPlaceholder')}
                      className="min-h-[7rem] font-mono text-xs"
                      aria-label={t('recon.csvData')}
                    />
                    <Button
                      variant="outline"
                      onClick={() => void runPasteUpload()}
                      disabled={!rawCsv.trim() || uploading}
                    >
                      {uploading ? t('recon.reconciling') : t('recon.reconcilePasted')}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <Card className={cn('border-border bg-surface shadow-card', step !== 1 && 'max-md:hidden')}>
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{t('recon.recentTitle')}</h3>
                {history.length > visibleHistory.length && (
                  <button
                    type="button"
                    onClick={() => setShowAllHistory(true)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {t('receipts.viewAll')}
                  </button>
                )}
              </div>

              {historyQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : history.length === 0 ? (
                <div className="py-4">
                  <EmptyState
                    icon={<FileText className="h-7 w-7" />}
                    title={t('recon.emptyTitle')}
                    description={t('recon.emptyDesc')}
                  />
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {visibleHistory.map((item) => {
                    const pending = item.unmatched_rows;
                    return (
                      <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
                        <span className="w-24 shrink-0 text-muted-foreground">
                          {formatDate(item.uploaded_at.slice(0, 10))}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {item.statement_name}
                        </span>
                        <span className="shrink-0 text-xs text-dim">
                          {t('recon.importedShort', { count: item.total_rows })}
                        </span>
                        <span className="w-8 shrink-0 text-right tabular-nums text-success">
                          {item.matched_rows}
                        </span>
                        <span
                          className={cn(
                            'w-28 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-medium',
                            pending === 0
                              ? 'bg-success/10 text-success'
                              : 'bg-warning/10 text-warning',
                          )}
                        >
                          {pending === 0
                            ? t('recon.statusCompleted')
                            : t('recon.statusReview', { count: pending })}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => setViewing(item)}>
                          {pending === 0 ? t('common.view') : t('recon.review')}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        {result && (
          <Card
            className={cn(
              'border-border bg-surface shadow-card',
              step === 1 && 'max-md:hidden',
            )}
          >
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">{t('recon.summaryTitle')}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {statementName.trim() || t('recon.bankStatement')}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-primary">
                  {matchedPercent}%
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <ReconStat
                  icon={<FileText className="h-4 w-4" />}
                  tone="bg-info/15 text-info"
                  label={t('recon.statImported')}
                  value={result.total_rows}
                />
                <ReconStat
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  tone="bg-success/15 text-success"
                  label={t('recon.statMatched')}
                  value={result.matched_rows}
                />
                <ReconStat
                  icon={<AlertTriangle className="h-4 w-4" />}
                  tone="bg-warning/15 text-warning"
                  label={t('recon.statReview')}
                  value={result.unmatched_rows}
                />
                <ReconStat
                  icon={<Plus className="h-4 w-4" />}
                  tone="bg-success/15 text-success"
                  label={t('recon.statCreated')}
                  value={createdRows}
                />
              </div>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t('recon.matchedOf', { matched: result.matched_rows, total: result.total_rows })}
                </p>
                <Progress value={matchedPercent} className="h-2" indicatorClassName="bg-success" />
              </div>

              {result.unmatched_rows > 0 && (
                <Button variant="outline" className="gap-1.5" onClick={() => setUnmatchedOnly(true)}>
                  {t('recon.reviewUnmatched', { count: result.unmatched_rows })}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {result && (
          <Card
            className={cn(
              'border-border bg-surface shadow-card',
              step === 1 && 'max-md:hidden',
            )}
          >
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">
                    {unmatchedOnly ? t('recon.unmatchedTitle') : t('recon.rowsTitle')}
                  </h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">{t('recon.rowsBlurb')}</p>
                </div>
                <div className="flex gap-1 rounded-md bg-muted p-1" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!unmatchedOnly}
                    onClick={() => setUnmatchedOnly(false)}
                    className={cn(
                      'rounded-sm px-3 py-1 text-xs font-medium transition-colors',
                      !unmatchedOnly
                        ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t('recon.filterAll', { count: rows.length })}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={unmatchedOnly}
                    onClick={() => setUnmatchedOnly(true)}
                    className={cn(
                      'rounded-sm px-3 py-1 text-xs font-medium transition-colors',
                      unmatchedOnly
                        ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t('recon.filterUnmatched', { count: unmatched.length })}
                  </button>
                </div>
              </div>

              {shownRows.length === 0 ? (
                <p className="py-4 text-center text-sm text-dim">{t('recon.noUnmatched')}</p>
              ) : (
                <>
                  <ReconRowsTable
                    rows={shownRows}
                    onViewTransaction={setMatchedTransaction}
                    className="hidden md:block"
                  />

                  <ul className="space-y-2 md:hidden">
                    {shownRows.map((row) => {
                      const isMatched = row.match_status === 'matched';
                      return (
                        <li
                          key={row.id}
                          className="rounded-md border border-border bg-surface-elevated/40 p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {row.statement_description}
                              </span>
                              <span className="mt-0.5 block text-xs text-dim">
                                {row.statement_date ? formatDate(row.statement_date) : '—'}
                              </span>
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums">
                              {row.statement_amount ? formatMoney(row.statement_amount) : '—'}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                  isMatched
                                    ? 'bg-success/10 text-success'
                                    : 'bg-warning/10 text-warning',
                                )}
                              >
                                {isMatched ? t('recon.matched') : t('recon.unmatched')}
                              </span>
                              {row.confidence && (
                                <span className="text-xs tabular-nums text-dim">
                                  {Math.round(Number(row.confidence))}%
                                </span>
                              )}
                            </span>
                            {row.matched_transaction_id ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setMatchedTransaction(row.matched_transaction_id ?? '')}
                              >
                                {t('common.view')}
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" asChild>
                                <a href="/transactions?add=1">{t('recon.addManually')}</a>
                              </Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {/* Phone wizard navigation */}
              <div className="flex gap-2 pt-1 md:hidden">
                {step === 2 ? (
                  <Button className="flex-1" onClick={() => setStep(3)}>
                    {t('recon.continueToReview')}
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                      {t('common.back')}
                    </Button>
                    <Button className="flex-1" onClick={() => setStep(1)}>
                      {t('recon.reviewDone')}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{viewing?.statement_name}</DialogTitle>
              <DialogDescription>
                {viewing ? formatDateTime(viewing.uploaded_at) : ''}
              </DialogDescription>
            </DialogHeader>
            {viewing && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <ReconStat
                    icon={<FileText className="h-4 w-4" />}
                    tone="bg-info/15 text-info"
                    label={t('recon.statImported')}
                    value={viewing.total_rows}
                  />
                  <ReconStat
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    tone="bg-success/15 text-success"
                    label={t('recon.statMatched')}
                    value={viewing.matched_rows}
                  />
                  <ReconStat
                    icon={<AlertTriangle className="h-4 w-4" />}
                    tone="bg-warning/15 text-warning"
                    label={t('recon.statReview')}
                    value={viewing.unmatched_rows}
                  />
                </div>
                <Progress
                  value={
                    viewing.total_rows > 0
                      ? Math.round((viewing.matched_rows / viewing.total_rows) * 100)
                      : 0
                  }
                  className="h-2"
                  indicatorClassName="bg-success"
                />
                <p className="text-xs text-dim">{t('recon.historyDetailHint')}</p>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={matchedTransaction !== null}
          onOpenChange={(open) => !open && setMatchedTransaction(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('recon.matchedTransaction')}</DialogTitle>
              <DialogDescription>{t('recon.matchedTransactionHint')}</DialogDescription>
            </DialogHeader>
            {transactionQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : transactionQuery.isError ? (
              <p className="text-sm text-destructive" role="alert">
                {t('recon.matchedTransactionMissing')}
              </p>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t('common.date')}</dt>
                  <dd>{transactionQuery.data?.date ? formatDate(transactionQuery.data.date) : '—'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t('common.description')}</dt>
                  <dd className="min-w-0 truncate">{transactionQuery.data?.description}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t('common.amount')}</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatMoney(transactionQuery.data?.amount ?? '0')}
                  </dd>
                </div>
              </dl>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ToolsWorkspace>
  );
}


/** One headline number of a reconciliation. */
function ReconStat({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: string;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-hover/30 px-3 py-2.5">
      <span className={cn('flex h-8 w-8 items-center justify-center rounded-md', tone)}>
        {icon}
      </span>
      <p className="mt-2 text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-dim">{label}</p>
    </div>
  );
}

/** Statement rows with their match status and the action each one allows. */
function ReconRowsTable({
  rows,
  onViewTransaction,
  className,
}: {
  rows: ReconRow[];
  onViewTransaction: (transactionId: string) => void;
  className?: string;
}) {
  const { t, formatMoney, formatDate } = useI18n();

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-dim">
            <th className="px-2 py-2 text-left font-semibold">{t('receipts.tableDate')}</th>
            <th className="px-2 py-2 text-left font-semibold">{t('common.description')}</th>
            <th className="px-2 py-2 text-right font-semibold">{t('common.amount')}</th>
            <th className="px-2 py-2 text-left font-semibold">{t('recon.match')}</th>
            <th className="px-2 py-2 text-right font-semibold">{t('recon.action')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isMatched = row.match_status === 'matched';
            return (
              <tr key={row.id} className="border-b border-border/50 last:border-0">
                <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">
                  {row.statement_date ? formatDate(row.statement_date) : '—'}
                </td>
                <td className="max-w-[240px] truncate px-2 py-2.5">{row.statement_description}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                  {row.statement_amount ? formatMoney(row.statement_amount) : '—'}
                </td>
                <td className="px-2 py-2.5">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-medium',
                        isMatched ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
                      )}
                    >
                      {isMatched ? t('recon.matched') : t('recon.unmatched')}
                    </span>
                    {row.confidence && (
                      <span className="text-xs tabular-nums text-dim">
                        {Math.round(Number(row.confidence))}%
                      </span>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right">
                  {row.matched_transaction_id ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewTransaction(row.matched_transaction_id ?? '')}
                    >
                      {t('common.view')}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" asChild>
                      <a href="/transactions?add=1">{t('recon.addManually')}</a>
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


/**
 * Phone wizard header: upload → match → review.
 *
 * Steps are tappable so a reconciliador can jump back to the upload form; a step
 * without a result yet cannot be opened.
 */
function ReconStepper({
  step,
  hasResult,
  onSelect,
}: {
  step: 1 | 2 | 3;
  hasResult: boolean;
  onSelect: (next: 1 | 2 | 3) => void;
}) {
  const { t } = useI18n();
  const steps: { key: 1 | 2 | 3; labelKey: 'recon.stepUpload' | 'recon.stepMatch' | 'recon.stepReview' }[] =
    [
      { key: 1, labelKey: 'recon.stepUpload' },
      { key: 2, labelKey: 'recon.stepMatch' },
      { key: 3, labelKey: 'recon.stepReview' },
    ];

  return (
    <ol className="flex items-center gap-1.5 md:hidden" aria-label={t('recon.title')}>
      {steps.map((entry, index) => {
        const active = entry.key === step;
        const done = entry.key < step;
        const disabled = entry.key > 1 && !hasResult;
        return (
          <li key={entry.key} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              onClick={() => !disabled && onSelect(entry.key)}
              disabled={disabled}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-surface text-muted-foreground',
                disabled && 'opacity-50',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  active || done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {index + 1}
              </span>
              <span className="truncate text-xs font-medium">{t(entry.labelKey)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

