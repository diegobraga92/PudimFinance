/**
 * In-app diagnostic log buffer.
 *
 * Release builds hide the WebView console and Android apps cannot read their own
 * logcat, so the diagnostics screen reads this buffer instead. Entries are kept
 * in memory and mirrored (bounded) to local storage so they survive a reload or
 * a crash.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Where an entry came from; used by the diagnostics screen filters. */
export type LogSource = 'app' | 'api' | 'sync' | 'capture' | 'native' | 'server';

export interface LogEntry {
  /** Monotonic id, used as the native cursor and for list keys. */
  id: number;
  /** ISO timestamp. */
  at: string;
  level: LogLevel;
  source: LogSource;
  message: string;
  /** Optional stack trace or serialized payload. */
  detail?: string;
}

export interface LogFilter {
  level?: LogLevel | 'all';
  source?: LogSource | 'all';
  query?: string;
}

const MAX_ENTRIES = 500;
const PERSISTED_ENTRIES = 200;
const STORAGE_KEY = 'pudim_app_log';
const MAX_DETAIL = 4_000;

let nextId = 1;
let entries: LogEntry[] = [];
const listeners = new Set<(list: LogEntry[]) => void>();
let installed = false;

/** Credentials must never reach the screen or local storage. */
const REDACTIONS: [RegExp, string][] = [
  [/(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1***'],
  [/\beyJ[A-Za-z0-9._-]{10,}/g, '***'],
  [
    /(\b(?:access_token|refresh_token|password|secret|token)\b\s*["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
    '$1***',
  ],
];

/** Masks tokens and passwords in a log message. */
export function redactLogText(value: string): string {
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function truncate(value: string, max: number = MAX_DETAIL): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Best-effort string form of a single console argument. */
function describeArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

/** Returns the buffered entries, oldest first. */
export function getLogEntries(): LogEntry[] {
  return entries;
}

/** Registers a callback fired whenever an entry is appended or cleared. */
export function subscribeLogEntries(cb: (list: LogEntry[]) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyListeners(): void {
  for (const cb of listeners) {
    try {
      cb(entries);
    } catch {
      // A listener must never break logging.
    }
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-PERSISTED_ENTRIES)));
  } catch {
    // Storage is best effort.
  }
}

function restore(): void {
  if (entries.length > 0) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as LogEntry[];
    if (!Array.isArray(parsed)) return;
    entries = parsed.filter((entry) => entry && typeof entry.message === 'string');
    nextId = entries.reduce((max, entry) => Math.max(max, entry.id + 1), 1);
  } catch {
    // Corrupted buffer: start fresh.
  }
}

/** Appends one entry. Returns it so callers can chain. */
export function logEvent(
  level: LogLevel,
  source: LogSource,
  message: string,
  detail?: string,
): LogEntry {
  const entry: LogEntry = {
    id: nextId++,
    at: new Date().toISOString(),
    level,
    source,
    message: redactLogText(truncate(message, 1_000)),
    detail: detail ? redactLogText(truncate(detail)) : undefined,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  persist();
  notifyListeners();
  return entry;
}

/** Appends an error, keeping the stack trace in the detail field. */
export function logError(source: LogSource, error: unknown, context?: string): void {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : describeArg(error);
  logEvent(
    'error',
    source,
    context ? `${context}: ${message}` : message,
    error instanceof Error ? error.stack : undefined,
  );
}

/**
 * Wraps `console` and the global error handlers so everything the app already
 * reports ends up in the buffer. Safe to call more than once.
 */
export function installLogCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  restore();

  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  for (const level of levels) {
    const original = console[level].bind(console);
    // `logEvent` never touches `console`, so this cannot recurse.
    console[level] = (...args: unknown[]) => {
      logEvent(level, 'app', args.map(describeArg).join(' '));
      original(...args);
    };
  }

  window.addEventListener('error', (event) => {
    logError('app', event.error ?? event.message, 'window.onerror');
  });
  window.addEventListener('unhandledrejection', (event) => {
    logError('app', event.reason, 'unhandledrejection');
  });
}

/** Filters entries for the diagnostics screen, preserving the entry subtype. */
export function filterLogEntries<T extends LogEntry>(list: T[], filter: LogFilter = {}): T[] {
  const level = filter.level ?? 'all';
  const source = filter.source ?? 'all';
  const query = (filter.query ?? '').trim().toLowerCase();
  return list.filter((entry) => {
    if (level !== 'all' && entry.level !== level) return false;
    if (source !== 'all' && entry.source !== source) return false;
    if (!query) return true;
    return (
      entry.message.toLowerCase().includes(query) ||
      (entry.detail?.toLowerCase().includes(query) ?? false)
    );
  });
}

/** Renders entries as plain text for the copy action. */
export function formatLogEntries(list: LogEntry[]): string {
  return list
    .map(
      (entry) =>
        `${entry.at} [${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}` +
        (entry.detail ? `\n${entry.detail}` : ''),
    )
    .join('\n');
}

/** Empties the buffer (the diagnostics screen's clear action). */
export function clearLogEntries(): void {
  entries = [];
  persist();
  notifyListeners();
}
