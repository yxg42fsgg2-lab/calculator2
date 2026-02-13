/**
 * Tests for the RateLimiter.
 */

import { describe, it, expect } from 'vitest';
import { RateLimiter } from '../src/models/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows up to maxConcurrent permits', async () => {
    const limiter = new RateLimiter(2);
    expect(limiter.activeCount).toBe(0);

    const release1 = await limiter.acquire();
    expect(limiter.activeCount).toBe(1);

    const release2 = await limiter.acquire();
    expect(limiter.activeCount).toBe(2);

    release1();
    expect(limiter.activeCount).toBe(1);

    release2();
    expect(limiter.activeCount).toBe(0);
  });

  it('queues when at capacity', async () => {
    const limiter = new RateLimiter(1);

    const release1 = await limiter.acquire();
    expect(limiter.activeCount).toBe(1);
    expect(limiter.waitingCount).toBe(0);

    // Start acquiring another permit (should block)
    let acquired = false;
    const acquirePromise = limiter.acquire().then((r) => {
      acquired = true;
      return r;
    });

    // Give the event loop a tick
    await new Promise((r) => setTimeout(r, 10));
    expect(acquired).toBe(false);
    expect(limiter.waitingCount).toBe(1);

    // Release first permit
    release1();
    const release2 = await acquirePromise;
    expect(acquired).toBe(true);
    expect(limiter.activeCount).toBe(1);

    release2();
    expect(limiter.activeCount).toBe(0);
  });

  it('double release is a no-op', async () => {
    const limiter = new RateLimiter(1);
    const release = await limiter.acquire();
    release();
    release(); // Should not throw or double-decrement
    expect(limiter.activeCount).toBe(0);
  });
});
