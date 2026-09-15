# API versioning and deprecation

The current API is an implicit v1. Existing paths such as `/api/transactions`
and `/api/ledger/transactions` remain stable unless a breaking change requires a
new version.

## Policy

- Additive fields and endpoints do not require a new version.
- Breaking changes use a new prefix such as `/api/v2/...`.
- A deprecated path remains available during a notice period and sends
  `Sunset`, `Deprecation`, and `Link` headers.
- Removal occurs only after the published sunset date and at least six months of
  notice.

## Current implementation

The backend currently applies deprecation headers to
`/api/ledger/transactions` as a policy simulation:

```http
Sunset: Sun, 01 Jan 2027 00:00:00 GMT
Deprecation: true
Link: </api/v2/ledger/transactions>; rel="successor-version"
```

There is currently no `/api/v2` route and the simulated endpoint does not yet
return `410 Gone` after the sunset date. The middleware is a compatibility test
of the header policy, not a complete version migration.

## Introducing a breaking version

1. Add the new route and schemas to the OpenAPI document.
2. Keep the existing route unchanged.
3. Add the deprecation headers to the old route with a concrete sunset date.
4. Update generated client types and documentation.
5. Remove the old route only after the notice period and a migration check.

See [ADR 009](adr/009-api-deprecation-strategy.md) and [ADR 002](adr/002-api-contract-strategy.md).