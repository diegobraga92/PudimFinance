/** Shared notification parsing and review logic; Android supplies the listener. */

import { toIsoDate } from '@/lib/date-input';

export type CaptureMode = 'auto' | 'ask';

export interface NotificationSettings {
  /** Master switch. False means notifications are ignored. */
  enabled: boolean;
  /** App names we watch for (empty = all apps). */
  monitoredApps: string[];
  /** `auto` creates transactions silently, while `ask` prompts first. */
  mode: CaptureMode;
  /** Default category id used when the parser can't guess one. */
  defaultCategoryId: string | null;
  /** In `ask` mode, also post a system notification with import actions. */
  pushPrompt: boolean;
  /** Account used when a capture is imported as a debit (checking) expense. */
  debitAccountId: string | null;
  /** Account (credit card) used when a capture is imported as a credit expense. */
  creditAccountId: string | null;
}

const SETTINGS_KEY = 'pudim_notification_settings';
const INBOX_KEY = 'pudim_pending_captures';
const IMPORTED_DEDUP_KEY = 'pudim_imported_capture_dedup';
const MAX_IMPORTED_DEDUP = 200;

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  monitoredApps: [],
  mode: 'ask',
  defaultCategoryId: null,
  pushPrompt: true,
  debitAccountId: null,
  creditAccountId: null,
};

/** Import actions; debit and credit both create expenses. */
export type CaptureActionKind = 'income' | 'debit' | 'credit';

/** Narrows an untrusted (native) value to a [CaptureActionKind]. */
export function isCaptureActionKind(value: unknown): value is CaptureActionKind {
  return value === 'income' || value === 'debit' || value === 'credit';
}

/** Maps a prompt action to the transaction type it creates. */
export function transactionTypeForAction(action: CaptureActionKind): 'income' | 'expense' {
  return action === 'income' ? 'income' : 'expense';
}

/** Returns the configured source account for a prompt action. */
export function accountIdForAction(
  action: CaptureActionKind,
  settings: Pick<NotificationSettings, 'debitAccountId' | 'creditAccountId'>,
): string | null {
  if (action === 'debit') return settings.debitAccountId;
  if (action === 'credit') return settings.creditAccountId;
  return null;
}

/** Bank/payment apps matched by notification app name. */
export const KNOWN_APPS: { label: string; appName: string }[] = [
  { label: 'Nubank', appName: 'Nubank' },
  { label: 'Itaú', appName: 'Itaú' },
  { label: 'Banco do Brasil', appName: 'Banco do Brasil' },
  { label: 'Bradesco', appName: 'Bradesco' },
  { label: 'Caixa', appName: 'Caixa' },
  { label: 'PicPay', appName: 'PicPay' },
  { label: 'Mercado Pago', appName: 'Mercado Pago' },
  { label: 'Inter', appName: 'Inter' },
  { label: 'Santander', appName: 'Santander' },
];

export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<NotificationSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<void> {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings persistence is best effort.
  }
}

export interface ParsedTransaction {
  /** `income` or `expense`. */
  type: 'income' | 'expense';
  /** Decimal string amount, e.g. "49.90". */
  amount: string;
  /** Cleaned-up merchant/payer description. */
  description: string;
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  /** Category id when we could map one, otherwise null. */
  categoryId: string | null;
}

/** Normalizes a Brazilian amount like "R$ 1.234,56" into "1234.56". */
function normalizeAmount(raw: string): string {
  let cleaned = raw.replace(/[^0-9.,]/g, '');
  // If both separators exist, the last one is the decimal separator.
  if (cleaned.includes(',') && cleaned.includes('.')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  return cleaned;
}

const EXPENSE_KEYWORDS = [
  'compra', 'aprovada', 'debito', 'débito', 'transferencia enviada',
  'transferência enviada', 'pagamento efetuado', 'pagamento realizado',
  'pix enviado', 'pix realizado', 'saque', 'comprou', 'cobranca',
  'cobrança', 'fatura', 'parcela', 'boleto pago', 'boleto',
  'cartao', 'cartão', 'conta de', 'compras no cart',
];

const INCOME_KEYWORDS = [
  'recebido', 'recebida', 'recebeu', 'credito', 'crédito', 'entrada', 'pix recebido',
  'pagamento recebido', 'transferencia recebida', 'transferência recebida',
  'deposito', 'depósito', 'rendimento', 'estorno', 'reembolso',
];

/** Maps a guessed merchant word to an existing category by fuzzy matching. */
function guessCategory(
  description: string,
  categories: { id: string; name: string; type: string }[],
): string | null {
  const d = description.toLowerCase();
  const map: [RegExp, string][] = [
    [/supermerc|mercado|extra|carrefour|pao de acucar|pão de açúcar|dia |assai|atacadao/i, 'Food & Groceries'],
    [/restaurante|iFood|ifood|rappi|uber eats|delivery|lanche|pizza|hamburg/i, 'Food & Groceries'],
    [/posto|shell|petrobras|gasolina|combustivel|combustível/i, 'Transportation'],
    [/uber|99taxis|99taxi|transporte|metro|metrô|onibus|ônibus|recarga/i, 'Transportation'],
    [/luz|energia|eletropaulo|enel|agua|água|sabesp|gas|gás|comgas|internet|vivo|claro|tim|telefone/i, 'Utilities'],
    [/netflix|spotify|prime|disney|hbo|deezer|youtube|premium/i, 'Subscriptions'],
    [/farmacia|farmácia|droga|drogasil|drogaraia|pague menos|hospital|medico|médico/i, 'Healthcare'],
    [/aluguel|condominio|condomínio|imovel|imóvel|iptu/i, 'Housing'],
    [/salario|salário|empresa|emprego|holerite|pagamento de sal/i, 'Salary'],
    [/freela|freelance|projeto|consultoria/i, 'Freelance'],
    [/invest|rendimento|cdb|acoes|ações|tesouro|fundo/i, 'Investments'],
    [/amazon|mercadolivre|mercado livre|magazine|casas bahia|shopping|loja/i, 'Shopping'],
  ];
  for (const [re, name] of map) {
    if (re.test(d)) {
      const found = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (found) return found.id;
    }
  }
  return null;
}

/** Parses a bank/payment notification into a transaction. */
export function parseNotification(
  body: string,
  categories: { id: string; name: string; type: string }[],
  fallbackCategoryId: string | null,
): ParsedTransaction | null {
  const text = body.trim();
  if (!text) return null;

  // Amount is mandatory for us to consider this a financial alert.
  const amountMatch =
    text.match(/R\$\s*([0-9][0-9.,]*)/i) ||
    text.match(/([0-9][0-9.,]*)\s*(?:reais|real|brl)/i);
  if (!amountMatch) return null;

  const amount = normalizeAmount(amountMatch[1]);
  const numericAmount = parseFloat(amount);
  if (!(numericAmount > 0)) return null;

  const lower = text.toLowerCase();
  const isIncome = INCOME_KEYWORDS.some((k) => lower.includes(k));
  const isExpense = EXPENSE_KEYWORDS.some((k) => lower.includes(k));

  // If neither income nor expense keyword matched, treat R$ amounts with
  // "em" (purchase at X) as expenses, otherwise skip.
  let type: 'income' | 'expense' | null = null;
  if (isIncome && !isExpense) type = 'income';
  else if (isExpense) type = 'expense';
  else if (/\bem\b|\bat\b|compra/i.test(text)) type = 'expense';

  if (!type) return null;

  // Extract a description by taking the text after "em"/"de"/"no" and stripping noise.
  let description = text;
  const merchantMatch = text.match(
    /\b(?:em|no|na|de|do|da)\s+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ0-9][A-Za-zÁÉÍÓÚÀÂÊÔÃÕÇ0-9 ]{2,79}?)(?=\s+para\s+(?:o\s+)?cart(?:a|ã)o\b|\s+às?\s+[0-9]{1,2}[:h][0-9]{2}|[.,]|$)/,
  );
  if (merchantMatch) {
    description = merchantMatch[1].trim();
  } else {
    // Otherwise strip the leading alert verb and amount.
    description = text
      .replace(/R\$\s*[0-9][0-9.,]*/i, '')
      .replace(/^[a-záéíóúàâêôãõçü]+ de\s*/i, '')
      .replace(/^[a-záéíóúàâêôãõçü]+\s*/i, '')
      .replace(/[•·:]/g, '')
      .trim();
  }

  // Drop trailing punctuation and "às HH:MM" markers.
  description = description
    .replace(/\s+às?\s+[0-9]{1,2}[:h][0-9]{2}.*$/i, '')
    .replace(/\s+para\s+(?:o\s+)?cart(?:a|ã)o\b.*$/i, '')
    .replace(/\s+(?:final|cartao|cartão)\s+[0-9*]+.*$/i, '')
    .replace(/^(?:pix\s+)?enviado\s+de\s+/i, '')
    .replace(/^para\s+/i, '')
    .replace(/^[-–—\s]+/, '')
    .replace(/[.,\s]+$/, '')
    .trim()
    .slice(0, 80);

  // If the description is still a bare verb (e.g. "pago", "realizado"),
  // fall back to a generic label rather than a useless word.
  const USELESS_DESCRIPTIONS =
    /^(pago|paga|realizado|realizada|efetuado|efetuada|aprovado|aprovada|recebido|recebida|recebeu|compra|saque|boleto|fatura)$/i;
  if (description.length <= 3 || USELESS_DESCRIPTIONS.test(description)) {
    description = 'Notificação bancária';
  }

  const categoryId = guessCategory(description, categories) ?? fallbackCategoryId;
  // Transaction dates are calendar dates in the user's local timezone. Using
  // an ISO UTC string makes late-evening Brazilian captures land on tomorrow.
  const today = toIsoDate(new Date());

  return {
    type,
    amount,
    description: description || 'Notificação bancária',
    date: today,
    categoryId,
  };
}

/** Fallback description when the parser cannot extract a merchant. */
export const FALLBACK_CAPTURE_DESCRIPTION = 'Notificação bancária';

/** Returns an ISO date, or today when the value is missing/malformed. */
export function isoDateOrToday(value?: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : toIsoDate(new Date());
}

/** Prompt action fields used to rebuild the capture it refers to. */
export interface ActionCaptureSource {
  action: CaptureActionKind;
  /** Parsed fields the native prompt carried (in-app prompts). */
  amount?: string;
  description?: string;
  date?: string;
  categoryId?: string | null;
  /** Raw notification (listener-posted prompts). */
  title?: string;
  text?: string;
  app_name?: string;
  app_label?: string;
}

/**
 * Rebuilds the capture a prompt action refers to.
 *
 * Parsed fields win over the raw text: an in-app prompt carries its own
 * localized body as `text`, and using those exact values keeps the dedup key
 * identical to the review-inbox entry.
 */
export function captureFromAction(
  source: ActionCaptureSource,
  settings: Pick<NotificationSettings, 'defaultCategoryId'>,
): { parsed: ParsedTransaction; appName: string } | null {
  const appName = source.app_label?.trim() || source.app_name?.trim() || '';
  const amount = source.amount ? normalizeAmount(source.amount) : '';
  if (Number.parseFloat(amount) > 0) {
    return {
      parsed: {
        type: transactionTypeForAction(source.action),
        amount,
        description: source.description?.trim() || FALLBACK_CAPTURE_DESCRIPTION,
        date: isoDateOrToday(source.date),
        categoryId: source.categoryId ?? settings.defaultCategoryId,
      },
      appName,
    };
  }

  const text = [source.title, source.text].filter(Boolean).join(' ').trim();
  const fromText = text ? parseNotification(text, [], settings.defaultCategoryId) : null;
  return fromText ? { parsed: fromText, appName } : null;
}

/**
 * Transaction fields of a capture the native side already imported, or null
 * when the entry carries no usable amount.
 */
export function nativeImportTransaction(entry: {
  type?: string;
  amount?: string;
  description?: string;
  date?: string;
  category_id?: string | null;
}): ParsedTransaction | null {
  const amount = entry.amount ? normalizeAmount(entry.amount) : '';
  if (!(Number.parseFloat(amount) > 0)) return null;
  return {
    type: entry.type === 'income' ? 'income' : 'expense',
    amount,
    description: entry.description?.trim() || FALLBACK_CAPTURE_DESCRIPTION,
    date: isoDateOrToday(entry.date),
    categoryId: entry.category_id ?? null,
  };
}

export interface PendingCapture {
  id: string;
  appName: string;
  type: 'income' | 'expense';
  amount: string;
  description: string;
  date: string;
  categoryId: string | null;
  dedupKey: string;
  postTime: number;
  /** Whether the OS import prompt was already posted for this capture. */
  prompted?: boolean;
}

/** Uses the current default for older captures that were queued without a category. */
export function categoryIdForCapture(
  item: Pick<PendingCapture, 'type' | 'categoryId'>,
  settings: Pick<NotificationSettings, 'defaultCategoryId'>,
): string | null {
  return item.categoryId ?? (item.type === 'expense' ? settings.defaultCategoryId : null);
}

const MAX_PENDING = 50;

function normalizeForDedup(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function dedupKeyOf(parsed: ParsedTransaction): string {
  return `${parsed.type}|${parsed.amount}|${normalizeForDedup(parsed.description)}|${parsed.date}`;
}

function readImportedDedup(): string[] {
  try {
    const raw = localStorage.getItem(IMPORTED_DEDUP_KEY);
    const values = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

/** Returns true when a capture was already imported, including after restart. */
export function hasImportedCapture(dedupKey: string): boolean {
  return readImportedDedup().includes(dedupKey);
}

/** Persists a bounded imported-capture journal used by both live and action paths. */
export async function markCaptureImported(dedupKey: string): Promise<void> {
  const values = readImportedDedup().filter((value) => value !== dedupKey);
  values.push(dedupKey);
  try {
    localStorage.setItem(IMPORTED_DEDUP_KEY, JSON.stringify(values.slice(-MAX_IMPORTED_DEDUP)));
  } catch {
    // Deduplication is best effort when local storage is unavailable.
  }
}

export function appLabelFor(appName: string): string {
  return KNOWN_APPS.find((a) => a.appName === appName)?.label ?? appName;
}

export function toPendingCapture(
  parsed: ParsedTransaction,
  appName: string,
  options?: { id?: string; prompted?: boolean },
): PendingCapture {
  return {
    id: options?.id ?? `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    appName,
    type: parsed.type,
    amount: parsed.amount,
    description: parsed.description,
    date: parsed.date,
    categoryId: parsed.categoryId,
    dedupKey: dedupKeyOf(parsed),
    postTime: Date.now(),
    prompted: options?.prompted ?? false,
  };
}

function readInbox(): PendingCapture[] {
  try {
    const raw = localStorage.getItem(INBOX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PendingCapture[];
  } catch {
    return [];
  }
}

async function writeInbox(items: PendingCapture[]): Promise<void> {
  try {
    localStorage.setItem(INBOX_KEY, JSON.stringify(items));
  } catch {
    // The review inbox is best effort when storage is unavailable.
  }
}

export async function getPendingCaptures(): Promise<PendingCapture[]> {
  return readInbox();
}

export async function addPendingCapture(item: PendingCapture): Promise<PendingCapture[]> {
  const items = readInbox();
  const existingIdx = items.findIndex((c) => c.dedupKey === item.dedupKey);
  const next = [...items];
  if (existingIdx >= 0) {
    next[existingIdx] = {
      ...next[existingIdx],
      categoryId: next[existingIdx].categoryId ?? item.categoryId,
      postTime: Math.max(next[existingIdx].postTime, item.postTime),
    };
  } else {
    next.push(item);
    if (next.length > MAX_PENDING) next.shift();
  }
  await writeInbox(next);
  return next;
}

export async function removePendingCapture(id: string): Promise<PendingCapture[]> {
  const next = readInbox().filter((c) => c.id !== id);
  await writeInbox(next);
  return next;
}

/** Removes inbox entries matching a de-dup key. */
export async function removePendingCaptureByDedupKey(
  dedupKey: string,
): Promise<PendingCapture[]> {
  const next = readInbox().filter((c) => c.dedupKey !== dedupKey);
  await writeInbox(next);
  return next;
}

/** Marks a capture so a drained notification does not prompt twice. */
export async function markCapturePrompted(id: string): Promise<PendingCapture[]> {
  const next = readInbox().map((c) => (c.id === id ? { ...c, prompted: true } : c));
  await writeInbox(next);
  return next;
}

