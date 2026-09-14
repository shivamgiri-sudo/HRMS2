import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute: mocks.execute } }));

import { checkAndIncrement, peekUsage, resetBucket } from '../ai-rate-limiter.js';

describe('checkAndIncrement — DB-backed rate limiter', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  it('creates/increments the bucket via a single atomic INSERT ... ON DUPLICATE KEY UPDATE round trip', async () => {
    mocks.execute.mockResolvedValueOnce([{ insertId: 1 }]);
    await checkAndIncrement('user-1');
    expect(mocks.execute).toHaveBeenCalledTimes(1); // single round trip, not read-then-write
    const [sql] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('ON DUPLICATE KEY UPDATE');
    expect(String(sql)).toContain('LAST_INSERT_ID');
  });

  it('allows the first request of the day and reports remaining = limit - 1', async () => {
    mocks.execute.mockResolvedValueOnce([{ insertId: 1 }]);
    const result = await checkAndIncrement('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99); // default limit 100
  });

  it('allows the request that reaches exactly the limit, with remaining = 0', async () => {
    mocks.execute.mockResolvedValueOnce([{ insertId: 100 }]);
    const result = await checkAndIncrement('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('denies once the count exceeds the limit', async () => {
    mocks.execute.mockResolvedValueOnce([{ insertId: 101 }]);
    const result = await checkAndIncrement('user-1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('honors a dailyLimit override instead of the default 100', async () => {
    mocks.execute.mockResolvedValueOnce([{ insertId: 5 }]);
    const result = await checkAndIncrement('user-1', 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);

    mocks.execute.mockResolvedValueOnce([{ insertId: 6 }]);
    const denied = await checkAndIncrement('user-1', 5);
    expect(denied.allowed).toBe(false);
  });

  it('peekUsage reads without incrementing (separate SELECT, no INSERT)', async () => {
    mocks.execute.mockResolvedValueOnce([[{ request_count: 42 }]]);
    const result = await peekUsage('user-1');
    expect(result.count).toBe(42);
    const [sql] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('SELECT');
    expect(String(sql)).not.toContain('INSERT');
  });

  it('peekUsage reports 0 for a user with no bucket row yet', async () => {
    mocks.execute.mockResolvedValueOnce([[]]);
    const result = await peekUsage('user-1');
    expect(result.count).toBe(0);
  });

  it('resetBucket deletes only today\'s row for that user', async () => {
    mocks.execute.mockResolvedValueOnce([{}]);
    await resetBucket('user-1');
    const [sql, params] = mocks.execute.mock.calls[0];
    expect(String(sql)).toContain('DELETE FROM ai_rate_limit_bucket');
    expect(params[0]).toBe('user-1');
  });

  // A mock can prove the query's *shape* is the atomic form, but not real
  // concurrency safety end-to-end — that should additionally be confirmed
  // against a real MySQL instance in staging before relying on it, per
  // CLAUDE.md's isolated-staging-testing rule.
  it('does not read-then-write — no SELECT precedes the increment', async () => {
    mocks.execute.mockResolvedValueOnce([{ insertId: 1 }]);
    await checkAndIncrement('user-1');
    const [sql] = mocks.execute.mock.calls[0];
    expect(String(sql).trim().toUpperCase().startsWith('INSERT')).toBe(true);
  });
});
