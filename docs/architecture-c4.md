# Architecture

The diagrams describe the current Compose deployment and the runtime boundaries
between the client, API, data stores, and observability services.

## Context

```mermaid
graph TB
    User[User] --> Client[PudimFinance client<br/>Tauri desktop/Android or browser]
    Client -->|HTTP /api| API[PudimFinance API]
    API -->|SQL| Postgres[(PostgreSQL)]
    API -->|AMQP| RabbitMQ[(RabbitMQ)]
    Prometheus[Prometheus] -->|scrape /metrics| API
    Grafana[Grafana] -->|PromQL| Prometheus
```

## Containers

```mermaid
graph LR
    subgraph Client
        SPA[Browser SPA<br/>nginx:80]
        Tauri[Tauri 2 app<br/>desktop + Android]
    end
    subgraph Backend
        API[Axum API<br/>:3000]
    end
    subgraph Data
        PG[(PostgreSQL<br/>:5432)]
        RMQ[(RabbitMQ<br/>:5672)]
    end
    subgraph Observability
        Prom[Prometheus<br/>:9090]
        Graf[Grafana<br/>:3001]
    end
    SPA -->|same-origin proxy| API
    Tauri -->|/api| API
    API --> PG
    API --> RMQ
    Prom -->|/metrics| API
    Graf --> Prom
```

## Backend components

```mermaid
graph TB
    Routes[Route handlers] --> Auth[JWT middleware]
    Auth --> Rate[Write-endpoint rate limiter]
    Routes --> Ledger[Ledger and transaction services]
    Routes --> Receipts[Receipt parsers]
    Routes --> Audit[Audit handlers]
    Ledger --> PG[(PostgreSQL)]
    Ledger --> Events[Event publisher]
    Events --> RMQ[(RabbitMQ)]
    Metrics[Prometheus recorder] --> Prom[/metrics/]
```

## Compose services

| Service | Image/source | Host port | Role |
|---|---|---:|---|
| `postgres` | `postgres:16-alpine` | 5432 | Primary data store |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | 5672, 15672 | Event broker and management UI |
| `backend` | `backend/Dockerfile` | 3000 | API, migrations, metrics |
| `web` | `desktop/Dockerfile.web` | 5173 | Browser SPA and same-origin proxy |
| `prometheus` | `prom/prometheus:v2.53.0` | 9090 | Metrics storage |
| `grafana` | `grafana/grafana:11.1.0` | 3001 | Provisioned dashboard |

The AWS Terraform directory is intentionally separate and currently provides
only a partial foundation. See [`../infra/README.md`](../infra/README.md).