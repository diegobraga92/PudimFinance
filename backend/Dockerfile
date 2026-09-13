# Build stage
FROM rust:1.98-slim-bookworm AS builder

WORKDIR /app

# Install build dependencies for sqlx
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for dependency caching
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>/dev/null || true
RUN rm -rf src

# Now copy actual source
COPY src/ src/
COPY migrations/ migrations/

# Force rebuild with actual source (touch to bust cache)
RUN touch src/main.rs && cargo build --release

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/backend /app/backend
COPY --from=builder /app/migrations/ /app/migrations/

EXPOSE 3000

CMD ["/app/backend"]