import * as React from 'react';
import { ChevronDown, Copy, RefreshCw, Search, SlidersHorizontal, Terminal, Trash2 } from 'lucide-react';
import type { TranslationKey } from '@shared/i18n';

import { useI18n } from '@/app/i18n';
import {
  clearLogEntries,
  filterLogEntries,
  formatLogEntries,
  subscribeLogEntries,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from '@/lib/app-log';
import { clearNativeLogs, peekNativeLogs } from '@/notifications/native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/EmptyState';
import { useToast } from '@/components/ui/toaster';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { tapClass } from '@/lib/interactive';
import { ToolsWorkspace } from '@/features/tools/ToolsWorkspace';

/** A row rendered by the diagnostics screen (native entries included). */
interface LogRow extends LogEntry {
  /** Stable list key: native and JS ids live in separate sequences. */
  key: string;
  /** Epoch millis, used to merge both sources chronologically. */
  atMs: number;
}

const LEVEL_FILTERS: (LogLevel | 'all')[] = ['all', 'error', 'warn', 'info', 'debug'];
const SOURCE_FILTERS: (LogSource | 'all')[] = [
  'all',
  'api',
  'sync',
  'capture',
  'native',
  'server',
  'app',
];
const LEVEL_LABEL_KEYS: Record<LogLevel | 'all', TranslationKey> = {
  all: 'logs.levelAll',
  error: 'logs.levelError',
  warn: 'logs.levelWarn',
  info: 'logs.levelInfo',
  debug: 'logs.levelDebug',
};
const ROW_GRID = 'lg:grid lg:grid-cols-[7rem_6rem_6rem_minmax(0,1fr)_5rem] lg:items-center lg:gap-3';

/** Converts a buffered entry into a list row. */
function toLogRow(entry: LogEntry): LogRow {
  return { ...entry, key: `js-${entry.id}`, atMs: Date.parse(entry.at) || Date.now() };
}

/** True when the app can read the native (Android) buffer. */
function hasNativeBridge(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Copies text with a fallback for non-secure WebView origins. */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Diagnostics: merged WebView, API, sync, capture and native log entries. */
export function LogsPage() {
  const { t, formatDateTime } = useI18n();
  const { toast } = useToast();

  const [jsEntries, setJsEntries] = React.useState<LogEntry[]>([]);
  const [nativeRows, setNativeRows] = React.useState<LogRow[]>([]);
  const [level, setLevel] = React.useState<LogLevel | 'all'>('all');
  const [source, setSource] = React.useState<LogSource | 'all'>('all');
  const [query, setQuery] = React.useState('');
  const [follow, setFollow] = React.useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<LogRow | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const nativeCursorRef = React.useRef(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const nativeAvailable = hasNativeBridge();

  React.useEffect(() => subscribeLogEntries(setJsEntries), []);

  const refreshNative = React.useCallback(async () => {
    if (!nativeAvailable) return;
    setRefreshing(true);
    try {
      const incoming = await peekNativeLogs(nativeCursorRef.current);
      if (incoming.length === 0) return;
      nativeCursorRef.current = incoming[incoming.length - 1].id;
      setNativeRows((rows) =>
        [
          ...rows,
          ...incoming.map<LogRow>((entry) => ({
            id: entry.id,
            at: new Date(entry.at).toISOString(),
            atMs: entry.at,
            level: entry.level,
            source: 'native',
            message: `[${entry.tag}] ${entry.message}`,
            key: `native-${entry.id}`,
          })),
        ].slice(-300),
      );
    } finally {
      setRefreshing(false);
    }
  }, [nativeAvailable]);

  React.useEffect(() => {
    void refreshNative();
  }, [refreshNative]);

  const rows = React.useMemo(() => {
    const merged = [...jsEntries.map(toLogRow), ...nativeRows].sort((a, b) => a.atMs - b.atMs);
    return filterLogEntries(merged, { level, source, query });
  }, [jsEntries, nativeRows, level, source, query]);

  // Keeps the newest entry in view while following. Off by default so a phone
  // never has its touch scrolling yanked away.
  React.useEffect(() => {
    if (!follow || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [follow, rows.length]);

  const handleCopy = async () => {
    const ok = await copyText(formatLogEntries(rows));
    toast(
      ok
        ? { title: t('logs.copied'), variant: 'success' }
        : { title: t('logs.copyFailed'), variant: 'error' },
    );
  };

  const handleClear = async () => {
    clearLogEntries();
    nativeCursorRef.current = 0;
    setNativeRows([]);
    await clearNativeLogs();
    toast({ title: t('logs.cleared'), variant: 'success' });
  };

  return (
    <ToolsWorkspace>
      <div className="space-y-4">
        <div className="max-md:hidden">
          <h2 className="text-xl font-semibold">{t('logs.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('logs.subtitle')}</p>
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
          <div className="flex items-center gap-2 md:contents">
            <div className="relative w-full min-w-[10rem] sm:w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('logs.searchPlaceholder')}
                aria-label={t('logs.searchPlaceholder')}
              />
            </div>
            <Button
              variant={mobileFiltersOpen ? 'default' : 'outline'}
              size="icon"
              className="md:hidden"
              onClick={() => setMobileFiltersOpen((open) => !open)}
              aria-expanded={mobileFiltersOpen}
              aria-label={t('transactions.filters.title')}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void refreshNative()}
              disabled={refreshing || !nativeAvailable}
              aria-label={t('logs.refresh')}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void handleCopy()}
              disabled={rows.length === 0}
              aria-label={t('logs.copy')}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void handleClear()}
              disabled={rows.length === 0}
              aria-label={t('logs.clear')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div
            className={cn(
              'flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center',
              !mobileFiltersOpen && 'max-md:hidden',
            )}
          >
            <div className="flex flex-wrap gap-1.5">
              {LEVEL_FILTERS.map((value) => (
                <Button
                  key={value}
                  variant={level === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setLevel(value)}
                >
                  {t(LEVEL_LABEL_KEYS[value])}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_FILTERS.map((value) => (
                <Button
                  key={value}
                  variant={source === value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSource(value)}
                >
                  {value === 'all' ? t('logs.sourceAll') : value}
                </Button>
              ))}
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground md:min-h-0">
              <Switch checked={follow} onCheckedChange={setFollow} aria-label={t('logs.follow')} />
              {t('logs.follow')}
            </label>
          </div>
        </div>

        {!nativeAvailable && <p className="text-xs text-dim">{t('logs.nativeUnavailable')}</p>}

        {rows.length === 0 ? (
          <Card className="p-7">
            <EmptyState
              icon={<Terminal className="h-8 w-8" />}
              title={t('logs.emptyTitle')}
              description={t('logs.emptyDesc')}
            />
          </Card>
        ) : (
          <Card className="overflow-hidden border-border bg-surface shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                {t('logs.count', { count: rows.length })}
              </span>
              <span className="text-[11px] text-dim max-md:hidden">{t('logs.followHint')}</span>
            </div>
            <div ref={listRef} className="max-h-[60vh] overflow-y-auto lg:max-h-[70vh]">
              {/* Phone: tappable rows with the detail expanded inline. */}
              <ul className="divide-y divide-border/60 lg:hidden">
                {rows.map((row) => {
                  const expanded = expandedKey === row.key;
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        onClick={() => setExpandedKey(expanded ? null : row.key)}
                        aria-expanded={expanded}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left active:bg-surface-hover',
                          tapClass,
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <LogLevelBadge level={row.level} />
                            <span className="truncate text-[11px] uppercase tracking-wide text-dim">
                              {row.source}
                            </span>
                          </span>
                          <span className="mt-1 block truncate text-xs">{row.message}</span>
                          <span className="mt-0.5 block text-[11px] text-dim">
                            {formatDateTime(row.at)}
                          </span>
                        </span>
                        <ChevronDown
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0 text-dim transition-transform',
                            expanded && 'rotate-180',
                          )}
                          aria-hidden="true"
                        />
                      </button>
                      {expanded && (
                        <div className="px-4 pb-3">
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-input/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                            {row.detail ? `${row.message}\n\n${row.detail}` : row.message}
                          </pre>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Desktop: dense grid with a detail dialog. */}
              <ul className="hidden divide-y divide-border/60 lg:block">
                {rows.map((row) => (
                  <li
                    key={row.key}
                    className={cn(
                      'grid grid-cols-1 gap-2 px-4 py-3 text-sm transition-colors hover:bg-primary/[0.045]',
                      ROW_GRID,
                    )}
                  >
                    <span className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.at)}
                    </span>
                    <span>
                      <LogLevelBadge level={row.level} />
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                      {row.source}
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs">{row.message}</span>
                    <span className="lg:text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                        {t('common.view')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('logs.detailTitle')}</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {selected ? `${selected.source} · ${formatDateTime(selected.at)}` : ''}
              </DialogDescription>
            </DialogHeader>
            {selected && (
              <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-input/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                {selected.detail ? `${selected.message}\n\n${selected.detail}` : selected.message}
              </pre>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ToolsWorkspace>
  );
}

/** Colored severity label shared by both list layouts. */
function LogLevelBadge({ level }: { level: LogLevel }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        level === 'error'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : level === 'warn'
            ? 'border-warning/40 bg-warning/10 text-warning'
            : level === 'info'
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {level}
    </span>
  );
}
