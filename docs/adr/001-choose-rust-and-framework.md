# ADR 001: Rust backend and Axum

**Status:** Accepted

## Context

The backend handles financial records, PostgreSQL transactions, authentication,
RabbitMQ publication, and OpenTelemetry-compatible tracing. The implementation
needs explicit error handling, safe concurrency, and a mature async ecosystem.

## Decision

Use Rust 2021 with:

- Tokio for asynchronous execution;
- Axum and Tower for HTTP and middleware;
- SQLx for PostgreSQL access and migrations;
- Lapin/deadpool-lapin for RabbitMQ;
- `anyhow` plus typed response handling for errors; and
- `tracing`/OpenTelemetry for observability.

## Rationale

Rust's ownership and type systems prevent data races and make nullable and
fallible values explicit. Tokio, Axum, SQLx, and Lapin cover the required
integration points without a garbage-collected runtime.

## Tradeoffs

- Compile times and the learning curve are higher than in Go or Node.js.
- The async ecosystem is smaller than the Java/.NET ecosystems.
- Compile-time guarantees do not replace database constraints or runtime validation.

## Consequences

The backend and the Tauri core share Rust tooling (`cargo fmt`, Clippy, tests,
and cargo-audit). The frontend remains TypeScript and communicates through the
generated OpenAPI contract.