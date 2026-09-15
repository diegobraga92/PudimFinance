//! Data models shared across all layers (API request/response and DB rows).

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

/// A transaction category (income or expense), optionally nested via `parent_id`.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct Category {
    /// Category ID.
    pub id: Uuid,
    /// Display name (e.g., "Food & Groceries").
    pub name: String,
    /// `income` or `expense`.
    pub r#type: String,
    /// Optional parent category for subcategories.
    pub parent_id: Option<Uuid>,
    /// Icon identifier used by the web/mobile UIs.
    pub icon: Option<String>,
    /// Hex color code (e.g., `#ef4444`).
    pub color: Option<String>,
    /// Created at.
    pub created_at: DateTime<Utc>,
    /// Updated at.
    pub updated_at: DateTime<Utc>,
}

/// Payload for creating a new category.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCategoryRequest {
    /// Display name (e.g., "Food & Groceries").
    pub name: String,
    /// `income` or `expense`.
    #[schema(example = "expense")]
    pub r#type: String,
    /// Optional parent category for subcategories.
    pub parent_id: Option<Uuid>,
    /// Icon identifier used by the web/mobile UIs.
    pub icon: Option<String>,
    /// Hex color code (e.g., `#ef4444`).
    pub color: Option<String>,
}

/// Payload for updating an existing category.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateCategoryRequest {
    /// Display name (e.g., "Food & Groceries").
    pub name: String,
    /// `income` or `expense`.
    #[schema(example = "expense")]
    pub r#type: String,
    /// Optional parent category for subcategories.
    pub parent_id: Option<Uuid>,
    /// Icon identifier used by the web/mobile UIs.
    pub icon: Option<String>,
    /// Hex color code (e.g., `#ef4444`).
    pub color: Option<String>,
}

/// A single income or expense transaction.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct Transaction {
    /// Transaction ID.
    pub id: Uuid,
    /// Human-readable description (e.g., "Lunch at Restaurante X").
    pub description: String,
    /// Monetary amount, always positive. `type` determines direction.
    pub amount: Decimal,
    /// `income` or `expense`.
    pub r#type: String,
    /// Category this transaction belongs to (nullable if category deleted).
    pub category_id: Option<Uuid>,
    /// Transaction date.
    pub date: NaiveDate,
    /// Free-form notes.
    pub notes: Option<String>,
    /// Installment plan this transaction belongs to (NULL for regular transactions).
    pub installment_plan_id: Option<Uuid>,
    /// Source account (payment method, e.g. a credit card) used for this
    /// transaction (NULL when unlinked).
    pub account_id: Option<Uuid>,
    /// Due date ("vencimento") of the credit-card bill that contains this
    /// purchase (NULL for non-card transactions or cards without a billing
    /// cycle).
    ///
    /// Derived on read for the transaction list so the UI can show which bill a
    /// purchase lands on; queries that do not select it leave it `null`.
    #[sqlx(default)]
    pub card_due_date: Option<NaiveDate>,
    /// Created at.
    pub created_at: DateTime<Utc>,
    /// Updated at.
    pub updated_at: DateTime<Utc>,
}

/// Payload for creating a new transaction.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateTransactionRequest {
    /// Human-readable description (e.g., "Lunch at Restaurante X").
    pub description: String,
    /// Monetary amount that must be greater than 0.
    #[schema(value_type = String, example = "150.00")]
    pub amount: Decimal,
    /// `income` or `expense`.
    #[schema(example = "expense")]
    pub r#type: String,
    /// Category this transaction belongs to.
    pub category_id: Option<Uuid>,
    /// Transaction date (ISO `YYYY-MM-DD`).
    #[schema(value_type = String, format = Date, example = "2026-04-08")]
    pub date: NaiveDate,
    /// Free-form notes.
    pub notes: Option<String>,
    /// Installment plan this transaction belongs to (optional).
    pub installment_plan_id: Option<Uuid>,
    /// Source account (payment method) for this transaction (optional).
    pub account_id: Option<Uuid>,
    /// Split this transaction into N monthly installments (2-60).
    /// When set, a plan is created and every installment is materialized as a
    /// dated expense, starting on `date`.
    #[schema(minimum = 2, maximum = 60)]
    pub installments: Option<u8>,
}

/// Payload for updating an existing transaction.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTransactionRequest {
    /// Human-readable description (e.g., "Lunch at Restaurante X").
    pub description: String,
    /// Monetary amount that must be greater than 0.
    #[schema(value_type = String, example = "150.00")]
    pub amount: Decimal,
    /// `income` or `expense`.
    #[schema(example = "expense")]
    pub r#type: String,
    /// Category this transaction belongs to.
    pub category_id: Option<Uuid>,
    /// Transaction date (ISO `YYYY-MM-DD`).
    #[schema(value_type = String, format = Date, example = "2026-04-08")]
    pub date: NaiveDate,
    /// Free-form notes.
    pub notes: Option<String>,
    /// Installment plan this transaction belongs to (optional).
    pub installment_plan_id: Option<Uuid>,
    /// Source account (payment method) for this transaction (optional).
    pub account_id: Option<Uuid>,
}

/// Query parameters for listing transactions.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TransactionListParams {
    /// Maximum number of rows to return (default 50, max 200).
    #[serde(default = "default_page_size")]
    #[schema(default = 50, minimum = 1, maximum = 200)]
    pub page_size: u32,
    /// Page offset (0-based).
    #[serde(default)]
    #[schema(default = 0, minimum = 0)]
    pub page: u32,
    /// Filter by category UUID.
    pub category_id: Option<Uuid>,
    /// Filter by `income` or `expense`.
    pub r#type: Option<String>,
    /// Filter by start date (inclusive, ISO `YYYY-MM-DD`).
    #[schema(value_type = String, format = Date)]
    pub start_date: Option<NaiveDate>,
    /// Filter by end date (inclusive, ISO `YYYY-MM-DD`).
    #[schema(value_type = String, format = Date)]
    pub end_date: Option<NaiveDate>,
    /// Filter by source account UUID.
    pub account_id: Option<Uuid>,
    /// Sort field (`date`, `description`, `amount`, `category`, or `account`).
    pub sort: Option<String>,
    /// Sort direction (`asc` or `desc`).
    pub order: Option<String>,
}

fn default_page_size() -> u32 {
    50
}

/// Response wrapper for paginated transaction lists.
#[derive(Debug, Serialize, ToSchema)]
pub struct TransactionListResponse {
    /// Returned items for this page.
    pub items: Vec<Transaction>,
    /// Total row count matching the filters (regardless of pagination).
    pub total: i64,
    /// Current page offset.
    pub page: u32,
    /// Page size used for this request.
    pub page_size: u32,
}

/// Per-category totals for the summary endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct CategorySummary {
    /// Category UUID (null for transactions without a category).
    pub category_id: Option<Uuid>,
    /// Category display name.
    pub category_name: Option<String>,
    /// Hex color code for the category.
    pub color: Option<String>,
    /// Icon identifier for the category.
    pub icon: Option<String>,
    /// Total amount for this category.
    #[schema(value_type = String)]
    pub total: Decimal,
}

/// Monthly summary response with income, expense, balance, and category breakdown.
#[derive(Debug, Serialize, ToSchema)]
pub struct SummaryResponse {
    /// Total income for the selected month (positive value).
    #[schema(value_type = String)]
    pub income_total: Decimal,
    /// Total expenses for the selected month (positive value).
    #[schema(value_type = String)]
    pub expense_total: Decimal,
    /// Balance = income − expense.
    #[schema(value_type = String)]
    pub balance: Decimal,
    /// Per-category *expense* breakdown for the month (income accounts are
    /// reported through `income_total`).
    pub by_category: Vec<CategorySummary>,
    /// Year used for the query.
    pub year: i32,
    /// Month used for the query (1-12).
    pub month: u32,
}

// Layer 2 budgets

/// A monthly budget limit for a category.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct Budget {
    /// Budget ID.
    pub id: Uuid,
    /// Category this budget applies to.
    pub category_id: Uuid,
    /// Month (1-12).
    pub month: i32,
    /// Year.
    pub year: i32,
    /// Maximum spend limit for the month.
    #[schema(value_type = String)]
    pub amount_limit: Decimal,
    /// Created at.
    pub created_at: DateTime<Utc>,
    /// Updated at.
    pub updated_at: DateTime<Utc>,
}

/// Budget joined with its category display info.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct BudgetWithCategory {
    /// Budget ID.
    pub id: Uuid,
    /// Category id this budget applies to. `null` means the overall monthly
    /// budget (a single spending limit for the whole month).
    pub category_id: Option<Uuid>,
    /// Category name (`null` for the overall budget).
    pub category_name: Option<String>,
    /// Category icon identifier.
    pub icon: Option<String>,
    /// Category hex color.
    pub color: Option<String>,
    /// Month (1-12).
    pub month: i32,
    /// Year.
    pub year: i32,
    /// Maximum spend limit for the month.
    #[schema(value_type = String)]
    pub amount_limit: Decimal,
}

/// Payload for creating or updating a budget (upsert).
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateBudgetRequest {
    /// Category this budget applies to (expense categories only). Omit `null`
    /// to set the overall monthly budget instead.
    pub category_id: Option<Uuid>,
    /// Month (1-12).
    #[schema(minimum = 1, maximum = 12)]
    pub month: i32,
    /// Year.
    pub year: i32,
    /// Maximum spend limit that must be greater than 0.
    #[schema(value_type = String, example = "500.00")]
    pub amount_limit: Decimal,
}

/// Response for a paginated/period budget list.
#[derive(Debug, Serialize, ToSchema)]
pub struct BudgetListResponse {
    /// Budgets for the selected period.
    pub items: Vec<BudgetWithCategory>,
    /// Month used for the query.
    pub month: i32,
    /// Year used for the query.
    pub year: i32,
}

/// Budget vs actual spending for a single budget.
#[derive(Debug, Serialize, ToSchema)]
pub struct BudgetSummaryItem {
    /// The budget itself (with category info).
    pub budget: BudgetWithCategory,
    /// Actual spending for the category in the month (from transactions).
    #[schema(value_type = String)]
    pub actual_spent: Decimal,
    /// Percentage of the limit used (0-100+, can exceed 100).
    #[schema(value_type = String)]
    pub percentage: Decimal,
    /// Remaining amount = condition. negative => over budget.
    #[schema(value_type = String)]
    pub remaining: Decimal,
}

/// Response for the budget summary endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct BudgetSummaryResponse {
    /// Per-budget spend vs limit (category budgets only).
    pub items: Vec<BudgetSummaryItem>,
    /// The overall monthly budget, when one is set. Its `actual_spent` is the
    /// month's total spending, not just the budgeted categories.
    pub overall: Option<BudgetSummaryItem>,
    /// Sum of all budget limits for the period.
    #[schema(value_type = String)]
    pub total_budgeted: Decimal,
    /// Sum of all actual spending for budgeted categories.
    #[schema(value_type = String)]
    pub total_spent: Decimal,
    /// Month used for the query.
    pub month: i32,
    /// Year used for the query.
    pub year: i32,
}

/// A single budget alert (triggered when spending crosses a threshold).
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct BudgetAlert {
    /// Alert ID.
    pub id: Uuid,
    /// Budget this alert belongs to.
    pub budget_id: Uuid,
    /// Denormalized category id (set at trigger time).
    pub category_id: Option<Uuid>,
    /// Category name (joined).
    pub category_name: String,
    /// Category icon identifier (joined).
    pub category_icon: Option<String>,
    /// Category hex color (joined).
    pub category_color: Option<String>,
    /// Budget amount limit (joined).
    #[schema(value_type = String)]
    pub amount_limit: Decimal,
    /// Actual spending when the alert triggered.
    #[schema(value_type = String)]
    pub actual_spent: Decimal,
    /// Threshold percentage that triggered this alert (e.g. 80.00).
    #[schema(value_type = String)]
    pub threshold: Decimal,
    /// Alert trigger timestamp.
    pub triggered_at: DateTime<Utc>,
    /// Whether the user acknowledged this alert.
    pub acknowledged: bool,
    /// Year of the budget period.
    pub year: i32,
    /// Month of the budget period (1-12).
    pub month: i32,
}

/// Response for the budget alerts listing endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct BudgetAlertListResponse {
    /// Alerts matching the filters, newest first.
    pub items: Vec<BudgetAlert>,
    /// Total count of unacknowledged alerts across all periods.
    pub unacknowledged_count: i64,
}

/// Response for the bulk acknowledge endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct AcknowledgeAlertsResponse {
    /// Number of alerts acknowledged.
    pub acknowledged: i64,
}

// Layer 4 installments (Parcelas)

/// Progress summary computed for an installment plan.
#[derive(Debug, Serialize, ToSchema)]
pub struct InstallmentProgress {
    /// Number of installments marked as paid.
    pub paid_count: i64,
    /// Number of installments still pending or generated.
    pub pending_count: i64,
    /// Total number of installments in the plan.
    pub total_count: i64,
    /// Sum of paid installment amounts.
    #[schema(value_type = String)]
    pub paid_amount: Decimal,
    /// Remaining amount to be paid.
    #[schema(value_type = String)]
    pub remaining_amount: Decimal,
}

/// An installment plan that splits a purchase into N monthly payments.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct InstallmentPlan {
    /// Plan ID.
    pub id: Uuid,
    /// Purchase description (e.g., "TV 55\" Samsung").
    pub description: String,
    /// Total purchase amount.
    #[schema(value_type = String)]
    pub total_amount: Decimal,
    /// Number of monthly installments.
    pub installments: i32,
    /// Value of each installment (total / installments).
    #[schema(value_type = String)]
    pub installment_amount: Decimal,
    /// Category this purchase belongs to (optional).
    pub category_id: Option<Uuid>,
    /// Category name (joined, optional).
    pub category_name: Option<String>,
    /// Category icon (joined, optional).
    pub category_icon: Option<String>,
    /// Category hex color (joined, optional).
    pub category_color: Option<String>,
    /// First installment due date.
    pub start_date: NaiveDate,
    /// Source account (payment method, e.g. a credit card) for this plan (optional).
    pub account_id: Option<Uuid>,
    /// Plan creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Computed progress (paid/pending/total).
    pub progress: InstallmentProgress,
}

/// Payload for creating a new installment plan.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateInstallmentPlanRequest {
    /// Purchase description.
    pub description: String,
    /// Total purchase amount (must be > 0).
    #[schema(value_type = String, example = "1200.00")]
    pub total_amount: Decimal,
    /// Number of installments (2-60).
    #[schema(minimum = 2, maximum = 60)]
    pub installments: i32,
    /// Optional expense category.
    pub category_id: Option<Uuid>,
    /// First installment due date.
    #[schema(value_type = String, format = Date)]
    pub start_date: NaiveDate,
    /// Source account (payment method, e.g. a credit card) for this plan (optional).
    pub account_id: Option<Uuid>,
}

/// A single installment row within a plan.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct InstallmentTransaction {
    /// Installment row ID.
    pub id: Uuid,
    /// Parent plan identifier.
    pub plan_id: Uuid,
    /// 1-based installment number.
    pub installment_number: i32,
    /// Due date for this installment.
    pub due_date: NaiveDate,
    /// Linked simple transaction id (NULL until generated/paid).
    pub transaction_id: Option<Uuid>,
    /// `pending`, `generated`, or `paid`.
    pub status: String,
    /// When this installment was anticipated (paid early), NULL otherwise.
    pub anticipated_at: Option<DateTime<Utc>>,
    /// Bill that absorbed the anticipated installment, NULL otherwise.
    pub anticipated_bill_id: Option<Uuid>,
}

/// Detail view of a plan including all its installment rows.
#[derive(Debug, Serialize, ToSchema)]
pub struct InstallmentPlanDetail {
    /// The plan header with progress.
    pub plan: InstallmentPlan,
    /// All installment rows, ordered by number.
    pub installments: Vec<InstallmentTransaction>,
}

/// Response for the installment generate endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct GenerateInstallmentsResponse {
    /// Number of new transactions created.
    pub generated: i64,
    /// Number of installments already generated (skipped).
    pub already_generated: i64,
}

/// Response for the pay endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct PayInstallmentResponse {
    /// The linked transaction (created if one didn't exist).
    pub transaction: Transaction,
    /// Whether a new transaction was created or an existing one reused.
    pub created: bool,
}

// Layer 4 credit cards (billing cycles and installment anticipation)

/// A single billing cycle ("fatura") for a credit card.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct CardBill {
    /// Bill ID.
    pub id: Uuid,
    /// Card account this bill belongs to.
    pub card_id: Uuid,
    /// First day of the billing cycle.
    #[schema(value_type = String, format = Date)]
    pub period_start: NaiveDate,
    /// Closing date of the billing cycle (fatura fecha).
    #[schema(value_type = String, format = Date)]
    pub period_end: NaiveDate,
    /// Payment deadline (vencimento).
    #[schema(value_type = String, format = Date)]
    pub due_date: NaiveDate,
    /// `open` or `paid`.
    pub status: String,
    /// Total amount paid toward this bill.
    #[schema(value_type = String)]
    pub paid_amount: Decimal,
    /// When the bill was fully paid (NULL while open).
    pub paid_at: Option<DateTime<Utc>>,
    /// Total charges in the cycle, computed from card transactions in the period.
    #[schema(value_type = String)]
    pub total_amount: Decimal,
    /// Remaining amount = total − paid.
    #[schema(value_type = String)]
    pub remaining_amount: Decimal,
}

/// Summary of a credit-card account with its current open bill.
#[derive(Debug, Serialize, ToSchema)]
pub struct CardOverview {
    /// Card account id (an `accounts` row of type `liability`).
    pub id: Uuid,
    /// Card display name (e.g., "Nubank Credit Card").
    pub name: String,
    /// Closing day of the monthly billing cycle (1-31).
    pub closing_day: Option<i16>,
    /// Payment due day of the monthly billing cycle (1-31).
    pub due_day: Option<i16>,
    /// Credit limit.
    #[schema(value_type = Option<String>)]
    pub credit_limit: Option<Decimal>,
    /// Outstanding balance (signed, negative for liabilities).
    #[schema(value_type = String)]
    pub balance: Decimal,
    /// The current open bill, if any.
    pub current_bill: Option<CardBill>,
}

/// Payload for recording a purchase on a credit card.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCardPurchaseRequest {
    /// Human-readable description (e.g., "Lunch at Restaurante X").
    pub description: String,
    /// Monetary amount that must be greater than 0.
    #[schema(value_type = String, example = "150.00")]
    pub amount: Decimal,
    /// Expense category (defaults to Miscellaneous when omitted).
    pub category_id: Option<Uuid>,
    /// Purchase date (defaults to today, ISO `YYYY-MM-DD`).
    #[schema(value_type = Option<String>, format = Date)]
    pub date: Option<NaiveDate>,
    /// Free-form notes.
    pub notes: Option<String>,
    /// Installment plan this purchase belongs to (optional).
    pub installment_plan_id: Option<Uuid>,
}

/// Payload for paying a credit-card bill.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PayCardBillRequest {
    /// Amount to pay, which must be greater than 0. Defaults to the full remaining amount.
    #[schema(value_type = Option<String>, example = "250.00")]
    pub amount: Option<Decimal>,
    /// Asset account the payment comes from (defaults to "Cash").
    pub from_account_id: Option<Uuid>,
    /// Bill to pay (defaults to the oldest open bill).
    pub bill_id: Option<Uuid>,
}

/// Response from paying a credit-card bill.
#[derive(Debug, Serialize, ToSchema)]
pub struct PayCardBillResponse {
    /// The bill after the payment.
    pub bill: CardBill,
    /// Amount applied in this payment.
    #[schema(value_type = String)]
    pub amount_paid: Decimal,
    /// Remaining amount on the bill after this payment.
    #[schema(value_type = String)]
    pub remaining: Decimal,
}

/// Payload for anticipating (paying early) future installments on a card.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AnticipateInstallmentsRequest {
    /// Installment rows to anticipate (must belong to plans linked to the card).
    pub installment_ids: Vec<Uuid>,
    /// Discount as a percentage of the gross amount (0-100). Mutually exclusive
    /// with `discount_amount`.
    #[schema(value_type = Option<String>)]
    pub discount_percent: Option<Decimal>,
    /// Fixed discount amount. Mutually exclusive with `discount_percent`.
    #[schema(value_type = Option<String>)]
    pub discount_amount: Option<Decimal>,
}

/// Response from anticipating installments.
#[derive(Debug, Serialize, ToSchema)]
pub struct AnticipateInstallmentsResponse {
    /// The bill that absorbed the anticipated installments.
    pub bill_id: Uuid,
    /// Sum of the anticipated installments before discount.
    #[schema(value_type = String)]
    pub gross_amount: Decimal,
    /// Total discount applied.
    #[schema(value_type = String)]
    pub discount_amount: Decimal,
    /// Amount actually charged on the card (gross − discount).
    #[schema(value_type = String)]
    pub net_amount: Decimal,
    /// Number of installments anticipated.
    pub installments_anticipated: i64,
}

// Layer 2 reports

/// A single month's income/expense totals for the monthly report.
#[derive(Debug, Serialize, ToSchema)]
pub struct MonthlyReportItem {
    /// Year.
    pub year: i32,
    /// Month (1-12).
    pub month: i32,
    /// Total income for the month.
    #[schema(value_type = String)]
    pub income_total: Decimal,
    /// Total expenses for the month.
    #[schema(value_type = String)]
    pub expense_total: Decimal,
    /// Balance = income − expense.
    #[schema(value_type = String)]
    pub balance: Decimal,
}

/// Response for the monthly report.
#[derive(Debug, Serialize, ToSchema)]
pub struct MonthlyReportResponse {
    /// One entry per month in the requested range (chronological order).
    pub months: Vec<MonthlyReportItem>,
}

/// A single cash-flow period, grouped by day, week, or month.
#[derive(Debug, Serialize, ToSchema)]
pub struct CashFlowPoint {
    /// First date of the period. Weeks start on Monday; months start on day one.
    #[schema(value_type = String, format = Date)]
    pub period_start: NaiveDate,
    /// Total income for the period.
    #[schema(value_type = String)]
    pub income_total: Decimal,
    /// Total expenses for the period.
    #[schema(value_type = String)]
    pub expense_total: Decimal,
    /// Balance = income − expense.
    #[schema(value_type = String)]
    pub balance: Decimal,
}

/// Response for the dashboard cash-flow chart.
#[derive(Debug, Serialize, ToSchema)]
pub struct CashFlowResponse {
    /// Continuous cash-flow points in chronological order.
    pub points: Vec<CashFlowPoint>,
}

/// A single category's aggregated totals for the category-breakdown report.
#[derive(Debug, Serialize, ToSchema)]
pub struct CategoryBreakdownItem {
    /// Category UUID (null when uncategorised).
    pub category_id: Option<Uuid>,
    /// Category name.
    pub category_name: Option<String>,
    /// Hex color.
    pub color: Option<String>,
    /// Icon identifier.
    pub icon: Option<String>,
    /// Total amount for the category.
    #[schema(value_type = String)]
    pub total: Decimal,
    /// Percentage of all expenses for the period.
    #[schema(value_type = String)]
    pub percentage: Decimal,
    /// Number of transactions in this category.
    pub transaction_count: i64,
}

/// Response for the category-breakdown report.
#[derive(Debug, Serialize, ToSchema)]
pub struct CategoryBreakdownResponse {
    /// Per-category totals, sorted by total descending.
    pub categories: Vec<CategoryBreakdownItem>,
    /// Date range used (ISO dates).
    pub start_date: NaiveDate,
    /// Date range used (ISO dates).
    pub end_date: NaiveDate,
}

/// A single point in the trends report.
#[derive(Debug, Serialize, ToSchema)]
pub struct TrendPoint {
    /// Human-friendly label (e.g., "2026-04").
    pub month_label: String,
    /// Year.
    pub year: i32,
    /// Month (1-12).
    pub month: i32,
    /// Income for the month.
    #[schema(value_type = String)]
    pub income_total: Decimal,
    /// Expenses for the month.
    #[schema(value_type = String)]
    pub expense_total: Decimal,
    /// Net (income − expense) for the month.
    #[schema(value_type = String)]
    pub net: Decimal,
}

/// Response for the trends report.
#[derive(Debug, Serialize, ToSchema)]
pub struct TrendsResponse {
    /// Monthly points, chronological order.
    pub trends: Vec<TrendPoint>,
}

// Layer 3 double-entry ledger

/// A chart-of-accounts account.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ToSchema)]
pub struct Account {
    /// Account ID.
    pub id: Uuid,
    /// Account display name (e.g., "Cash").
    pub name: String,
    /// `asset`, `liability`, `equity`, `income`, or `expense`.
    pub r#type: String,
    /// User-facing kind such as `bank`, `cash`, `card`, `loan`, `investment`, or a
    /// system kind (`income`/`expense`/`equity`/`other`).
    pub account_kind: String,
    /// Stable icon identifier selected for this account.
    pub icon: Option<String>,
    /// Optional parent account.
    pub parent_id: Option<Uuid>,
    /// Closing day of the monthly billing cycle (credit cards only, 1-31).
    pub closing_day: Option<i16>,
    /// Payment due day of the monthly billing cycle (credit cards only, 1-31).
    pub due_day: Option<i16>,
    /// Credit limit (credit cards only).
    #[schema(value_type = Option<String>)]
    pub credit_limit: Option<Decimal>,
    /// Created at.
    pub created_at: DateTime<Utc>,
}

/// Payload for creating a new account.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateAccountRequest {
    /// Account display name (e.g., "Nubank Credit Card").
    pub name: String,
    /// `asset`, `liability`, `equity`, `income`, or `expense`. Ignored when
    /// `account_kind` is provided (the type is derived from the kind).
    #[schema(example = "liability")]
    pub r#type: String,
    /// User-facing kind. When set, the accounting `type` is derived from it
    /// (`bank`, `cash`, and `investment` map to asset, `card` and `loan` to liability).
    #[schema(example = "card")]
    pub account_kind: Option<String>,
    /// Stable icon identifier selected for this account.
    pub icon: Option<String>,
    /// Optional parent account.
    pub parent_id: Option<Uuid>,
    /// Closing day of the monthly billing cycle (credit cards only, 1-31).
    pub closing_day: Option<i16>,
    /// Payment due day of the monthly billing cycle (credit cards only, 1-31).
    pub due_day: Option<i16>,
    /// Credit limit (credit cards only).
    #[schema(value_type = Option<String>)]
    pub credit_limit: Option<Decimal>,
    /// Optional opening balance. It is posted against the balance-adjustment equity account.
    #[schema(value_type = Option<String>)]
    pub initial_balance: Option<Decimal>,
}

/// Payload for updating an existing account.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateAccountRequest {
    /// Account display name.
    pub name: String,
    /// `asset`, `liability`, `equity`, `income`, or `expense`. Ignored when
    /// `account_kind` is provided (the type is derived from the kind).
    #[schema(example = "liability")]
    pub r#type: String,
    /// User-facing kind. When set, the accounting `type` is derived from it.
    #[schema(example = "card")]
    pub account_kind: Option<String>,
    /// Stable icon identifier selected for this account.
    pub icon: Option<String>,
    /// Optional parent account.
    pub parent_id: Option<Uuid>,
    /// Closing day of the monthly billing cycle (credit cards only, 1-31).
    pub closing_day: Option<i16>,
    /// Payment due day of the monthly billing cycle (credit cards only, 1-31).
    pub due_day: Option<i16>,
    /// Credit limit (credit cards only).
    #[schema(value_type = Option<String>)]
    pub credit_limit: Option<Decimal>,
}

/// Account joined with its current computed balance from ledger entries.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct AccountWithBalance {
    /// Account ID.
    pub id: Uuid,
    /// Account display name (e.g., "Credit Card").
    pub name: String,
    /// `asset`, `liability`, `equity`, `income`, or `expense`.
    pub r#type: String,
    /// User-facing kind such as `bank`, `cash`, `card`, `loan`, `investment`, or a
    /// system kind (`income`/`expense`/`equity`/`other`).
    pub account_kind: String,
    /// Stable icon identifier selected for this account.
    pub icon: Option<String>,
    /// Optional parent account.
    pub parent_id: Option<Uuid>,
    /// Closing day of the monthly billing cycle (credit cards only, 1-31).
    pub closing_day: Option<i16>,
    /// Payment due day of the monthly billing cycle (credit cards only, 1-31).
    pub due_day: Option<i16>,
    /// Credit limit (credit cards only).
    #[schema(value_type = Option<String>)]
    pub credit_limit: Option<Decimal>,
    /// Created at.
    pub created_at: DateTime<Utc>,
    /// Balance = SUM(debit_amount) − SUM(credit_amount) across ledger entries.
    /// Positive for asset/expense accounts, negative for liability/income/equity
    /// under standard double-entry semantics.
    #[schema(value_type = String)]
    pub balance: Decimal,
    /// Total number of ledger entries posting to this account.
    pub transaction_count: i64,
}

/// Request to reconcile an account to a target balance without affecting
/// income, expenses, budgets, or reports.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AccountAdjustmentRequest {
    /// Desired display balance. Liability balances are expressed as positive debt.
    #[schema(value_type = String, example = "1250.00")]
    pub target_balance: Decimal,
    /// Date shown in the ledger entry.
    #[schema(value_type = String, format = Date)]
    pub date: NaiveDate,
    /// Optional human-readable explanation.
    pub description: Option<String>,
}

const ACCOUNT_TYPES: [&str; 5] = ["asset", "liability", "equity", "income", "expense"];

/// All valid user-facing account kinds (system kinds included).
const ACCOUNT_KINDS: [&str; 9] = [
    "bank",
    "cash",
    "card",
    "loan",
    "investment",
    "income",
    "expense",
    "equity",
    "other",
];

/// Returns true if `t` is a valid chart-of-accounts type.
pub fn is_valid_account_type(t: &str) -> bool {
    ACCOUNT_TYPES.contains(&t)
}

/// Returns true if `k` is a valid user-facing account kind.
pub fn is_valid_account_kind(k: &str) -> bool {
    ACCOUNT_KINDS.contains(&k)
}

/// Maps a user-facing account kind to its accounting type. Returns `None` for
/// `other` (caller keeps the explicitly provided type).
pub fn account_type_for_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "bank" | "cash" | "investment" => Some("asset"),
        "card" | "loan" => Some("liability"),
        "income" => Some("income"),
        "expense" => Some("expense"),
        "equity" => Some("equity"),
        _ => None,
    }
}

/// Payload for creating a ledger transaction (double-entry).
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateLedgerTransactionRequest {
    /// Human-readable description (e.g., "Groceries at Supermarket X").
    pub description: String,
    /// Transaction date.
    #[schema(value_type = String, format = Date, example = "2026-08-06")]
    pub date: NaiveDate,
    /// At least two entries. Debits must equal credits.
    pub entries: Vec<LedgerEntryRequest>,
    /// Optional idempotency key (unique per client request).
    pub idempotency_key: Option<String>,
}

/// A single debit/credit entry in a ledger transaction.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LedgerEntryRequest {
    /// Account this entry posts to.
    pub account_id: Uuid,
    /// Debit amount (positive, must be zero on credit entries).
    #[schema(value_type = String, example = "150.00")]
    pub debit_amount: Decimal,
    /// Credit amount (positive, must be zero on debit entries).
    #[schema(value_type = String, example = "0.00")]
    pub credit_amount: Decimal,
    /// Optional per-entry description.
    pub description: Option<String>,
}

/// A full ledger transaction with its entries.
#[derive(Debug, Serialize, ToSchema)]
pub struct LedgerTransaction {
    /// Unique transaction ID linking all entries.
    pub transaction_id: Uuid,
    /// Human-readable description.
    pub description: String,
    /// Calendar date.
    pub date: NaiveDate,
    /// All ledger entries, which must balance with debits equal to credits.
    pub entries: Vec<LedgerEntry>,
    /// Recorded timestamp.
    pub recorded_at: DateTime<Utc>,
}

/// A single ledger entry.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct LedgerEntry {
    /// Entry ID.
    pub id: Uuid,
    /// Transaction ID this entry belongs to.
    pub transaction_id: Uuid,
    /// Account ID this entry posts to.
    pub account_id: Uuid,
    /// Account display name (nullable, populated on list queries).
    pub account_name: Option<String>,
    /// Debit amount (always >= 0).
    #[schema(value_type = String)]
    pub debit_amount: Decimal,
    /// Credit amount (always >= 0).
    #[schema(value_type = String)]
    pub credit_amount: Decimal,
    /// Optional description.
    pub description: Option<String>,
    /// Recorded timestamp.
    pub recorded_at: DateTime<Utc>,
}

/// Response for creating a ledger transaction.
#[derive(Debug, Serialize, ToSchema)]
pub struct CreateLedgerTransactionResponse {
    /// The created ledger transaction.
    pub transaction: LedgerTransaction,
    /// HTTP status to return (201 or 200 for idempotent replay).
    pub status: u16,
}

/// Response for the migration endpoint.
#[derive(Debug, Serialize, ToSchema)]
pub struct MigrationResponse {
    /// Number of simple transactions examined.
    pub total_processed: i64,
    /// Number successfully migrated to double-entry.
    pub migrated: i64,
    /// Number already migrated (skipped).
    pub already_migrated: i64,
    /// Number that failed during migration.
    pub failed: i64,
}

// Layer 3 reconciliation

/// A single line item from an uploaded bank statement.
#[derive(Debug, Deserialize, ToSchema)]
pub struct StatementLine {
    /// Transaction date (ISO `YYYY-MM-DD`).
    #[schema(value_type = String, format = Date)]
    pub date: NaiveDate,
    /// Description from the bank statement.
    pub description: String,
    /// Signed amount (negative for expense/debit, positive for income/credit).
    #[schema(value_type = String)]
    pub amount: Decimal,
}

/// Payload containing all CSV statement lines for reconciliation.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ReconciliationUploadRequest {
    /// Name to identify this statement/reconciliation.
    pub statement_name: String,
    /// Statement lines parsed from the uploaded CSV.
    pub lines: Vec<StatementLine>,
    /// When true, unmatched rows are automatically converted into new expense
    /// transactions (category "Uncategorized"). Defaults to false.
    pub auto_create_unmatched: Option<bool>,
}

/// A reconciliation item result (matched or unmatched).
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct ReconciliationItem {
    /// Item ID.
    pub id: Uuid,
    /// Reconciliation ID this item belongs to.
    pub reconciliation_id: Uuid,
    /// Statement date.
    pub statement_date: NaiveDate,
    /// Statement description.
    pub statement_description: String,
    /// Signed statement amount.
    #[schema(value_type = String)]
    pub statement_amount: Decimal,
    /// `matched` or `unmatched`.
    pub match_status: String,
    /// Transaction ID if matched, otherwise NULL.
    pub matched_transaction_id: Option<Uuid>,
    /// Match confidence (0-100).
    pub confidence: Option<Decimal>,
}

/// Response from a reconciliation upload.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReconciliationUploadResponse {
    /// The reconciliation summary.
    pub reconciliation_id: Uuid,
    /// Total statement rows processed.
    pub total_rows: i64,
    /// Rows matched to existing transactions.
    pub matched_rows: i64,
    /// Rows that don't match any existing transaction.
    pub unmatched_rows: i64,
    /// Per-row match results.
    pub items: Vec<ReconciliationItem>,
}

// Offline sync

/// Request payload for pulling changes since a given timestamp.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SyncPullRequest {
    /// Only return rows with `updated_at` after this timestamp.
    pub last_synced_at: DateTime<Utc>,
}

/// Response with the entities changed since the client's last sync.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncPullResponse {
    /// All categories (or those changed since last sync).
    pub categories: Vec<Category>,
    /// Transactions changed since last sync.
    pub transactions: Vec<Transaction>,
    /// All accounts with their computed balances. Accounts have no
    /// `updated_at` column, so the whole list is sent on every pull.
    pub accounts: Vec<AccountWithBalance>,
    /// Server time. The client stores this as its next `last_synced_at`.
    pub server_time: DateTime<Utc>,
}

/// A single client-initiated mutation to apply on the server.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SyncOperation {
    /// `create`, `update`, or `delete`.
    pub operation_type: String,
    /// `transaction` or `category`.
    pub entity_type: String,
    /// Client-generated UUID used as an idempotency key.
    pub client_id: String,
    /// Server UUID for `update`/`delete` operations.
    pub server_id: Option<Uuid>,
    /// Request body (e.g. a CreateTransactionRequest) for create/update.
    pub payload: serde_json::Value,
}

/// Request payload with a batch of client mutations.
#[derive(Debug, Deserialize, ToSchema)]
pub struct SyncPushRequest {
    /// Operations to apply, in order.
    pub operations: Vec<SyncOperation>,
}

/// Result for a single pushed operation.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncOpResult {
    /// Echo of the client_id.
    pub client_id: String,
    /// `ok`, `conflict`, or `error`.
    pub status: String,
    /// Server-assigned UUID for creates.
    pub server_id: Option<Uuid>,
    /// Error message when status != ok.
    pub error: Option<String>,
}

/// Response with the results for each pushed operation.
#[derive(Debug, Serialize, ToSchema)]
pub struct SyncPushResponse {
    /// Per-operation results (same order as the request).
    pub results: Vec<SyncOpResult>,
}

/// Application-wide preferences (the single row of `app_settings`).
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct AppSettings {
    /// How credit-card purchases are dated in the dashboard, budgets and
    /// reports: `purchase_date` counts a purchase in the month it was made,
    /// `due_date` counts it in the month the bill ("fatura") is due.
    pub card_expense_dating: String,
}

/// Request payload for updating application settings.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateAppSettingsRequest {
    /// `purchase_date` or `due_date`.
    #[schema(example = "due_date")]
    pub card_expense_dating: String,
}

/// Request payload for saving a reviewed receipt (NFC-e or OCR).
#[derive(Debug, Deserialize, ToSchema)]
pub struct SaveReceiptBody {
    /// Store name (from the scan, or typed by the user).
    pub store_name: String,
    /// Store CNPJ when the source provides one.
    pub cnpj: Option<String>,
    /// Receipt date.
    pub date: NaiveDate,
    /// Receipt total.
    #[schema(value_type = String, example = "287.43")]
    pub total: Decimal,
    /// Where the data came from: `nfce` (QR code) or `ocr` (photo).
    pub source: Option<String>,
    /// Line items (at least one).
    pub items: Vec<NewReceiptItem>,
}

/// A line item sent when saving a receipt.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewReceiptItem {
    /// Item description (also the normalized product name).
    pub description: String,
    /// Quantity purchased (default 1).
    #[schema(value_type = Option<String>)]
    pub quantity: Option<Decimal>,
    /// Unit price.
    #[schema(value_type = Option<String>)]
    pub unit_price: Option<Decimal>,
    /// Line total (defaults to the unit price).
    #[schema(value_type = Option<String>)]
    pub total_price: Option<Decimal>,
}

/// A saved receipt with its store and item count.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct ReceiptSummary {
    /// Receipt ID.
    pub id: Uuid,
    /// Store ID (null when the receipt has no store).
    pub store_id: Option<Uuid>,
    /// Store name.
    pub store_name: Option<String>,
    /// Purchase date printed on the receipt.
    pub receipt_date: Option<NaiveDate>,
    /// When the receipt was scanned/saved (carries the time of day).
    pub scanned_at: DateTime<Utc>,
    /// Receipt total as stored by the backend.
    #[schema(value_type = Option<String>)]
    pub total_amount: Option<Decimal>,
    /// Number of line items.
    pub item_count: i64,
    /// `nfce`, `ocr`, or null for receipts saved before sources were tracked.
    pub source: Option<String>,
}

/// Paginated receipt list.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptListResponse {
    /// Receipts for this page (newest first).
    pub items: Vec<ReceiptSummary>,
    /// Total receipts matching the filters.
    pub total_count: i64,
    /// Page offset used.
    pub page: u32,
    /// Page size used.
    pub page_size: u32,
    /// Item rows for the receipts in `items`, so the UI can resolve products.
    pub items_by_receipt: Vec<ReceiptItemDetail>,
}

/// One line item of a saved receipt.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct ReceiptItemDetail {
    /// Item ID.
    pub id: Uuid,
    /// Receipt this item belongs to.
    pub receipt_id: Uuid,
    /// Description as printed on the receipt.
    pub description: String,
    /// How many were bought.
    #[schema(value_type = String)]
    pub quantity: Decimal,
    /// Price for one unit.
    #[schema(value_type = Option<String>)]
    pub unit_price: Option<Decimal>,
    /// Line total.
    #[schema(value_type = Option<String>)]
    pub total_price: Option<Decimal>,
    /// Normalized product id (price history is keyed by this).
    pub normalized_product_id: Option<Uuid>,
    /// Normalized product name, when the item is linked to a product.
    pub product_name: Option<String>,
}

/// A receipt with its items.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReceiptDetail {
    /// Receipt header.
    pub receipt: ReceiptSummary,
    /// Store CNPJ, when known.
    pub cnpj: Option<String>,
    /// Line items.
    pub items: Vec<ReceiptItemDetail>,
}

/// Request payload for updating a receipt item.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateReceiptItemRequest {
    /// New description (re-normalized as a product).
    pub description: String,
    /// New quantity.
    #[schema(value_type = Option<String>)]
    pub quantity: Option<Decimal>,
    /// New unit price.
    #[schema(value_type = Option<String>)]
    pub unit_price: Option<Decimal>,
    /// New line total (defaults to quantity × unit price).
    #[schema(value_type = Option<String>)]
    pub total_price: Option<Decimal>,
}

/// Headline receipt/price-tracking numbers for the Overview tab.
#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct ReceiptStats {
    /// Receipts on record.
    pub total_receipts: i64,
    /// Receipts dated in the requested month.
    pub receipts_this_month: i64,
    /// Sum of all receipt totals.
    #[schema(value_type = String)]
    pub total_spent: Decimal,
    /// Sum of receipt totals dated in the requested month.
    #[schema(value_type = String)]
    pub spent_this_month: Decimal,
    /// Distinct normalized products seen on receipts.
    pub items_tracked: i64,
    /// Recorded unit prices (the raw material of price history).
    pub price_records: i64,
    /// Distinct stores that issued receipts.
    pub store_count: i64,
    /// Oldest receipt date.
    pub first_receipt_date: Option<NaiveDate>,
    /// Newest receipt date.
    pub last_receipt_date: Option<NaiveDate>,
    /// First day of the month the month-scoped numbers refer to.
    pub month: NaiveDate,
}

/// A normalized product with its price statistics.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct ProductSummary {
    /// Normalized product ID.
    pub id: Uuid,
    /// Product name (the backend's normalized identity).
    pub name: String,
    /// Optional category label.
    pub category: Option<String>,
    /// Number of recorded prices.
    pub record_count: i64,
    /// Number of stores that sold it.
    pub store_count: i64,
    /// Most recent recorded unit price.
    #[schema(value_type = Option<String>)]
    pub latest_price: Option<Decimal>,
    /// The record before the latest one.
    #[schema(value_type = Option<String>)]
    pub previous_price: Option<Decimal>,
    /// Change from the previous record to the latest (null when there is no
    /// previous record to compare against).
    #[schema(value_type = Option<String>)]
    pub change_percentage: Option<Decimal>,
    /// Average of all recorded prices.
    #[schema(value_type = Option<String>)]
    pub average_price: Option<Decimal>,
    /// Cheapest recorded price.
    #[schema(value_type = Option<String>)]
    pub lowest_price: Option<Decimal>,
    /// Most expensive recorded price.
    #[schema(value_type = Option<String>)]
    pub highest_price: Option<Decimal>,
    /// Date of the latest record.
    pub last_seen: Option<NaiveDate>,
    /// Date of the first record.
    pub first_seen: Option<NaiveDate>,
}

/// Paginated product list.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProductListResponse {
    /// Products for this page.
    pub items: Vec<ProductSummary>,
    /// Total products matching the filters.
    pub total_count: i64,
    /// Page offset used.
    pub page: u32,
    /// Page size used.
    pub page_size: u32,
}

/// One recorded price for a product.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct ProductPriceRecord {
    /// Receipt the price came from.
    pub receipt_id: Uuid,
    /// Purchase date.
    pub date: Option<NaiveDate>,
    /// Store name.
    pub store_name: Option<String>,
    /// Store ID.
    pub store_id: Option<Uuid>,
    /// Unit price paid.
    #[schema(value_type = Option<String>)]
    pub price: Option<Decimal>,
    /// Quantity bought at that price.
    #[schema(value_type = String)]
    pub quantity: Decimal,
    /// Description as printed on the receipt.
    pub description: String,
}

/// Latest/average price for one product at one store.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct ProductStorePrice {
    /// Store ID.
    pub store_id: Option<Uuid>,
    /// Store name.
    pub store_name: Option<String>,
    /// Most recent price at this store.
    #[schema(value_type = Option<String>)]
    pub latest_price: Option<Decimal>,
    /// Previous price at this store.
    #[schema(value_type = Option<String>)]
    pub previous_price: Option<Decimal>,
    /// Change between the last two prices at this store.
    #[schema(value_type = Option<String>)]
    pub change_percentage: Option<Decimal>,
    /// Average price at this store.
    #[schema(value_type = Option<String>)]
    pub average_price: Option<Decimal>,
    /// Prices recorded at this store.
    pub record_count: i64,
    /// Date of the latest price at this store.
    pub last_date: Option<NaiveDate>,
}

/// Product price history: statistics, records and per-store comparison.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProductDetail {
    /// Product with its statistics.
    pub product: ProductSummary,
    /// Every recorded price, newest first.
    pub records: Vec<ProductPriceRecord>,
    /// Where the product was bought, cheapest latest price first.
    pub by_store: Vec<ProductStorePrice>,
}

/// A store with its receipt aggregates.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct StoreSummary {
    /// Store ID.
    pub id: Uuid,
    /// Store name.
    pub name: String,
    /// Store CNPJ, when known.
    pub cnpj: Option<String>,
    /// Receipts in the selected period.
    pub receipt_count: i64,
    /// Items in those receipts.
    pub item_count: i64,
    /// Spend in the selected period.
    #[schema(value_type = String)]
    pub total_spent: Decimal,
    /// First visit (all time).
    pub first_visit: Option<NaiveDate>,
    /// Latest visit (all time).
    pub last_visit: Option<NaiveDate>,
}

/// Paginated store list.
#[derive(Debug, Serialize, ToSchema)]
pub struct StoreListResponse {
    /// Stores for this page.
    pub items: Vec<StoreSummary>,
    /// Total stores matching the filters.
    pub total_count: i64,
    /// Page offset used.
    pub page: u32,
    /// Page size used.
    pub page_size: u32,
}

/// Spend per month at one store.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct StoreMonthlySpend {
    /// First day of the month.
    pub month: NaiveDate,
    /// Receipts that month.
    pub receipt_count: i64,
    /// Spend that month.
    #[schema(value_type = String)]
    pub total: Decimal,
}

/// Most purchased item at one store.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct StoreTopItem {
    /// Normalized product ID.
    pub product_id: Option<Uuid>,
    /// Item description.
    pub description: String,
    /// Total quantity bought.
    #[schema(value_type = String)]
    pub quantity: Decimal,
    /// How many times it was bought.
    pub purchase_count: i64,
    /// Total spent on it.
    #[schema(value_type = String)]
    pub total: Decimal,
}

/// Latest price of an item at one store.
#[derive(Debug, Clone, Serialize, FromRow, ToSchema)]
pub struct StoreItemPrice {
    /// Item description.
    pub description: String,
    /// Normalized product ID.
    pub normalized_product_id: Option<Uuid>,
    /// Most recent price at this store.
    #[schema(value_type = Option<String>)]
    pub latest_price: Option<Decimal>,
    /// Previous price at this store.
    #[schema(value_type = Option<String>)]
    pub previous_price: Option<Decimal>,
    /// Change between the last two prices.
    #[schema(value_type = Option<String>)]
    pub change_percentage: Option<Decimal>,
    /// Prices recorded for this item at this store.
    pub record_count: i64,
    /// Date of the latest price.
    pub last_date: Option<NaiveDate>,
}

/// Everything the store detail screen shows.
#[derive(Debug, Serialize, ToSchema)]
pub struct StoreDetail {
    /// Store with its all-time aggregates.
    pub store: StoreSummary,
    /// Spend per month (oldest first) for the chart.
    pub monthly_spend: Vec<StoreMonthlySpend>,
    /// Most purchased items.
    pub top_items: Vec<StoreTopItem>,
    /// Items with their latest price and change at this store.
    pub items: Vec<StoreItemPrice>,
    /// Latest receipts.
    pub recent_receipts: Vec<ReceiptSummary>,
}
