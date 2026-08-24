/**
 * Retry policy for calls into Business Central.
 *
 * Business Central throttles with `429` and a `Retry-After` header. The header is an
 * instruction, not a hint: retrying sooner than it says makes the throttling worse and
 * can extend it. So `Retry-After` always wins over the computed backoff.
 *
 * Jitter is not decoration. Without it, every worker that was throttled at the same
 * moment retries at the same moment, reproducing the burst that caused the throttling.
 */

export interface RetryPolicy {
  /** Attempts including the first. */
  maxAttempts: number;
  /** Delay before the second attempt, in milliseconds. Doubles thereafter. */
  baseDelayMs: number;
  /** Ceiling on any single delay, in milliseconds. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

/** Status codes worth retrying. Anything else is a fault the caller must see. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isRetryable(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/**
 * Parses `Retry-After`, which is either a delay in seconds or an HTTP date.
 *
 * Returns null when absent or unparseable, so the caller falls back to computed backoff
 * rather than treating a malformed header as "retry immediately".
 */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, asDate - now);
}

/**
 * Delay before the given attempt.
 *
 * `attempt` is 1-based; the delay returned is the wait *after* that attempt failed.
 * A server-supplied `Retry-After` overrides the computed value entirely — including
 * when it is longer than `maxDelayMs`, because the ceiling exists to bound our own
 * impatience, not to override an instruction from the service.
 *
 * `random` is injectable so the jitter is testable.
 */
export function nextDelayMs(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  retryAfterMs: number | null = null,
  random: () => number = Math.random,
): number {
  if (retryAfterMs !== null) return Math.max(0, retryAfterMs);

  const exponential = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, policy.maxDelayMs);
  return Math.round(capped * (0.5 + random() * 0.5));
}

/** True when another attempt is permitted and the failure is one worth repeating. */
export function shouldRetry(attempt: number, status: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): boolean {
  return attempt < policy.maxAttempts && isRetryable(status);
}

/**
 * A circuit breaker over a rolling window.
 *
 * Opening after a single failure and closing after a single success oscillates and
 * amplifies an outage, so the breaker opens on a failure *rate* and recovers through a
 * half-open probe (ADR 0004).
 */
export type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  readonly #windowSize: number;
  readonly #failureRateToOpen: number;
  readonly #cooldownMs: number;
  readonly #minimumCalls: number;

  #outcomes: boolean[] = [];
  #openedAt: number | null = null;

  constructor(windowSize = 20, failureRateToOpen = 0.5, cooldownMs = 30_000, minimumCalls = 5) {
    this.#windowSize = windowSize;
    this.#failureRateToOpen = failureRateToOpen;
    this.#cooldownMs = cooldownMs;
    this.#minimumCalls = minimumCalls;
  }

  state(now: number = Date.now()): BreakerState {
    if (this.#openedAt === null) return 'closed';
    return now - this.#openedAt >= this.#cooldownMs ? 'half-open' : 'open';
  }

  allows(now: number = Date.now()): boolean {
    return this.state(now) !== 'open';
  }

  record(success: boolean, now: number = Date.now()): void {
    if (this.state(now) === 'half-open') {
      this.#openedAt = success ? null : now;
      this.#outcomes = [];
      return;
    }

    this.#outcomes.push(success);
    if (this.#outcomes.length > this.#windowSize) this.#outcomes.shift();
    if (this.#outcomes.length < this.#minimumCalls) return;

    const failures = this.#outcomes.filter((ok) => !ok).length;
    if (failures / this.#outcomes.length >= this.#failureRateToOpen) {
      this.#openedAt = now;
      this.#outcomes = [];
    }
  }
}
