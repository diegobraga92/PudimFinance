/**
 * Notification to transaction capture for PudimFinance.
 *
 * The parsing/settings/review logic is target-agnostic and shared by both
 * Tauri targets. The *listening* is platform-specific.
 *
 *   On Android a native `NotificationListenerService` (Tauri Android plugin,
 *   `src-tauri/plugins/pudim-android-native`) observes other apps' bank
 *   notifications while the app is backgrounded or killed and forwards them to
 *   the webview via the `notification-captured` event. Desktop is not supported
 *   (no OS API to read other apps' notifications).
 *
 * Settings and the pending-review inbox are persisted in localStorage.
 */

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
}

const SETTINGS_KEY = 'pudim_notification_settings';
const INBOX_KEY = 'pudim_pending_captures';

export const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  monitoredApps: [],
  mode: 'ask',
  defaultCategoryId: null,
};

/**
 * Known Brazilian banks/payment apps. The monitor matches against the
 * notification *app name* (e.g. "Nubank").
 */
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
    // Non-fatal.
  }
}

// Notification parsing

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
export function guessCategory(
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

/**
 * Parses a notification body into a transaction when the format matches a
 * bank/payment alert. Returns null for non-financial notifications.
 */
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
    /\b(?:em|no|na|de|do|da)\s+([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ0-9][A-Za-zÁÉÍÓÚÀÂÊÔÃÕÇ0-9 ]{2,40})/,
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
    .replace(/\s+(?:final|cartao|cartão)\s+[0-9*]+.*$/i, '')
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
  const today = new Date().toISOString().slice(0, 10);

  return {
    type,
    amount,
    description: description || 'Notificação bancária',
    date: today,
    categoryId,
  };
}

// Pending review inbox (ask mode)

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

export function appLabelFor(appName: string): string {
  return KNOWN_APPS.find((a) => a.appName === appName)?.label ?? appName;
}

export function toPendingCapture(parsed: ParsedTransaction, appName: string): PendingCapture {
  return {
    id: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    appName,
    type: parsed.type,
    amount: parsed.amount,
    description: parsed.description,
    date: parsed.date,
    categoryId: parsed.categoryId,
    dedupKey: dedupKeyOf(parsed),
    postTime: Date.now(),
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
    // Non-fatal.
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

