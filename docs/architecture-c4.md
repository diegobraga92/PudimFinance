# Architecture — C4 Model

> C4 model diagrams for PudimFinance (Context, Container, Component).
> Layer 4 final documentation.

---

## Level 1 — Context

```mermaid
graph TB
    User[User] --> Client[PudimFinance Client<br/>desktop + Android app, or browser]
    Client -->|HTTPS /api| API[PudimFinance API]
    API -->|SQL| Postgres[(PostgreSQL)]
    API -->|AMQP| RabbitMQ[(RabbitMQ)]
    API -->|HTTP scrape| Prometheus[Prometheus]
    Prometheus -->|scrape targets| API
    Grafana[Grafana] -->|query| Prometheus
```

---

## Level 2 — Container

```mermaid
graph LR
    subgraph Client
        SPA[Web client<br/>desktop/ SPA · nginx:80]
        TauriApp[Tauri 2 app<br/>desktop + Android]
    end
    subgraph Backend
        Axum[Axum Server<br/>:3000]
    end
    subgraph Data
        PG[(PostgreSQL<br/>:5432)]
        RMQ[(RabbitMQ<br/>:5672)]
    end
    subgraph Observability
        Prom[Prometheus :9090]
        Graf[Grafana :3001]
    end
    SPA -->|/api, /health<br/>same-origin proxy| Axum
    TauriApp -->|/api, /health| Axum
    Axum -->|ledger CRUD + migrations| PG
    Axum -->|event publish| RMQ
    Prom -->|/metrics scrape| Axum
    Graf -->|PromQL| Prom
```

---

## Level 3 — Component (Backend)

```mermaid
graph TB
    subgraph Backend Components
        Routes[Routes]
        AuthMW[Auth Middleware]
        RateLimit[Rate Limiter]
        Ledger[Ledger Engine]
        Receipts[Receipt Scanner]
        Events[Event Publisher]
        Audit[Audit Handler]
        Metrics[Prometheus Metrics]
    end
    Routes --> AuthMW
    AuthMW --> RateLimit
    Routes --> Ledger
    Routes --> Receipts
    Routes --> Audit
    Ledger --> Events
    Events -->|deadpool-lapin| RMQ[(RabbitMQ)]
    Ledger -->|sqlx| PG[(PostgreSQL)]
    Receipts -->|NFC-e QR parse| ReceiptEngine[receipt_scanner]
    Metrics -->|render| Prom[/metrics/]
```

---

## Deployment (Docker Compose Services)

| Service | Image | Port(s) | Purpose |
|---------|-------|---------|---------|
| `postgres` | postgres:16-alpine | 5432 | Primary data store |
| `rabbitmq` | rabbitmq:3.13-management | 5672, 15672 | Event broker |
| `backend` | local (rust) | 3000 | Axum API + metrics |
| `web` | local (nginx + `desktop/` build) | 5173→80 | Client SPA served to browsers; proxies `/api` + `/health` to the backend |
| `prometheus` | prom/prometheus:v2.53 | 9090 | Metrics collection |
| `grafana` | grafana/grafana:11.1 | 3001 | Dashboards |

---

## Key Dependencies

- **Axum** — HTTP framework
- **sqlx** — async PostgreSQL (runtime-tokio, tls-rustls)
- **lapin + deadpool-lapin** — AMQP client for event publishing
- **jsonwebtoken + argon2** — auth
- **metrics + metrics-exporter-prometheus** — observability
- **utoipa** — OpenAPI generation
- **recharts** — client charts
- **Tauri 2 + React/Vite/Tailwind** — desktop + Android client (the same frontend is also served as the browser client)
