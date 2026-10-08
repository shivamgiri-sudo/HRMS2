import { describe, expect, it } from 'vitest';
import {
  runWithRequestContext,
  memoizeForRequest,
  hasRequestContext,
} from '../src/shared/requestContext.js';

/**
 * This store memoises AUTHORIZATION lookups, so its isolation guarantees matter
 * more than its speed. The tests below pin the properties that make it safe:
 * one request never sees another request's answer, and a permission change is
 * picked up on the next request rather than lingering in a TTL.
 */
describe('memoizeForRequest', () => {
  it('computes once per request and reuses the value', async () => {
    let calls = 0;
    const compute = async () => { calls++; return 'admin'; };

    const result = await runWithRequestContext(async () => {
      const a = await memoizeForRequest('roles:u1', compute);
      const b = await memoizeForRequest('roles:u1', compute);
      const c = await memoizeForRequest('roles:u1', compute);
      return [a, b, c];
    });

    expect(result).toEqual(['admin', 'admin', 'admin']);
    expect(calls).toBe(1);
  });

  it('shares a single in-flight query between concurrent callers', async () => {
    let calls = 0;
    const compute = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 'hr';
    };

    const results = await runWithRequestContext(async () =>
      Promise.all([
        memoizeForRequest('roles:u1', compute),
        memoizeForRequest('roles:u1', compute),
        memoizeForRequest('roles:u1', compute),
      ]),
    );

    expect(results).toEqual(['hr', 'hr', 'hr']);
    expect(calls).toBe(1);
  });

  it('does NOT leak between requests — a revoked role is not served again', async () => {
    let current = 'admin';
    const compute = async () => current;

    const first = await runWithRequestContext(() => memoizeForRequest('roles:u1', compute));
    current = 'employee'; // permission revoked between requests
    const second = await runWithRequestContext(() => memoizeForRequest('roles:u1', compute));

    expect(first).toBe('admin');
    expect(second).toBe('employee');
  });

  it('keys are independent', async () => {
    await runWithRequestContext(async () => {
      const a = await memoizeForRequest('roles:u1', async () => 'admin');
      const b = await memoizeForRequest('roles:u2', async () => 'employee');
      expect(a).toBe('admin');
      expect(b).toBe('employee');
    });
  });

  it('never caches a failure', async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error('db down');
      return 'recovered';
    };

    await runWithRequestContext(async () => {
      await expect(memoizeForRequest('roles:u1', flaky)).rejects.toThrow('db down');
      // A retry inside the same request must actually re-run, not replay the error.
      await expect(memoizeForRequest('roles:u1', flaky)).resolves.toBe('recovered');
    });
    expect(calls).toBe(2);
  });

  it('falls through to a direct call outside a request (workers, scripts)', async () => {
    let calls = 0;
    const compute = async () => { calls++; return 'x'; };

    expect(hasRequestContext()).toBe(false);
    expect(await memoizeForRequest('roles:u1', compute)).toBe('x');
    expect(await memoizeForRequest('roles:u1', compute)).toBe('x');
    // No store, so no memoisation — behaviour is unchanged for background jobs.
    expect(calls).toBe(2);
  });

  it('isolates concurrent requests from each other', async () => {
    const run = (value: string) =>
      runWithRequestContext(async () => {
        await new Promise((r) => setTimeout(r, 5));
        return memoizeForRequest('roles:same-key', async () => value);
      });

    expect(await Promise.all([run('a'), run('b'), run('c')])).toEqual(['a', 'b', 'c']);
  });
});
