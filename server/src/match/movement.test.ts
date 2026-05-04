import { describe, expect, it } from 'vitest';
import {
  parseMoveRequest,
  checkRateLimit,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
} from './movement.js';

describe('parseMoveRequest', () => {
  it('parses valid move request', () => {
    const result = parseMoveRequest({
      target: { x: 10, y: 20 },
      client_seq: 1,
    });
    expect(result).toEqual({
      target: { x: 10, y: 20 },
      client_seq: 1,
    });
  });

  it('floors float coordinates to int', () => {
    const result = parseMoveRequest({
      target: { x: 3.7, y: 5.2 },
      client_seq: 42,
    });
    expect(result).toEqual({
      target: { x: 3, y: 5 },
      client_seq: 42,
    });
  });

  it('returns null for null input', () => {
    expect(parseMoveRequest(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseMoveRequest(undefined)).toBeNull();
  });

  it('returns null for non-object', () => {
    expect(parseMoveRequest('hello')).toBeNull();
    expect(parseMoveRequest(42)).toBeNull();
    expect(parseMoveRequest(true)).toBeNull();
  });

  it('returns null when target is missing', () => {
    expect(parseMoveRequest({ client_seq: 1 })).toBeNull();
  });

  it('returns null when target is not an object', () => {
    expect(parseMoveRequest({ target: 'bad', client_seq: 1 })).toBeNull();
  });

  it('returns null when target.x is not a number', () => {
    expect(
      parseMoveRequest({ target: { x: 'a', y: 1 }, client_seq: 1 }),
    ).toBeNull();
  });

  it('returns null when target.y is not a number', () => {
    expect(
      parseMoveRequest({ target: { x: 1, y: null }, client_seq: 1 }),
    ).toBeNull();
  });

  it('returns null for NaN coordinates', () => {
    expect(
      parseMoveRequest({ target: { x: NaN, y: 1 }, client_seq: 1 }),
    ).toBeNull();
    expect(
      parseMoveRequest({ target: { x: 1, y: NaN }, client_seq: 1 }),
    ).toBeNull();
  });

  it('returns null for Infinity coordinates', () => {
    expect(
      parseMoveRequest({ target: { x: Infinity, y: 1 }, client_seq: 1 }),
    ).toBeNull();
  });

  it('returns null when client_seq is missing', () => {
    expect(parseMoveRequest({ target: { x: 1, y: 1 } })).toBeNull();
  });

  it('returns null when client_seq is not a number', () => {
    expect(
      parseMoveRequest({ target: { x: 1, y: 1 }, client_seq: 'abc' }),
    ).toBeNull();
  });

  it('returns null when client_seq is NaN', () => {
    expect(
      parseMoveRequest({ target: { x: 1, y: 1 }, client_seq: NaN }),
    ).toBeNull();
  });
});

describe('checkRateLimit', () => {
  it('allows first request', () => {
    const result = checkRateLimit([], 1000, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
    expect(result.allowed).toBe(true);
    expect(result.updatedLog).toEqual([1000]);
  });

  it('allows up to max requests within window', () => {
    const log: number[] = [];
    const baseTime = 5000;
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
      const result = checkRateLimit(log, baseTime + i, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
      expect(result.allowed).toBe(true);
      log.length = 0;
      log.push(...result.updatedLog);
    }
    expect(log.length).toBe(RATE_LIMIT_MAX_REQUESTS);
  });

  it('rejects request beyond max within window', () => {
    // Fill up to max
    const log: number[] = [];
    const baseTime = 5000;
    for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
      log.push(baseTime + i);
    }
    // 11th request at baseTime+999 (still within 1s window of all 10)
    const result = checkRateLimit(log, baseTime + 999, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
    expect(result.allowed).toBe(false);
  });

  it('prunes old entries outside window', () => {
    // 10 requests at t=1000..1009
    const log = Array.from({ length: 10 }, (_, i) => 1000 + i);
    // At t=2010, all old entries are > 1s ago, should be pruned
    const result = checkRateLimit(log, 2010, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
    expect(result.allowed).toBe(true);
    expect(result.updatedLog).toEqual([2010]);
  });

  it('allows after window slides past old requests', () => {
    // Fill 10 requests at t=100..109
    const log = Array.from({ length: 10 }, (_, i) => 100 + i);
    // At t=1200, cutoff=200. All entries (100..109) < 200 → all pruned
    const result = checkRateLimit(log, 1200, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
    expect(result.allowed).toBe(true);
    expect(result.updatedLog).toEqual([1200]);
  });

  it('keeps recent entries after prune', () => {
    // 5 old (prunable) + 5 recent
    const log = [100, 200, 300, 400, 500, 4600, 4700, 4800, 4900, 5000];
    // At t=5500, cutoff=4500. Entries > 4500: [4600,4700,4800,4900,5000] = 5
    const result = checkRateLimit(log, 5500, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS);
    expect(result.allowed).toBe(true);
    expect(result.updatedLog).toEqual([4600, 4700, 4800, 4900, 5000, 5500]);
  });
});
