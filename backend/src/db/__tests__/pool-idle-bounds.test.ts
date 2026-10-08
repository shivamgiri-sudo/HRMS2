import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

/**
 * mysql2 defaults maxIdle to connectionLimit, so a pool holds its whole quota
 * open until the server's wait_timeout (28800s on this deployment). Four pools
 * point at DB_HOST and every process creates all four, which is what drives
 * Connection_errors_max_connections on the shared server.
 */
const DB_HOST_POOLS = [
  '../mysql.ts',
  '../masmisDb.ts',
  '../sourceDb.ts',
  '../shivamgiriDb.ts',
];

describe('pools targeting DB_HOST bound their idle connections', () => {
  it.each(DB_HOST_POOLS)('%s sets maxIdle and idleTimeout', (file) => {
    const src = source(file);

    expect(src).toMatch(/maxIdle:/);
    expect(src).toMatch(/idleTimeout:/);
  });

  it('keeps the primary pool idle allowance below its connection limit', () => {
    const env = source('../../config/env.ts');
    const maxIdle = env.match(/DB_POOL_MAX_IDLE: z\.coerce\.number\(\)\.default\((\d+)\)/);
    const poolMax = env.match(/DB_POOL_MAX: z\.coerce\.number\(\)\.default\((\d+)\)/);

    expect(maxIdle).not.toBeNull();
    expect(poolMax).not.toBeNull();
    expect(Number(maxIdle![1])).toBeLessThan(Number(poolMax![1]));
    expect(Number(maxIdle![1])).toBeGreaterThan(0);
  });

  it('expires idle connections well inside the server wait_timeout', () => {
    const env = source('../../config/env.ts');
    const idleMs = env.match(/DB_POOL_IDLE_TIMEOUT_MS: z\.coerce\.number\(\)\.default\(([\d_]+)\)/);

    expect(idleMs).not.toBeNull();
    const ms = Number(idleMs![1].replace(/_/g, ''));
    expect(ms).toBeGreaterThanOrEqual(10_000);
    expect(ms).toBeLessThan(28_800_000);
  });
});
