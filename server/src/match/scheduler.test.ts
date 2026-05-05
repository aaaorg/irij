import { describe, expect, it, vi } from 'vitest';
import { runScheduledTicks, type TickCounters } from './scheduler.js';

describe('runScheduledTicks', () => {
  it('fires handler when counter reaches interval', () => {
    const handler = vi.fn();
    let counters: TickCounters = {};

    for (let i = 0; i < 4; i++) {
      counters = runScheduledTicks(counters, {
        test: { interval: 5, handler },
      });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(counters.test).toBe(4);

    counters = runScheduledTicks(counters, {
      test: { interval: 5, handler },
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(counters.test).toBe(0);
  });

  it('fires multiple independent handlers at different intervals', () => {
    const fast = vi.fn();
    const slow = vi.fn();
    let counters: TickCounters = {};

    for (let i = 0; i < 6; i++) {
      counters = runScheduledTicks(counters, {
        fast: { interval: 2, handler: fast },
        slow: { interval: 5, handler: slow },
      });
    }

    expect(fast).toHaveBeenCalledTimes(3);
    expect(slow).toHaveBeenCalledTimes(1);
  });

  it('resets counter to 0 after firing', () => {
    const handler = vi.fn();
    let counters: TickCounters = {};

    for (let i = 0; i < 3; i++) {
      counters = runScheduledTicks(counters, {
        test: { interval: 3, handler },
      });
    }
    expect(counters.test).toBe(0);

    counters = runScheduledTicks(counters, {
      test: { interval: 3, handler },
    });
    expect(counters.test).toBe(1);
  });
});
