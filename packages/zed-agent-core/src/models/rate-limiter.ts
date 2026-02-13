/**
 * Rate limiter for concurrent language model requests.
 * Ported from: crates/language_model/src/rate_limiter.rs
 *
 * Uses a semaphore pattern to limit the number of concurrent API requests.
 */

/**
 * A simple counting semaphore for rate limiting.
 */
export class RateLimiter {
  private current = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  /**
   * Acquire a permit. Returns a release function.
   * If the limit is reached, waits until a slot becomes available.
   */
  async acquire(): Promise<() => void> {
    while (this.current >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.current++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.current--;
      const next = this.waiters.shift();
      if (next) next();
    };
  }

  /** Get the current number of active permits. */
  get activeCount(): number {
    return this.current;
  }

  /** Get the number of waiters. */
  get waitingCount(): number {
    return this.waiters.length;
  }
}
