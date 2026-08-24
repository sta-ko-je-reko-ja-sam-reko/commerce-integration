## What changed

<!-- One paragraph. What this does, not how. -->

## Contract impact

- [ ] `CONTRACT_PIN` unchanged
- [ ] Pin raised — the assertions in `scripts/check-contract-pin.mjs` still pass
- [ ] The consumed contract changed shape, and the mapping was updated to match

## Checks

- [ ] Every call into Business Central honours `Retry-After` and passes through the breaker
- [ ] Catalogue paging still uses the composite keyset predicate — not `gt`, not `ge`
- [ ] Writes carry an idempotency key that is stable across retries of the same business action
- [ ] Degraded responses are labelled rather than silently substituted
- [ ] No customer names, customer data or client-specific business rules
