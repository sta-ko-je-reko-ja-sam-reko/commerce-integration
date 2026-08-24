import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRetryAfter, nextDelayMs, shouldRetry, isRetryable,
  CircuitBreaker, DEFAULT_RETRY_POLICY,
} from './backoff.ts';

const NOW = Date.parse('2026-08-24T12:00:00.000Z');

test('Retry-After is read as seconds or as an HTTP date', () => {
  assert.equal(parseRetryAfter('30', NOW), 30_000);
  assert.equal(parseRetryAfter('  7 ', NOW), 7_000);
  assert.equal(parseRetryAfter('Mon, 24 Aug 2026 12:00:45 GMT', NOW), 45_000);
});

test('a date already in the past yields no wait rather than a negative one', () => {
  assert.equal(parseRetryAfter('Mon, 24 Aug 2026 11:59:00 GMT', NOW), 0);
});

test('an absent or malformed Retry-After falls back to computed backoff', () => {
  for (const header of [null, undefined, '', '   ', 'soon', 'NaN']) {
    assert.equal(parseRetryAfter(header, NOW), null, `expected null for ${JSON.stringify(header)}`);
  }
});

test('Retry-After overrides computed backoff, even beyond the ceiling', () => {
  const beyondCeiling = DEFAULT_RETRY_POLICY.maxDelayMs * 3;
  assert.equal(nextDelayMs(1, DEFAULT_RETRY_POLICY, beyondCeiling, () => 1), beyondCeiling,
    'the ceiling bounds our impatience, not an instruction from the service');
});

test('backoff doubles and is capped', () => {
  const noJitter = () => 1;
  assert.equal(nextDelayMs(1, DEFAULT_RETRY_POLICY, null, noJitter), 500);
  assert.equal(nextDelayMs(2, DEFAULT_RETRY_POLICY, null, noJitter), 1_000);
  assert.equal(nextDelayMs(3, DEFAULT_RETRY_POLICY, null, noJitter), 2_000);
  assert.equal(nextDelayMs(20, DEFAULT_RETRY_POLICY, null, noJitter), DEFAULT_RETRY_POLICY.maxDelayMs);
});

test('jitter spreads retries across half the window', () => {
  assert.equal(nextDelayMs(3, DEFAULT_RETRY_POLICY, null, () => 0), 1_000);
  assert.equal(nextDelayMs(3, DEFAULT_RETRY_POLICY, null, () => 1), 2_000);
});

test('only failures worth repeating are retried', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) assert.ok(isRetryable(status), String(status));
  for (const status of [200, 201, 400, 401, 403, 404, 409, 422]) assert.ok(!isRetryable(status), String(status));
});

test('retrying stops at the attempt limit', () => {
  assert.equal(shouldRetry(4, 429, DEFAULT_RETRY_POLICY), true);
  assert.equal(shouldRetry(5, 429, DEFAULT_RETRY_POLICY), false);
  assert.equal(shouldRetry(1, 409, DEFAULT_RETRY_POLICY), false, 'a conflict is not transient');
});

test('the breaker does not open on a single failure', () => {
  const breaker = new CircuitBreaker(20, 0.5, 30_000, 5);
  breaker.record(false, NOW);
  assert.equal(breaker.state(NOW), 'closed');
  assert.equal(breaker.allows(NOW), true);
});

test('the breaker opens on a sustained failure rate', () => {
  const breaker = new CircuitBreaker(20, 0.5, 30_000, 5);
  for (let i = 0; i < 5; i += 1) breaker.record(false, NOW);
  assert.equal(breaker.state(NOW), 'open');
  assert.equal(breaker.allows(NOW), false);
});

test('a healthy majority keeps the breaker closed', () => {
  const mostlyHealthy = new CircuitBreaker(20, 0.5, 30_000, 5);
  for (let i = 0; i < 10; i += 1) mostlyHealthy.record(i % 4 !== 0, NOW);
  assert.equal(mostlyHealthy.state(NOW), 'closed');
});

test('the breaker half-opens after the cooldown and closes only on a successful probe', () => {
  const breaker = new CircuitBreaker(20, 0.5, 30_000, 5);
  for (let i = 0; i < 5; i += 1) breaker.record(false, NOW);
  assert.equal(breaker.state(NOW + 29_999), 'open');
  assert.equal(breaker.state(NOW + 30_000), 'half-open');

  breaker.record(false, NOW + 30_000);
  assert.equal(breaker.state(NOW + 30_001), 'open', 'a failed probe re-opens rather than closing');

  breaker.record(true, NOW + 60_001);
  assert.equal(breaker.state(NOW + 60_002), 'closed');
});
