-- Create pgcrypto extension for gen_random_uuid()
-- TODO: Clean all experimental migrations and start from scratch on 0.1.0
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    parent_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    icon TEXT,
    color TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_type ON categories (type);

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_date ON transactions (date DESC);
CREATE INDEX idx_transactions_category ON transactions (category_id);
CREATE INDEX idx_transactions_type ON transactions (type);

INSERT INTO categories (id, name, type, icon, color) VALUES
    (gen_random_uuid(), 'Salary', 'income', 'briefcase', '#22c55e'),
    (gen_random_uuid(), 'Freelance', 'income', 'laptop', '#16a34a'),
    (gen_random_uuid(), 'Investments', 'income', 'trending-up', '#15803d'),
    (gen_random_uuid(), 'Gifts Received', 'income', 'gift', '#a3e635'),
    (gen_random_uuid(), 'Other Income', 'income', 'plus-circle', '#86efac');

INSERT INTO categories (id, name, type, icon, color) VALUES
    (gen_random_uuid(), 'Food & Groceries', 'expense', 'shopping-cart', '#ef4444'),
    (gen_random_uuid(), 'Housing', 'expense', 'home', '#dc2626'),
    (gen_random_uuid(), 'Transportation', 'expense', 'car', '#b91c1c'),
    (gen_random_uuid(), 'Utilities', 'expense', 'zap', '#f97316'),
    (gen_random_uuid(), 'Entertainment', 'expense', 'film', '#eab308'),
    (gen_random_uuid(), 'Healthcare', 'expense', 'heart', '#ec4899'),
    (gen_random_uuid(), 'Education', 'expense', 'book', '#8b5cf6'),
    (gen_random_uuid(), 'Shopping', 'expense', 'shopping-bag', '#6366f1'),
    (gen_random_uuid(), 'Travel', 'expense', 'plane', '#3b82f6'),
    (gen_random_uuid(), 'Subscriptions', 'expense', 'repeat', '#06b6d4'),
    (gen_random_uuid(), 'Insurance', 'expense', 'shield', '#14b8a6'),
    (gen_random_uuid(), 'Gifts Given', 'expense', 'gift', '#84cc16'),
    (gen_random_uuid(), 'Miscellaneous', 'expense', 'more-horizontal', '#6b7280');
