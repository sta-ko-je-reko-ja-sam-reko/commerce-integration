/**
 * Contract pin check.
 *
 * This repository consumes a contract it does not own. `CONTRACT_PIN` names the release
 * tag of `commerce-platform` it is built against; this script fetches that release's
 * spec and asserts the properties this codebase actually depends on.
 *
 * The point is not to re-validate the spec — the owning repository does that. It is to
 * fail *this* build when the contract moves under it, rather than failing a request at
 * runtime with a shape nobody expected.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const OWNER = 'sta-ko-je-reko-ja-sam-reko';
const REPO = 'commerce-platform';
const SPEC = 'erp-commerce-v1.yaml';

const pin = readFileSync(new URL('../CONTRACT_PIN', import.meta.url), 'utf8').trim();

/**
 * Every exit goes through here rather than through process.exit().
 *
 * On Windows, process.exit() while a keep-alive fetch socket is still open aborts the
 * process inside libuv and reports 127 — which CI reads as a failure regardless of what
 * this script decided. Setting exitCode and returning lets the loop drain first.
 */
function finish(code, ...lines) {
  const log = code === 0 ? console.log : console.error;
  for (const line of lines) log(line);
  process.exitCode = code;
}

if (!/^contracts-v\d+\.\d+\.\d+$/.test(pin)) {
  finish(1, `CONTRACT_PIN is "${pin}", which is not a contracts-vX.Y.Z release tag.`);
}

const url = `https://github.com/${OWNER}/${REPO}/releases/download/${pin}/${SPEC}`;

let body = null;
let status = 0;
try {
  const response = await fetch(url);
  status = response.status;
  body = await response.text();
} catch (error) {
  finish(1, `Could not reach the contract release: ${error.message}`);
}

if (status === 404) {
  finish(0,
    `Contract release ${pin} is not published yet - skipping the assertions.`,
    'This is expected only while the contract is still on a branch. Once it is',
    'released, a 404 here means the pin is wrong and this must become a failure.');
}

if (process.exitCode === undefined && status !== 200) {
  finish(1, `Fetching ${url} returned ${status}.`);
}

const spec = process.exitCode === undefined ? parse(body) : null;
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

if (spec) {
check(spec.info?.version?.startsWith('1.'), `expected contract major version 1, got ${spec.info?.version}`);

for (const path of ['/catalogue/items', '/pricing/resolve', '/availability/check', '/orders']) {
  check(path in (spec.paths ?? {}), `contract no longer defines ${path}`);
}

const bulkCap = spec.components?.schemas?.PriceRequest?.properties?.lines?.maxItems;
check(bulkCap === 100, `bulk line cap is ${bulkCap}; this codebase chunks baskets at 100`);

const pageCap = (spec.paths?.['/catalogue/items']?.get?.parameters ?? [])
  .find((p) => p.name === 'pageSize')?.schema?.maximum;
check(pageCap === 1000, `catalogue page cap is ${pageCap}; MAX_PAGE_SIZE in this codebase is 1000`);

const orderParams = spec.paths?.['/orders']?.post?.parameters ?? [];
check(orderParams.some((p) => p.name === 'Idempotency-Key' && p.required),
  'the order path no longer requires an Idempotency-Key header');

if (failures.length > 0) {
  finish(1, `Contract pin ${pin} no longer matches this codebase:`, ...failures.map((f) => `  - ${f}`));
} else {
  finish(0, `Contract pin ${pin} matches this codebase.`);
}
}
