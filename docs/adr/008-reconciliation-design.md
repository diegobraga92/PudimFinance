# ADR 008: Reconciliation design

**Status:** Accepted
**Date:** 2026-08-06

## Decision

Support bank statements as CSV/OFX uploads and match statement rows to existing
transactions using amount and date. The default date tolerance is ±1 day and the
amount comparison uses a one-cent tolerance.

Store each reconciliation run and each row in dedicated tables. Keep unmatched
rows visible for review; do not create transactions automatically.

## Rationale

Amount and date are predictable signals for personal bank statements. Automatic
creation could duplicate transactions, so unmatched rows require explicit user
action. Dedicated rows preserve an audit trail of each import.

## Current API

- `POST /api/reconciliation` accepts parsed JSON rows.
- `POST /api/reconciliation/upload` accepts CSV/OFX multipart uploads.
- `GET /api/reconciliation/history` lists previous runs.

Description similarity and automatic transaction creation are not implemented.