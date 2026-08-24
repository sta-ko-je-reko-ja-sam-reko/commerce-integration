/**
 * Keyset pagination for the catalogue delta feed.
 *
 * The platform contract exposes an opaque `cursor`. Business Central exposes an indexed
 * read ordered by `(changedAt, number)` and nothing else — deliberately, because paging
 * state has no business living inside a transactional system.
 *
 * This module is where the two meet, and the predicate below is the whole point of it.
 *
 * Why not `changedAt gt <watermark>`: many rows share a `changedAt`. A bulk price update
 * produces thousands within one millisecond. Resuming with `gt` skips every row that
 * shares the boundary timestamp with the last row of the previous page.
 *
 * Why not `changedAt ge <watermark>` either: it re-reads the boundary, which is safe, but
 * if more rows share that timestamp than fit in a page, every page is the same page and
 * the feed never advances. A catalogue of this size makes that certain, not theoretical.
 *
 * So the resume predicate is a composite keyset:
 *
 *     changedAt gt T or (changedAt eq T and number gt N)
 *
 * It is exact — no overlap, no skipping, no stall — and it stays an index seek.
 *
 * The tie-break column is the item number, not the system id. Correctness needs the
 * server's ordering and its `gt` comparison to agree, and that agreement is dependable
 * for a string key in a way it is not for a GUID, whose sort order in SQL Server is not
 * the order its textual form suggests.
 */

/** Largest page the contract permits (ADR 0003). */
export const MAX_PAGE_SIZE = 1000;

export interface CatalogueCursor {
  /** Change timestamp of the last row applied, ISO 8601. */
  changedAt: string;
  /** Item number of the last row applied at that timestamp. The keyset tie-break. */
  lastNumber: string;
}

export interface DeltaRow {
  number: string;
  changedAt: string;
}

const CURSOR_VERSION = 'v2';

/** Encodes a cursor as an opaque, URL-safe token. */
export function encodeCursor(cursor: CatalogueCursor): string {
  const payload = `${CURSOR_VERSION}|${cursor.changedAt}|${cursor.lastNumber}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decodes a cursor token.
 *
 * Returns null for anything unreadable — including a token from an older cursor version —
 * rather than throwing. Null means a full resync: slow, but correct and unattended.
 * Throwing would stall the feed until someone intervened.
 */
export function decodeCursor(token: string | undefined | null): CatalogueCursor | null {
  if (!token) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const parts = decoded.split('|');
  if (parts.length !== 3) return null;
  const [version, changedAt, lastNumber] = parts;
  if (version !== CURSOR_VERSION || !changedAt || !lastNumber) return null;
  if (Number.isNaN(Date.parse(changedAt))) return null;
  return { changedAt, lastNumber };
}

/** Escapes a value for an OData string literal. */
function odataString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Builds the composite keyset predicate that resumes exactly after the cursor.
 *
 * Changing this to a single `gt` on `changedAt` skips rows; changing it to `ge` stalls
 * the feed. Both failures are silent. The tests pin the shape.
 */
export function buildResumePredicate(cursor: CatalogueCursor): string {
  return `changedAt gt ${cursor.changedAt} or `
    + `(changedAt eq ${cursor.changedAt} and number gt ${odataString(cursor.lastNumber)})`;
}

/** Builds the full OData query for the connector's item delta feed. */
export function buildDeltaQuery(cursor: CatalogueCursor | null, pageSize: number): string {
  const capped = Math.min(Math.max(Math.trunc(pageSize) || 1, 1), MAX_PAGE_SIZE);
  const params = new URLSearchParams();
  if (cursor) params.set('$filter', buildResumePredicate(cursor));
  params.set('$orderby', 'changedAt,number');
  params.set('$top', String(capped));
  return params.toString();
}

/**
 * Advances the cursor to the last row of a page.
 *
 * An empty page keeps the previous cursor: the feed is caught up, and moving the
 * watermark on no evidence would skip whatever lands next at that timestamp.
 */
export function advanceCursor(rows: readonly DeltaRow[], previous: CatalogueCursor | null): CatalogueCursor | null {
  const last = rows.at(-1);
  if (!last) return previous;
  return { changedAt: last.changedAt, lastNumber: last.number };
}

/**
 * True when a page did not advance the cursor.
 *
 * With a correct keyset predicate this cannot happen, so it is an assertion rather than
 * a recovery path: if it ever fires, the predicate or the server ordering is wrong and
 * the caller must stop rather than spin.
 */
export function didNotAdvance(previous: CatalogueCursor | null, next: CatalogueCursor | null): boolean {
  if (!previous || !next) return false;
  return previous.changedAt === next.changedAt && previous.lastNumber === next.lastNumber;
}
