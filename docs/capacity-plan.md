# Capacity notes

These are planning estimates, not measured production limits. The supported
deployment is a single Docker Compose stack for a personal or small shared
installation.

## Current local footprint

| Service | Approximate idle memory |
|---|---:|
| PostgreSQL | 60 MB |
| RabbitMQ | 150 MB |
| Backend | 30 MB |
| nginx frontend | 20 MB |
| Prometheus | 120 MB |
| Grafana | 80 MB |
| **Total** | **~460 MB** |

Actual usage depends on PostgreSQL cache size, Prometheus retention, dashboard
queries, and transaction volume. Measure the target host before sizing it.

## Scaling path

1. Keep the Compose deployment for a single user or small household.
2. Move PostgreSQL to a managed service when backup, failover, or connection
   capacity becomes the primary concern.
3. Add connection pooling before increasing API replicas.
4. Run the backend behind a load balancer only after sessions, secrets, logs,
   migrations, and RabbitMQ topology are managed independently of one instance.
5. Move browser assets to object storage/CDN only when the operational benefit
   justifies a separate deployment path.

## Likely bottlenecks

| Area | Signal | Next action |
|---|---|---|
| PostgreSQL connections | Pool acquisition timeouts | Tune the pool, then add PgBouncer or a managed proxy |
| Date-range reports | Rising P95/P99 latency | Use range predicates and inspect `EXPLAIN ANALYZE` |
| Prometheus storage | Growing TSDB volume | Set retention and move long-term metrics elsewhere |
| RabbitMQ availability | `pudim_rabbitmq_connected = 0` | Recover the broker; replay durable DB events if required |
| Host ports | Compose startup failures | Set the `*_PORT` variables in `.env` |

The Terraform configuration in `infra/` does not provision the complete
application stack; do not use its resource sizes as a production capacity plan.