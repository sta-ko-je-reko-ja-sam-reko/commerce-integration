# Catalogue paging

How a catalogue of tens of thousands of items is kept in step with Business Central, and why the resume predicate looks the way it does.

## The predicate

```
changedAt gt T or (changedAt eq T and number gt N)
```

ordered by `(changedAt, number)`, where `(T, N)` is the last row applied.

That is the entire mechanism. The rest of this document is why the two simpler things do not work, because both of them look correct and fail silently.

## Why not `changedAt gt T`

Many rows share a change timestamp. A bulk price update, a category re-assignment or an import writes thousands of items within the same millisecond.

If the previous page ended in the middle of such a group, resuming with `gt` skips every remaining row in it. Nothing errors. The projection simply never learns about those items, and the storefront serves their old price until something else happens to touch them.

## Why not `changedAt ge T` either

Resuming with `ge` re-reads the boundary timestamp, so nothing is skipped. Duplicates are harmless because the projection upserts.

It fails differently: if more rows share the timestamp than fit in one page, every page is the same page. The cursor never advances and the feed makes no forward progress — permanently, and quietly, because each request returns a full page of valid data.

This is not a theoretical edge. A page cap of 1000 and a bulk update touching 1200 items is enough, and at this catalogue size bulk updates of that shape are routine. An earlier version of this module used `ge`; the test `a bulk update spanning one millisecond is delivered exactly once` is the one that caught it, and it is why that test drives 2500 rows across a timestamp boundary rather than asserting on a handful.

## Why the tie-break is the item number, not the system id

Keyset pagination is correct only if the server's ordering and its `gt` comparison agree. For a string key that agreement is dependable. For a GUID it is not: SQL Server orders `uniqueidentifier` by a byte order that does not match the order the textual form suggests, so a client reasoning about "the id after this one" can reason wrongly.

The item number is unique, stable and a string. It costs nothing to use and removes the question.

## Consequences for the connector

`CMC API Item Delta` must order by `(changedAt, number)` and expose both columns. That ordering is not cosmetic — it is what makes this predicate an index seek instead of a scan, and what makes it correct at all.

## Consequences for callers

- An unreadable or outdated cursor decodes to `null`, which restarts the feed from the beginning. Slow, correct, unattended. Throwing would stall the feed until a human intervened.
- An empty page does not advance the watermark. Moving it on no evidence would skip whatever lands next at that timestamp.
- `didNotAdvance` is an assertion, not a recovery path. With a correct predicate it cannot fire; if it does, the predicate or the server ordering is wrong, and the caller must stop rather than spin.
