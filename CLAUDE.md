# commerce-integration

The Azure integration layer between the commerce platform and Business Central. TypeScript on Node 22, infrastructure in Bicep, no build step — Node strips types natively.

## Orientation

1. [`docs/implementation-plan.md`](docs/implementation-plan.md) — what this layer owns, and what is delivered
2. [`docs/todo.md`](docs/todo.md) — the next actions, ordered, each with a definition of done
3. [`docs/catalogue-paging.md`](docs/catalogue-paging.md) — **read before touching the catalogue feed.** Two simpler resume predicates both fail silently, and one of them shipped before a test caught it
4. The master plan and the architecture decisions live in [`commerce-platform`](https://github.com/sta-ko-je-reko-ja-sam-reko/commerce-platform)

## Setup on a fresh machine

```bash
npm ci
npm run contract:check     # fetches the pinned contract release and asserts it
npm run typecheck
npm test
```

Node 22+ (`.nvmrc`). Deploying infrastructure additionally needs the Azure CLI, but nothing is deployed yet.

## Rules that are not style preferences

- **`Retry-After` wins over computed backoff**, including when it exceeds the local ceiling. The ceiling bounds our impatience; the header is an instruction from the service, and retrying sooner extends the throttling.
- **A malformed `Retry-After` falls back to backoff**, never to "retry immediately".
- **Jitter is not decoration.** Without it, every worker throttled at the same moment retries at the same moment and reproduces the burst.
- **The breaker opens on a failure rate over a window**, not on a single failure, and recovers through a half-open probe. Opening on one failure and closing on one success oscillates and amplifies an outage.
- **Catalogue paging is `changedAt gt T or (changedAt eq T and number gt N)`.** Not `gt` alone — it skips every row sharing the boundary timestamp. Not `ge` alone — it stalls the feed permanently once a timestamp collision exceeds a page. Both failures are silent.
- **The tie-break is the item number, not the system id.** Keyset paging is correct only when the server's ordering and its comparison agree; that holds for a string key and not for a GUID.
- **No Business Central table, field or enum name escapes this repository.** That is the entire point of the layer.
- **Every write carries an idempotency key** stable across retries of the same business action.

## Typecheck is a separate gate for a reason

Node strips types rather than checking them, so a green test run proves nothing about types. `npm test` passing and `npm run typecheck` failing is a normal, expected combination — it has already happened once here.

## Contract pin

`CONTRACT_PIN` names the `commerce-platform` contract release this repository is built against. CI fetches it and asserts the properties this codebase depends on. Raising the pin is a deliberate act with a check that follows it, not a version bump.

## This is a public portfolio repository

No customer names, customer data, client-specific business rules, or material from client projects.
