# commerce-integration

Azure integration layer between the [commerce platform](https://github.com/sta-ko-je-reko-ja-sam-reko/commerce-platform) and **Microsoft Dynamics 365 Business Central**.

This is the layer a group-level integration platform leaves behind when a business is carved out: the API façade, the event backbone, the canonical model and the orchestration that everything else quietly depended on.

## Components

| Concern | Implementation |
|---|---|
| API façade | API Management — partner keys, throttling, versioning, policies as code |
| Eventing | Service Bus topics with dead-letter queues and replay |
| Mapping | Functions holding the canonical model; no BC field names escape this boundary |
| Orchestration | Durable Functions for long-running flows (payment → credit → order → slot) |
| Batch and file | Data Factory for EDI, catalogue loads and reconciliation |
| Observability | Application Insights, end-to-end correlation IDs, KQL alerting |
| Infrastructure | Bicep, per-environment parameters, deployed from CI |

## Integration contract

| Flow | Direction | Mode |
|---|---|---|
| Items, attributes, media, assortment | BC → platform | Event + nightly reconcile |
| List prices, price groups, campaigns | BC → platform | Event + reconcile |
| Customer-specific / contract price | platform → BC | Read-through, cart and authenticated PDP |
| Availability by location and date | platform → BC | Read-through at cart and checkout |
| Credit limit and blocked status | platform → BC | Read-through at checkout, hard gate |
| Order and quote creation | platform → BC | Async, idempotency key, staged outbox |
| Order status, shipment, invoice | BC → platform | Event → read model |
| Customer and ship-to master | BC → platform | Event; the platform proposes, never writes master |

## Design rules

- **Nothing point-to-point.** Every flow passes the façade or the broker, so it can be observed, throttled and replayed.
- **No outbound HTTP inside a BC posting transaction.** BC stages the intent; this layer ships it.
- **Contracts are versioned artefacts.** Specs are published on release; the AL extension pins a version and fails its own pipeline on drift.
- **Staleness budgets are written down per field.** Stock at ±15 minutes is fine on a listing and unacceptable at checkout.
- **Degradation is a requirement, not an incident.** BC unavailable means browse works, price shows on request, orders queue, checkout blocks honestly.

## Layout

```
src/catalogue/   keyset paging for the delta feed, with tests
src/shared/      Retry-After handling, bounded backoff, circuit breaker, with tests
infra/bicep/     Service Bus topology and observability, per environment
scripts/         contract pin check, run in CI
docs/            design notes specific to this layer
CONTRACT_PIN     the commerce-platform contract release this repository is built against
```

## Contract pin

`CONTRACT_PIN` names the contract release this repository is built against. CI fetches that release and asserts the properties this codebase depends on — the bulk line cap it chunks baskets at, the page cap it clamps to, the required idempotency header. A contract that moves under this repository fails its build rather than a request at runtime.

## Status

Foundations. The two pieces the architecture hinges on are implemented and tested: [keyset paging](docs/catalogue-paging.md) for the catalogue feed, and throttle-aware retry with a circuit breaker. Mapping functions and orchestration follow.

## Licence

MIT
