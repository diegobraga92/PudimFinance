-- 014 Receipt sources, store deduplication and price-query indexes.
--
-- The receipts UI grew from a scanner into a price-tracking database, which
-- needs three things the original schema did not have: where a receipt came
-- from, one row per store, and an index for per-product price lookups.

-- 1. Receipt source: 'nfce' when parsed from an NFC-e QR code, 'ocr' when read
--    from a photo. Rows saved before this migration keep NULL — unknown is
--    shown as such instead of being guessed.
ALTER TABLE receipts ADD COLUMN source TEXT;
ALTER TABLE receipts ADD CONSTRAINT chk_receipts_source
    CHECK (source IS NULL OR source IN ('nfce', 'ocr'));

-- 2. Store deduplication. `save_receipt` inserted a store with a freshly
--    generated UUID and `ON CONFLICT DO NOTHING`, which had no constraint to
--    conflict on: every saved receipt added a new store row. Repoint the
--    receipts of each duplicate group to the oldest row and drop the extras.
WITH ranked AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
               PARTITION BY COALESCE(cnpj, lower(name))
               ORDER BY created_at, id
           ) AS keep_id
    FROM stores
)
UPDATE receipts r
SET store_id = ranked.keep_id
FROM ranked
WHERE r.store_id = ranked.id
  AND ranked.id <> ranked.keep_id;

WITH ranked AS (
    SELECT id,
           FIRST_VALUE(id) OVER (
               PARTITION BY COALESCE(cnpj, lower(name))
               ORDER BY created_at, id
           ) AS keep_id
    FROM stores
)
DELETE FROM stores s
USING ranked
WHERE s.id = ranked.id
  AND ranked.id <> ranked.keep_id;

-- Partial unique indexes make the upsert path idempotent: one store per CNPJ,
-- and one per name when no CNPJ is known.
CREATE UNIQUE INDEX uq_stores_cnpj ON stores (cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX uq_stores_name ON stores (lower(name)) WHERE cnpj IS NULL;

-- 3. Price history walks items by normalized product, and the receipts list is
--    newest-first.
CREATE INDEX IF NOT EXISTS idx_receipt_items_product
    ON receipt_items (normalized_product_id);
CREATE INDEX IF NOT EXISTS idx_receipts_scanned_at ON receipts (scanned_at DESC);
