-- Layer 4 receipt scanner (NFC-e QR parsing, no OCR)

CREATE TABLE stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    cnpj TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES stores(id),
    transaction_id UUID,          -- link to ledger/simple transaction
    total_amount NUMERIC(12,2),
    receipt_date DATE,
    qr_data JSONB,                -- parsed NFC-e QR data
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_store ON receipts (store_id);
CREATE INDEX idx_receipts_date ON receipts (receipt_date DESC);

CREATE TABLE receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2),
    total_price NUMERIC(12,2),
    normalized_product_id UUID
);

CREATE INDEX idx_receipt_items_receipt ON receipt_items (receipt_id);

CREATE TABLE normalized_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_normalized_products_name ON normalized_products (name);

-- Link receipt items to normalized products
ALTER TABLE receipt_items
    ADD CONSTRAINT fk_receipt_items_product
    FOREIGN KEY (normalized_product_id) REFERENCES normalized_products(id) ON DELETE SET NULL;