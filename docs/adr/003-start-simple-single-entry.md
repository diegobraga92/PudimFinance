# ADR 003: Start with simple transactions

**Status:** Accepted
**Date:** 2026-07-24

## Context

A personal finance client delivers value as soon as it can record income and
expenses. Building a complete accounting ledger first would delay that feedback
and increase initial complexity.

## Decision

Start with a simple `transactions` model, then add ledger postings without
discarding the original transaction rows. The migration endpoint is
`POST /api/migrate/single-to-double`.

## Rationale

- CRUD and monthly summaries were useful before accounting features existed.
- Existing rows can be mapped to balanced ledger postings.
- Keeping the transaction table preserves compatibility with the original API and client.

## Current state

The repository now has both representations. New transaction writes post ledger
entries, while the transaction table remains the application-facing record for
many list/report paths. The migration endpoint is idempotent for legacy rows.