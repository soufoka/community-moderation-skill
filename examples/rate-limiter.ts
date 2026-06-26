/**
 * Self-protection utilities for the agent: a token-bucket rate limiter (cap the
 * agent's own actions/min, with a circuit-breaker burst) and an idempotency store
 * (act once per message id / contentHash). Pure, dependency-free.
 */

export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(private ratePerMin: number, private burst: number = ratePerMin, now: number = Date.now()) {
    this.tokens = burst;
    this.last = now;
  }

  /** True if an action is allowed right now (consumes a token). */
  allow(now: number = Date.now()): boolean {
    const refill = (Math.max(0, now - this.last) / 60000) * this.ratePerMin; // guard clock skew
    this.tokens = Math.min(this.burst, this.tokens + refill);
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/** Remembers handled keys so the same message is never actioned twice. */
export class IdempotencyStore {
  private seen = new Set<string>();

  constructor(private max: number = 10000) {}

  /** True the FIRST time a key is seen; false on repeats. */
  firstSeen(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value as string | undefined;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
