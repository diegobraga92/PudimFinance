import * as React from 'react';
import { ChevronDown, Lock, RefreshCw, Search, ShieldCheck } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useAuth } from '@/app/auth';
import { fetchAuditEvents, type AuditEvent } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ToolsWorkspace } from '@/features/tools/ToolsWorkspace';

const PAGE_SIZE = 50;
const ROW_GRID = 'lg:grid lg:grid-cols-[11rem_minmax(0,1fr)_9rem_5rem] lg:items-center lg:gap-3';

/** Reads an actor-ish value out of an event payload, when the event carries one. */
function actorOf(event: AuditEvent): string | null {
  const candidates = ['actor', 'user_email', 'email', 'user_id', 'actor_id'];
  for (const key of candidates) {
    const value = event.payload?.[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/**
 * Audit Log: the immutable system event trail.
 *
 * Administrative and read-only — non-admins see why they cannot use it instead
 * of an empty list that looks like "no activity".
 */
export function AuditPage() {
  const { t, formatDateTime } = useI18n();
  const { token, user } = useAuth();

  const [items, setItems] = React.useState<AuditEvent[]>([]);
  const [eventType, setEventType] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [selected, setSelected] = React.useState<AuditEvent | null>(null);
  /** Phone-only: which event card is expanded inline. */
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  const isAdmin = user?.role === 'admin';
  const filtersActive = Boolean(eventType.trim() || from || to);

  const load = React.useCallback(
    async (nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchAuditEvents(token, {
          event_type: eventType.trim() || undefined,
          start_date: from || undefined,
          end_date: to || undefined,
          page: nextPage,
          page_size: PAGE_SIZE,
        });
        setItems(res.items);
        setPage(res.page);
        setHasMore(res.items.length === PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('audit.failedLoad'));
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [token, eventType, from, to, t],
  );

  React.useEffect(() => {
    if (token && isAdmin) void load(0);
  }, [token, isAdmin, load]);

  // Non-admins get one clear message: no filters, no empty table underneath.
  if (!isAdmin) {
    return (
      <ToolsWorkspace>
        <Card className="border-border bg-surface p-7 shadow-card">
          <EmptyState
            icon={<Lock className="h-8 w-8" />}
            title={t('audit.adminTitle')}
            description={t('audit.adminDesc')}
          />
        </Card>
      </ToolsWorkspace>
    );
  }

  return (
    <ToolsWorkspace>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{t('audit.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('audit.subtitle')}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => void load(page)}
            disabled={loading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('common.retry')}
          </Button>
        </div>

        {/* Filters: event type and date range are what the API supports. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-[12rem] sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              placeholder={t('audit.filterPlaceholder')}
              aria-label={t('audit.filterPlaceholder')}
            />
          </div>
          <Input
            type="date"
            className="w-[9.5rem]"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label={t('receipts.filterFrom')}
          />
          <Input
            type="date"
            className="w-[9.5rem]"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label={t('receipts.filterTo')}
          />
          <Button onClick={() => void load(0)} disabled={loading}>
            {loading ? t('common.loading') : t('common.apply')}
          </Button>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEventType('');
                setFrom('');
                setTo('');
              }}
            >
              {t('receipts.clearFilters')}
            </Button>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {loading ? (
          <Card className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </Card>
        ) : items.length === 0 ? (
          <Card className="p-7">
            <EmptyState
              icon={<ShieldCheck className="h-8 w-8" />}
              title={t('audit.noEventsTitle')}
              description={t('audit.noEventsDesc')}
            />
          </Card>
        ) : (
          <Card className="overflow-hidden border-border bg-surface shadow-card">
            <div
              className={cn(
                'hidden border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-dim',
                ROW_GRID,
              )}
            >
              <span>{t('audit.time')}</span>
              <span>{t('audit.eventType')}</span>
              <span>{t('audit.actor')}</span>
              <span className="text-right">{t('audit.details')}</span>
            </div>
            <ul className="divide-y divide-border/60 lg:hidden">
              {items.map((event) => {
                const expanded = expandedId === event.id;
                const actor = actorOf(event);
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : event.id)}
                      aria-expanded={expanded}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors active:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">{event.event_type}</span>
                        <span className="mt-1 block truncate text-xs text-dim">
                          {formatDateTime(event.occurred_at)}
                          {actor ? ` · ${actor}` : ''}
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
                      <div className="space-y-2 px-4 pb-3">
                        <p className="truncate text-xs text-muted-foreground">
                          {event.aggregate_type} ·{' '}
                          <span className="font-mono">{event.aggregate_id}</span>
                        </p>
                        <pre className="max-h-56 overflow-auto rounded-md border border-border bg-input/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <ul className="hidden divide-y divide-border/60 lg:block">
              {items.map((event) => (
                <li
                  key={event.id}
                  className={cn(
                    'grid grid-cols-1 gap-2 px-4 py-3 text-sm transition-colors hover:bg-primary/[0.045]',
                    ROW_GRID,
                  )}
                >
                  <span className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(event.occurred_at)}
                  </span>
                  <span className="min-w-0 truncate font-mono text-xs">{event.event_type}</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {actorOf(event) ?? '—'}
                  </span>
                  <span className="lg:text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(event)}>
                      {t('common.view')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {(page > 0 || hasMore) && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-dim">
              {t('audit.pageInfo', { page: page + 1, count: items.length })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0 || loading}
                onClick={() => void load(Math.max(0, page - 1))}
              >
                {t('receipts.previousPage')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasMore || loading}
                onClick={() => void load(page + 1)}
              >
                {t('receipts.nextPage')}
              </Button>
            </div>
          </div>
        )}
        {/* Event detail: complete, but visually secondary. */}
        <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('audit.detailTitle')}</DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {selected?.event_type}
              </DialogDescription>
            </DialogHeader>
            {selected && (
              <div className="space-y-4 text-sm">
                <dl className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t('audit.time')}</dt>
                    <dd>{formatDateTime(selected.occurred_at)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t('audit.actor')}</dt>
                    <dd className="min-w-0 truncate">{actorOf(selected) ?? '—'}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t('audit.eventId')}</dt>
                    <dd className="font-mono text-xs">{selected.id}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t('audit.entityType')}</dt>
                    <dd>{selected.aggregate_type}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{t('audit.entityId')}</dt>
                    <dd className="min-w-0 truncate font-mono text-xs">{selected.aggregate_id}</dd>
                  </div>
                </dl>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                    {t('audit.payload')}
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-md border border-border bg-input/40 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    {JSON.stringify(selected.payload, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </ToolsWorkspace>
  );
}

