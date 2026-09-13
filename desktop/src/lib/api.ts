import type { components } from './api-types';
import { request, ApiError, isNetworkError } from './request';
import { isOnline, markServerUnavailable, uuid } from '@/offline/net';
import { queueLocalMutation } from '@/offline/sync-engine';
import {
  deleteLocalAccount,
  deleteLocalCategory,
  deleteLocalTransaction,
  getLocalAccounts,
  getLocalCategories,
  getLocalTransactions,
  updateLocalTransactionFields,
  upsertLocalAccount,
  upsertLocalCategory,
  upsertLocalTransaction,
  type LocalAccount,
  type LocalCategory,
  type LocalTransaction,
} from '@/offline/database';

export { ApiError, isNetworkError };

// Typed aliases, sourced from the generated OpenAPI spec

export type Category = components['schemas']['Category'];
export type CreateCategoryRequest = components['schemas']['CreateCategoryRequest'];
export type UpdateCategoryRequest = components['schemas']['UpdateCategoryRequest'];
export type Transaction = components['schemas']['Transaction'];
export type CreateTransactionRequest = components['schemas']['CreateTransactionRequest'];
export type UpdateTransactionRequest = components['schemas']['UpdateTransactionRequest'];
export type TransactionListResponse = components['schemas']['TransactionListResponse'];
export type SummaryResponse = components['schemas']['SummaryResponse'];
export type CategorySummary = components['schemas']['CategorySummary'];
export type Budget = components['schemas']['Budget'];
export type CreateBudgetRequest = components['schemas']['CreateBudgetRequest'];
export type BudgetWithCategory = components['schemas']['BudgetWithCategory'];
export type BudgetAlert = components['schemas']['BudgetAlert'];
export type BudgetAlertListResponse = components['schemas']['BudgetAlertListResponse'];
export type AcknowledgeAlertsResponse = components['schemas']['AcknowledgeAlertsResponse'];
export type BudgetSummaryItem = components['schemas']['BudgetSummaryItem'];
export type BudgetSummaryResponse = components['schemas']['BudgetSummaryResponse'];
export type MonthlyReportItem = components['schemas']['MonthlyReportItem'];
export type MonthlyReportResponse = components['schemas']['MonthlyReportResponse'];
export type CategoryBreakdownItem = components['schemas']['CategoryBreakdownItem'];
export type CategoryBreakdownResponse = components['schemas']['CategoryBreakdownResponse'];
export type TrendPoint = components['schemas']['TrendPoint'];
export type TrendsResponse = components['schemas']['TrendsResponse'];
export type Account = components['schemas']['Account'];
export type AccountWithBalance = components['schemas']['AccountWithBalance'];
export type CreateAccountRequest = components['schemas']['CreateAccountRequest'];
export type UpdateAccountRequest = components['schemas']['UpdateAccountRequest'];
export type CardBill = components['schemas']['CardBill'];
export type CardOverview = components['schemas']['CardOverview'];
export type CreateCardPurchaseRequest = components['schemas']['CreateCardPurchaseRequest'];
export type PayCardBillRequest = components['schemas']['PayCardBillRequest'];
export type PayCardBillResponse = components['schemas']['PayCardBillResponse'];
export type AnticipateInstallmentsRequest = components['schemas']['AnticipateInstallmentsRequest'];
export type AnticipateInstallmentsResponse = components['schemas']['AnticipateInstallmentsResponse'];
export type CreateInstallmentPlanRequest = components['schemas']['CreateInstallmentPlanRequest'];
export type GenerateInstallmentsResponse = components['schemas']['GenerateInstallmentsResponse'];
export type InstallmentPlan = components['schemas']['InstallmentPlan'];
export type InstallmentPlanDetail = components['schemas']['InstallmentPlanDetail'];
export type PayInstallmentResponse = components['schemas']['PayInstallmentResponse'];
export type CreateLedgerTransactionRequest = components['schemas']['CreateLedgerTransactionRequest'];
export type CreateLedgerTransactionResponse = components['schemas']['CreateLedgerTransactionResponse'];
export type LedgerEntry = components['schemas']['LedgerEntry'];
export type LedgerTransaction = components['schemas']['LedgerTransaction'];
export type MigrationResponse = components['schemas']['MigrationResponse'];
export type ReconciliationUploadRequest = components['schemas']['ReconciliationUploadRequest'];
export type ReconciliationUploadResponse = components['schemas']['ReconciliationUploadResponse'];
export type SaveReceiptRequest = components['schemas']['SaveReceiptRequest'];
export type ScanRequest = components['schemas']['ScanRequest'];
export type OcrRequest = components['schemas']['OcrRequest'];
export type MergeProductsRequest = components['schemas']['MergeProductsRequest'];
export type SyncPullRequest = components['schemas']['SyncPullRequest'];
export type SyncPullResponse = components['schemas']['SyncPullResponse'];

function qs(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

// Offline-first helpers (local mirror <-> server shapes)

function localTxToTransaction(t: LocalTransaction): Transaction {
  return {
    id: t.server_id ?? t.id,
    description: t.description,
    amount: t.amount,
    type: t.type,
    category_id: t.category_id,
    date: t.date,
    notes: t.notes,
    installment_plan_id: t.installment_plan_id,
    account_id: t.account_id,
    created_at: t.updated_at,
    updated_at: t.updated_at,
  };
}

function localCategoryToCategory(c: LocalCategory): Category {
  return {
    id: c.server_id ?? c.id,
    name: c.name,
    type: c.type,
    parent_id: c.parent_id,
    icon: c.icon,
    color: c.color,
    created_at: c.updated_at,
    updated_at: c.updated_at,
  };
}

function localAccountToAccount(a: LocalAccount): AccountWithBalance {
  return {
    id: a.server_id ?? a.id,
    name: a.name,
    type: a.type,
    account_kind: a.account_kind,
    parent_id: a.parent_id,
    closing_day: a.closing_day,
    due_day: a.due_day,
    credit_limit: a.credit_limit,
    balance: a.balance,
    transaction_count: a.transaction_count,
    created_at: a.created_at,
  };
}


export type SyncPushRequest = components['schemas']['SyncPushRequest'];
export type SyncPushResponse = components['schemas']['SyncPushResponse'];

// Auth

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: { id: string; email: string; role: string };
}

export async function registerUser(payload: {
  email: string;
  password: string;
  display_name?: string | null;
}): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function loginUser(payload: { email: string; password: string }): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function refreshToken(payload: { refresh_token: string }): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/refresh', {
    method: 'POST',
    withAuth: false,
    body: JSON.stringify(payload),
  });
}

export async function fetchMe(token: string): Promise<{ id: string; email: string; role: string }> {
  return request<{ id: string; email: string; role: string }>('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Categories

export async function fetchCategories(): Promise<Category[]> {
  if (!(await isOnline())) {
    return (await getLocalCategories()).map(localCategoryToCategory);
  }
  return request<Category[]>('/api/categories');
}

export async function fetchCategory(id: string): Promise<Category> {
  return request<Category>(`/api/categories/${id}`);
}

export async function createCategory(payload: CreateCategoryRequest): Promise<Category> {
  const localId = uuid();
  const queueAndStore = async (): Promise<Category> => {
    await queueLocalMutation('create', 'category', localId, null, payload as Record<string, unknown>);
    const now = new Date().toISOString();
    await upsertLocalCategory({
      id: localId,
      server_id: null,
      name: payload.name,
      type: payload.type as 'income' | 'expense',
      parent_id: payload.parent_id ?? null,
      icon: payload.icon ?? null,
      color: payload.color ?? null,
      synced: 0,
      updated_at: now,
    });
    return localCategoryToCategory({
      id: localId,
      server_id: null,
      name: payload.name,
      type: payload.type as 'income' | 'expense',
      parent_id: payload.parent_id ?? null,
      icon: payload.icon ?? null,
      color: payload.color ?? null,
      synced: 0,
      updated_at: now,
    });
  };

  if (!(await isOnline())) return queueAndStore();
  try {
    const created = await request<Category>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await upsertLocalCategory({
      id: created.id,
      server_id: created.id,
      name: created.name,
      type: created.type,
      parent_id: created.parent_id ?? null,
      icon: created.icon ?? null,
      color: created.color ?? null,
      synced: 1,
      updated_at: created.updated_at,
    });
    return created;
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      return queueAndStore();
    }
    throw err;
  }
}

export async function updateCategory(id: string, payload: UpdateCategoryRequest): Promise<Category> {
  const queueAndStore = async (): Promise<Category> => {
    await queueLocalMutation('update', 'category', id, id, payload as Record<string, unknown>);
    const rows = await getLocalCategories();
    const existing = rows.find((c) => c.id === id || c.server_id === id);
    if (existing) {
      const next: LocalCategory = {
        ...existing,
        name: payload.name,
        type: payload.type as 'income' | 'expense',
        parent_id: payload.parent_id ?? null,
        icon: payload.icon ?? null,
        color: payload.color ?? null,
        updated_at: new Date().toISOString(),
      };
      await upsertLocalCategory(next);
      return localCategoryToCategory(next);
    }
    throw new ApiError('Category not found locally', 404, 'Not Found');
  };

  if (!(await isOnline())) return queueAndStore();
  try {
    const updated = await request<Category>(`/api/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await upsertLocalCategory({
      id: updated.id,
      server_id: updated.id,
      name: updated.name,
      type: updated.type,
      parent_id: updated.parent_id ?? null,
      icon: updated.icon ?? null,
      color: updated.color ?? null,
      synced: 1,
      updated_at: updated.updated_at,
    });
    return updated;
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      return queueAndStore();
    }
    throw err;
  }
}

export async function deleteCategory(id: string): Promise<void> {
  const queueAndDelete = async () => {
    await queueLocalMutation('delete', 'category', id, id, {});
    await deleteLocalCategory(id);
  };

  if (!(await isOnline())) {
    await queueAndDelete();
    return;
  }
  try {
    await request<void>(`/api/categories/${id}`, { method: 'DELETE' });
    await deleteLocalCategory(id);
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      await queueAndDelete();
      return;
    }
    throw err;
  }
}

// Transactions

export interface TransactionFilters {
  page?: number;
  page_size?: number;
  category_id?: string;
  type?: string;
  start_date?: string;
  end_date?: string;
  account_id?: string;
}

export async function fetchTransactions(
  params?: TransactionFilters,
): Promise<TransactionListResponse> {
  // Offline, serve the local mirror (sorted newest-first by the store).
  if (!(await isOnline())) {
    const items = await getLocalTransactions();
    const mapped = items.map(localTxToTransaction);
    const start = params?.page ?? 0;
    const pageSize = params?.page_size ?? 50;
    return {
      items: mapped.slice(start * pageSize, (start + 1) * pageSize),
      page: start,
      page_size: pageSize,
      total: mapped.length,
    };
  }
  return request<TransactionListResponse>(`/api/transactions${qs(params as Record<string, unknown>)}`);
}

export async function fetchTransaction(id: string): Promise<Transaction> {
  return request<Transaction>(`/api/transactions/${id}`);
}

export async function createTransaction(payload: CreateTransactionRequest): Promise<Transaction> {
  const localId = uuid();
  const queueAndStore = async (): Promise<Transaction> => {
    await queueLocalMutation('create', 'transaction', localId, null, payload as Record<string, unknown>);
    await upsertLocalTransaction({
      id: localId,
      server_id: null,
      description: payload.description,
      amount: payload.amount,
      type: payload.type as 'income' | 'expense',
      category_id: payload.category_id ?? null,
      date: payload.date,
      notes: payload.notes ?? null,
      installment_plan_id: payload.installment_plan_id ?? null,
      account_id: payload.account_id ?? null,
      synced: 0,
      updated_at: new Date().toISOString(),
    });
    return localTxToTransaction({
      id: localId,
      server_id: null,
      description: payload.description,
      amount: payload.amount,
      type: payload.type as 'income' | 'expense',
      category_id: payload.category_id ?? null,
      date: payload.date,
      notes: payload.notes ?? null,
      installment_plan_id: payload.installment_plan_id ?? null,
      account_id: payload.account_id ?? null,
      synced: 0,
      updated_at: new Date().toISOString(),
    });
  };

  if (!(await isOnline())) return queueAndStore();
  try {
    const created = await request<Transaction>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await upsertLocalTransaction({
      id: created.id,
      server_id: created.id,
      description: created.description,
      amount: created.amount,
      type: created.type as LocalTransaction['type'],
      category_id: created.category_id ?? null,
      date: created.date,
      notes: created.notes ?? null,
      installment_plan_id: created.installment_plan_id ?? null,
      account_id: created.account_id ?? null,
      synced: 1,
      updated_at: created.updated_at,
    });
    return created;
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      return queueAndStore();
    }
    throw err;
  }
}

export async function updateTransaction(
  id: string,
  payload: UpdateTransactionRequest,
): Promise<Transaction> {
  const queueAndStore = async (): Promise<Transaction> => {
    await queueLocalMutation('update', 'transaction', id, id, payload as Record<string, unknown>);
    await updateLocalTransactionFields(id, {
      description: payload.description,
      amount: payload.amount,
      type: payload.type as 'income' | 'expense',
      category_id: payload.category_id ?? null,
      date: payload.date,
      notes: payload.notes ?? null,
      account_id: payload.account_id ?? null,
    });
    const local = await getLocalTransactionByAnyId(id);
    return localTxToTransaction(local);
  };
  if (!(await isOnline())) return queueAndStore();
  try {
    const updated = await request<Transaction>(`/api/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await upsertLocalTransaction({
      id: updated.id,
      server_id: updated.id,
      description: updated.description,
      amount: updated.amount,
      type: updated.type as LocalTransaction['type'],
      category_id: updated.category_id ?? null,
      date: updated.date,
      notes: updated.notes ?? null,
      installment_plan_id: updated.installment_plan_id ?? null,
      account_id: updated.account_id ?? null,
      synced: 1,
      updated_at: updated.updated_at,
    });
    return updated;
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      return queueAndStore();
    }
    throw err;
  }
}

export async function deleteTransaction(id: string): Promise<void> {
  const queueAndDelete = async () => {
    await queueLocalMutation('delete', 'transaction', id, id, {});
    await deleteLocalTransaction(id);
  };

  if (!(await isOnline())) {
    await queueAndDelete();
    return;
  }
  try {
    await request<void>(`/api/transactions/${id}`, { method: 'DELETE' });
    await deleteLocalTransaction(id);
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      await queueAndDelete();
      return;
    }
    throw err;
  }
}

/** Looks up a local transaction by either id. */
async function getLocalTransactionByAnyId(id: string): Promise<LocalTransaction> {
  const rows = await getLocalTransactions();
  const found = rows.find((t) => t.id === id || t.server_id === id);
  if (!found) {
    throw new ApiError('Transaction not found locally', 404, 'Not Found');
  }
  return found;
}

// Summary

export async function fetchSummary(params?: { month?: number; year?: number }): Promise<SummaryResponse> {
  return request<SummaryResponse>(`/api/summary${qs(params as Record<string, unknown>)}`);
}


// Budgets

export async function fetchBudgets(): Promise<BudgetWithCategory[]> {
  return request<BudgetWithCategory[]>('/api/budgets');
}

export async function createBudget(payload: CreateBudgetRequest): Promise<Budget> {
  return request<Budget>('/api/budgets', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteBudget(id: string): Promise<void> {
  return request<void>(`/api/budgets/${id}`, { method: 'DELETE' });
}

export async function fetchBudgetAlerts(params?: {
  acknowledged?: boolean;
}): Promise<BudgetAlertListResponse> {
  return request<BudgetAlertListResponse>(`/api/budgets/alerts${qs(params as Record<string, unknown>)}`);
}

/** Acknowledges a single budget alert. Returns the acknowledged alert. */
export async function acknowledgeBudgetAlert(id: string): Promise<{ id: string; acknowledged: boolean }> {
  return request<{ id: string; acknowledged: boolean }>(`/api/budgets/alerts/${id}/acknowledge`, {
    method: 'POST',
  });
}

export async function acknowledgeAllBudgetAlerts(): Promise<AcknowledgeAlertsResponse> {
  return request<AcknowledgeAlertsResponse>('/api/budgets/alerts/acknowledge-all', {
    method: 'POST',
  });
}

export async function fetchBudgetSummary(year: number, month: number): Promise<BudgetSummaryResponse> {
  return request<BudgetSummaryResponse>(
    `/api/budgets/summary${qs({ year, month })}`,
  );
}

// Reports

export async function fetchMonthlyReport(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
  accountId?: string,
): Promise<MonthlyReportResponse> {
  const params: Record<string, unknown> = {
    start_year: startYear,
    start_month: startMonth,
    end_year: endYear,
    end_month: endMonth,
  };
  if (accountId) params.account_id = accountId;
  return request<MonthlyReportResponse>(`/api/reports/monthly${qs(params)}`);
}

export async function fetchCategoryBreakdown(
  startDate: string,
  endDate: string,
): Promise<CategoryBreakdownResponse> {
  return request<CategoryBreakdownResponse>(
    `/api/reports/category-breakdown${qs({ start_date: startDate, end_date: endDate })}`,
  );
}

export async function fetchTrends(months = 6): Promise<TrendsResponse> {
  return request<TrendsResponse>(`/api/reports/trends${qs({ months })}`);
}

// Accounts

export async function fetchAccountsWithBalance(): Promise<AccountWithBalance[]> {
  if (!(await isOnline())) {
    return (await getLocalAccounts()).map(localAccountToAccount);
  }
  return request<AccountWithBalance[]>('/api/accounts');
}

export async function fetchAccount(id: string): Promise<AccountWithBalance> {
  return request<AccountWithBalance>(`/api/accounts/${id}`);
}

export async function createAccount(payload: CreateAccountRequest): Promise<Account> {
  const localId = uuid();
  const queueAndStore = async (): Promise<Account> => {
    await queueLocalMutation('create', 'account', localId, null, payload as Record<string, unknown>);
    const now = new Date().toISOString();
    const local: LocalAccount = {
      id: localId,
      server_id: null,
      name: payload.name,
      type: payload.type as 'income' | 'expense',
      account_kind: payload.account_kind ?? payload.type,
      parent_id: payload.parent_id ?? null,
      closing_day: payload.closing_day ?? null,
      due_day: payload.due_day ?? null,
      credit_limit: payload.credit_limit ?? null,
      balance: '0',
      transaction_count: 0,
      created_at: now,
      updated_at: now,
      synced: 0,
    };
    await upsertLocalAccount(local);
    return {
      id: localId,
      name: payload.name,
      type: payload.type as 'income' | 'expense',
      account_kind: local.account_kind,
      parent_id: local.parent_id,
      closing_day: local.closing_day,
      due_day: local.due_day,
      credit_limit: local.credit_limit,
      created_at: now,
    } as Account;
  };

  if (!(await isOnline())) return queueAndStore();
  try {
    const created = await request<Account>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await upsertLocalAccount({
      id: created.id,
      server_id: created.id,
      name: created.name,
      type: created.type,
      account_kind: created.account_kind,
      parent_id: created.parent_id ?? null,
      closing_day: created.closing_day ?? null,
      due_day: created.due_day ?? null,
      credit_limit: created.credit_limit ?? null,
      balance: '0',
      transaction_count: 0,
      created_at: created.created_at,
      updated_at: created.created_at,
      synced: 1,
    });
    return created;
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      return queueAndStore();
    }
    throw err;
  }
}

export async function updateAccount(id: string, payload: UpdateAccountRequest): Promise<Account> {
  const queueAndStore = async (): Promise<Account> => {
    await queueLocalMutation('update', 'account', id, id, payload as Record<string, unknown>);
    const rows = await getLocalAccounts();
    const existing = rows.find((a) => a.id === id || a.server_id === id);
    if (existing) {
      const next: LocalAccount = {
        ...existing,
        name: payload.name,
        type: payload.type as 'income' | 'expense',
        account_kind: payload.account_kind ?? existing.account_kind,
        parent_id: payload.parent_id ?? null,
        closing_day: payload.closing_day ?? null,
        due_day: payload.due_day ?? null,
        credit_limit: payload.credit_limit ?? null,
        updated_at: new Date().toISOString(),
      };
      await upsertLocalAccount(next);
      return localAccountToAccount(next);
    }
    throw new ApiError('Account not found locally', 404, 'Not Found');
  };

  if (!(await isOnline())) return queueAndStore();
  try {
    const updated = await request<Account>(`/api/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    const existing = (await getLocalAccounts()).find((a) => a.server_id === id || a.id === id);
    await upsertLocalAccount({
      id: updated.id,
      server_id: updated.id,
      name: updated.name,
      type: updated.type,
      account_kind: updated.account_kind,
      parent_id: updated.parent_id ?? null,
      closing_day: updated.closing_day ?? null,
      due_day: updated.due_day ?? null,
      credit_limit: updated.credit_limit ?? null,
      balance: existing?.balance ?? '0',
      transaction_count: existing?.transaction_count ?? 0,
      created_at: updated.created_at,
      updated_at: updated.created_at,
      synced: 1,
    });
    return updated;
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      return queueAndStore();
    }
    throw err;
  }
}

export async function deleteAccount(id: string): Promise<void> {
  const queueAndDelete = async () => {
    await queueLocalMutation('delete', 'account', id, id, {});
    await deleteLocalAccount(id);
  };

  if (!(await isOnline())) {
    await queueAndDelete();
    return;
  }
  try {
    await request<void>(`/api/accounts/${id}`, { method: 'DELETE' });
    await deleteLocalAccount(id);
  } catch (err) {
    if (isNetworkError(err)) {
      markServerUnavailable();
      await queueAndDelete();
      return;
    }
    throw err;
  }
}


// Credit cards

export async function fetchCreditCards(): Promise<CardOverview[]> {
  return request<CardOverview[]>('/api/credit-cards');
}

export async function fetchCard(id: string): Promise<CardOverview> {
  return request<CardOverview>(`/api/credit-cards/${id}`);
}

export async function fetchCardBills(id: string): Promise<CardBill[]> {
  return request<CardBill[]>(`/api/credit-cards/${id}/bills`);
}

export async function createCardPurchase(
  id: string,
  payload: CreateCardPurchaseRequest,
): Promise<Transaction> {
  return request<Transaction>(`/api/credit-cards/${id}/purchases`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function payCardBill(
  id: string,
  billId: string,
  payload: PayCardBillRequest,
): Promise<PayCardBillResponse> {
  return request<PayCardBillResponse>(`/api/credit-cards/${id}/bills/${billId}/pay`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function anticipateInstallments(
  id: string,
  payload: AnticipateInstallmentsRequest,
): Promise<AnticipateInstallmentsResponse> {
  return request<AnticipateInstallmentsResponse>(`/api/credit-cards/${id}/anticipate`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Installments

export async function fetchInstallmentPlans(): Promise<InstallmentPlan[]> {
  return request<InstallmentPlan[]>('/api/installments');
}

export async function fetchInstallmentPlan(id: string): Promise<InstallmentPlanDetail> {
  return request<InstallmentPlanDetail>(`/api/installments/${id}`);
}

export async function createInstallmentPlan(
  payload: CreateInstallmentPlanRequest,
): Promise<InstallmentPlan> {
  return request<InstallmentPlan>('/api/installments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteInstallmentPlan(id: string): Promise<void> {
  return request<void>(`/api/installments/${id}`, { method: 'DELETE' });
}

export async function generateInstallments(id: string): Promise<GenerateInstallmentsResponse> {
  return request<GenerateInstallmentsResponse>(`/api/installments/${id}/generate`, {
    method: 'POST',
  });
}

export async function payInstallment(id: string, number: number): Promise<PayInstallmentResponse> {
  return request<PayInstallmentResponse>(`/api/installments/${id}/installment/${number}/pay`, {
    method: 'POST',
  });
}

// Ledger

export async function fetchLedgerTransactions(): Promise<LedgerTransaction[]> {
  return request<LedgerTransaction[]>('/api/ledger/transactions');
}

export async function createLedgerTransaction(
  payload: CreateLedgerTransactionRequest,
): Promise<CreateLedgerTransactionResponse> {
  return request<CreateLedgerTransactionResponse>('/api/ledger/transactions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function migrateSingleToDouble(): Promise<MigrationResponse> {
  return request<MigrationResponse>('/api/migrate/single-to-double', {
    method: 'POST',
  });
}


// Reconciliation

export interface ReconciliationHistoryItem {
  id: string;
  statement_name: string;
  uploaded_at: string;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  status: string;
}

export async function uploadReconciliation(
  payload: ReconciliationUploadRequest,
): Promise<ReconciliationUploadResponse> {
  return request<ReconciliationUploadResponse>('/api/reconciliation', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Uploads a raw CSV/OFX file to the reconciliation endpoint via multipart/form-data. */
export async function uploadReconciliationFile(
  file: File,
  options?: {
    statementName?: string;
    format?: 'csv' | 'ofx';
    autoCreateUnmatched?: boolean;
  },
): Promise<ReconciliationUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  if (options?.statementName) form.append('statement_name', options.statementName);
  if (options?.format) form.append('format', options.format);
  if (options?.autoCreateUnmatched !== undefined) {
    form.append('auto_create_unmatched', String(options.autoCreateUnmatched));
  }
  return request<ReconciliationUploadResponse>('/api/reconciliation/upload', {
    method: 'POST',
    body: form,
  });
}

export async function fetchReconciliationHistory(): Promise<{ items: ReconciliationHistoryItem[] }> {
  return request<{ items: ReconciliationHistoryItem[] }>('/api/reconciliation/history');
}

// Receipts

export async function scanReceipt(qrData: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/receipts/scan', {
    method: 'POST',
    body: JSON.stringify({ qr_data: qrData } satisfies ScanRequest),
  });
}

/** Sends raw OCR text to the backend for structured receipt parsing. */
export async function scanReceiptOcr(rawText: string): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>('/api/receipts/ocr', {
    method: 'POST',
    body: JSON.stringify({ raw_text: rawText } satisfies OcrRequest),
  });
}

export async function saveReceipt(payload: SaveReceiptRequest): Promise<{ id: string; store_id: string }> {
  return request<{ id: string; store_id: string }>('/api/receipts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchReceipts(
  page = 0,
  pageSize = 50,
): Promise<{ items: unknown[]; page: number; page_size: number; items_by_receipt?: unknown[] }> {
  const query = qs({ page, page_size: pageSize });
  return request<{ items: unknown[]; page: number; page_size: number; items_by_receipt?: unknown[] }>(
    `/api/receipts${query}`,
  );
}

export async function fetchPriceHistory(
  productId: string,
  months = 6,
): Promise<{ product_id: string; points: unknown[] }> {
  const query = qs({ product_id: productId, months });
  return request<{ product_id: string; points: unknown[] }>(`/api/receipts/price-history${query}`);
}

export async function mergeProducts(
  payload: MergeProductsRequest,
): Promise<{ target_id: string; source_id: string; status: string }> {
  return request<{ target_id: string; source_id: string; status: string }>(
    '/api/receipts/product/merge',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

// Audit (admin)

export interface AuditEvent {
  id: number;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export async function fetchAuditEvents(
  token: string | null,
  params?: { event_type?: string; page?: number; page_size?: number },
): Promise<{ items: AuditEvent[]; page: number; page_size: number }> {
  const query = qs(params as Record<string, unknown>);
  return request<{ items: AuditEvent[]; page: number; page_size: number }>(
    `/api/audit/events${query}`,
    {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    },
  );
}

