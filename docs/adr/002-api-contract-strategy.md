# ADR 002: Code-first OpenAPI contract

**Status:** Accepted

## Context

The Rust API and TypeScript client share many UUID, money, date, and pagination
schemas. A separate handwritten specification would duplicate these definitions
and could drift from handler behavior.

## Decision

Generate OpenAPI from Rust `utoipa` annotations. The committed artifact is
`api/openapi/openapi.json`; TypeScript definitions are generated from that file
with `openapi-typescript`.

## Workflow

1. Annotate handlers with `#[utoipa::path]` and public models with `ToSchema`.
2. Register routes and schemas in `backend/src/openapi.rs`.
3. Generate the contract:

   ```bash
   cd backend
   cargo run --bin gen-openapi > ../api/openapi/openapi.json
   ```

4. Generate client types:

   ```bash
   cd desktop
   npm run generate-types
   ```

Backend CI compares generated output with the committed JSON. The client build
uses the generated `desktop/src/lib/api-types.ts` file.

## Consequences

- Rust annotations are the implementation-side source of truth.
- The committed JSON is reviewable and consumable by external clients.
- API design is coupled to Rust code rather than a separate design-first file.
- New major API versions can be represented by additional route/schema groups when needed.