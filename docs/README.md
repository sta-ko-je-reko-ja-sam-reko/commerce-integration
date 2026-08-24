# Design notes

| Document | Subject |
|---|---|
| [catalogue-paging.md](catalogue-paging.md) | The keyset resume predicate, and the two simpler versions that fail silently |

Decisions that govern the whole platform — the read-through versus projection split, catalogue scale, degradation modes, single-writer idempotency — live in [`commerce-platform/docs/adr`](https://github.com/sta-ko-je-reko-ja-sam-reko/commerce-platform/tree/main/docs/adr). This folder holds only what is specific to the integration layer.
