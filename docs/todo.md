# Next steps — commerce-integration

Ordered. Each states what "done" means.

## 1. The connector HTTP client

Nothing calls Business Central yet — the cursor and retry modules are the mechanisms, with no caller around them.

- [ ] `src/shared/bc-client.ts` — client-credentials token acquisition with refresh, correlation-id propagation, `Retry-After` handling via `nextDelayMs`, and the circuit breaker per endpoint group.
- [ ] Every response returns the provenance envelope. A breaker-open result is `degraded: true`, not an exception the caller can accidentally swallow.
- [ ] Tests against a stubbed fetch: a `429` with `Retry-After` waits the stated time; a `409` is not retried; an open breaker short-circuits without a request.

Done when: no code path can call Business Central without passing through this client.

## 2. Catalogue sync function

- [ ] Wire `buildDeltaQuery` / `advanceCursor` to the client and the platform projection.
- [ ] Assert `didNotAdvance` and stop rather than spin. With a correct predicate it cannot fire; if it does, the predicate or the server ordering is wrong.
- [ ] Persist the watermark only after the page is durably applied.

Done when: a full initial load and a steady-state delta run over the same code path, and an interrupted run resumes without loss or duplication.

## 3. Reconciliation job

- [ ] Cursor-paged content-hash comparison, repair, and a `corrections` metric.

Done when: deleting a row from the projection is repaired on the next pass and counted.

## 4. Outbox collector

- [ ] Poll the connector's `changeOutbox` API, publish to the topic, mark collected.
- [ ] Duplicate detection is on at the broker; the consumer still needs the event id for its own idempotency.

## 5. Raise the contract pin

- [ ] When `contracts-v1.1.0` ships with the stock feed, update `CONTRACT_PIN` and run `npm run contract:check`.

## Deferred deliberately

Price, availability, credit proxies and the order gateway are phase 2–3. API Management policies and Bicep deployment are phase 4 — nothing is deployed yet, and none of the infrastructure has been applied to a subscription.
