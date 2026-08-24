import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeCursor, decodeCursor, buildDeltaQuery, buildResumePredicate,
  advanceCursor, didNotAdvance, MAX_PAGE_SIZE,
  type CatalogueCursor, type DeltaRow,
} from './cursor.ts';

const cursor: CatalogueCursor = { changedAt: '2026-08-24T10:15:30.123Z', lastNumber: 'ITEM-0999' };

test('a cursor survives a round trip', () => {
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
});

test('an unreadable or outdated cursor yields null rather than throwing', () => {
  const oldVersion = Buffer.from('v1|2026-08-24T10:15:30.123Z|ITEM-0999').toString('base64url');
  for (const bad of ['', 'not base64 !!', oldVersion,
                     Buffer.from('v2|not-a-date|X').toString('base64url'),
                     Buffer.from('v2|only-two').toString('base64url'), undefined, null]) {
    assert.equal(decodeCursor(bad), null, `expected null for ${String(bad)}`);
  }
});

test('the resume predicate is a composite keyset, not a bare comparison', () => {
  const predicate = buildResumePredicate(cursor);
  assert.equal(
    predicate,
    "changedAt gt 2026-08-24T10:15:30.123Z or (changedAt eq 2026-08-24T10:15:30.123Z and number gt 'ITEM-0999')",
  );
});

test('a quote in the item number cannot break out of the literal', () => {
  const predicate = buildResumePredicate({ changedAt: cursor.changedAt, lastNumber: "O'BRIEN-1" });
  assert.match(predicate, /number gt 'O''BRIEN-1'/);
});

test('a first run sends no filter and orders by the keyset', () => {
  const query = decodeURIComponent(buildDeltaQuery(null, 500));
  assert.doesNotMatch(query, /\$filter/);
  assert.match(query, /\$orderby=changedAt,number/);
});

test('page size is clamped to the contract cap', () => {
  assert.ok(decodeURIComponent(buildDeltaQuery(null, 99999)).endsWith(`$top=${MAX_PAGE_SIZE}`));
  assert.ok(decodeURIComponent(buildDeltaQuery(null, 0)).endsWith('$top=1'));
  assert.ok(decodeURIComponent(buildDeltaQuery(null, -5)).endsWith('$top=1'));
});

test('the cursor advances to the last row of the page', () => {
  const rows: DeltaRow[] = [
    { number: 'A', changedAt: '2026-08-24T10:15:30.123Z' },
    { number: 'B', changedAt: '2026-08-24T10:16:00.000Z' },
  ];
  assert.deepEqual(advanceCursor(rows, cursor), { changedAt: '2026-08-24T10:16:00.000Z', lastNumber: 'B' });
});

test('an empty page does not move the watermark', () => {
  assert.deepEqual(advanceCursor([], cursor), cursor);
  assert.equal(advanceCursor([], null), null);
});

/**
 * The scenario that made the earlier design fail: more rows share one millisecond than
 * fit in a page. This drives the real predicate against an in-memory server that sorts
 * and filters the way the keyset assumes.
 */
test('a bulk update spanning one millisecond is delivered exactly once', () => {
  const catalogue: DeltaRow[] = Array.from({ length: 2500 }, (_, i) => ({
    number: `ITEM-${String(i).padStart(5, '0')}`,
    changedAt: i < 1200 ? '2026-08-24T09:00:00.000Z' : '2026-08-24T09:00:00.001Z',
  })).sort((a, b) => a.changedAt.localeCompare(b.changedAt) || a.number.localeCompare(b.number));

  const serve = (position: CatalogueCursor | null, top: number): DeltaRow[] =>
    catalogue
      .filter((row) => !position
        || row.changedAt > position.changedAt
        || (row.changedAt === position.changedAt && row.number > position.lastNumber))
      .slice(0, top);

  const deliveries: string[] = [];
  let position: CatalogueCursor | null = null;
  for (let page = 0; page < 20; page += 1) {
    const rows = serve(position, MAX_PAGE_SIZE);
    if (rows.length === 0) break;
    deliveries.push(...rows.map((r) => r.number));
    const next = advanceCursor(rows, position);
    assert.equal(didNotAdvance(position, next), false, 'the feed must make forward progress on every page');
    position = next;
  }

  assert.equal(deliveries.length, catalogue.length, 'every row delivered');
  assert.equal(new Set(deliveries).size, catalogue.length, 'no row delivered twice');
  assert.deepEqual(deliveries, catalogue.map((r) => r.number), 'delivered in keyset order');
});

test('resuming mid-burst picks up exactly where it stopped', () => {
  const burst: DeltaRow[] = Array.from({ length: 5 }, (_, i) => ({
    number: `ITEM-${i}`, changedAt: '2026-08-24T09:00:00.000Z',
  }));
  const position: CatalogueCursor = { changedAt: '2026-08-24T09:00:00.000Z', lastNumber: 'ITEM-2' };
  const remaining = burst.filter((row) =>
    row.changedAt > position.changedAt
    || (row.changedAt === position.changedAt && row.number > position.lastNumber));
  assert.deepEqual(remaining.map((r) => r.number), ['ITEM-3', 'ITEM-4']);
});
