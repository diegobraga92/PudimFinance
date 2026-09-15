# ADR 009: API deprecation strategy

**Status:** Accepted
**Date:** 2026-08-06

## Context

The API currently uses unversioned `/api/...` paths. Future breaking changes
need a migration path that does not immediately break desktop, Android, or
browser clients.

## Decision

Treat current paths as implicit v1. Introduce a new prefix such as `/api/v2/...`
for breaking changes; additive changes remain on the current path.

Deprecated endpoints use:

- `Sunset` with the planned removal date;
- `Deprecation: true`; and
- `Link: <...>; rel="successor-version"` pointing to the replacement.

Provide at least six months between the first deprecation header and removal.

## Current scope

The backend currently attaches those headers to
`/api/ledger/transactions` with a sunset date of 2027-01-01. This is a policy
simulation: no `/api/v2` successor or post-sunset `410 Gone` response exists yet.

## Consequences

- Clients can discover a successor programmatically.
- OpenAPI remains the contract for both versions.
- Maintaining two versions temporarily increases route and test surface.

See [`docs/api-deprecation-policy.md`](../api-deprecation-policy.md).