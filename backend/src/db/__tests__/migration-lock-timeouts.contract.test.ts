import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Migration connections must bound both lock timeouts.
 *
 * MySQL's defaults are wrong for a boot path in both directions. `lock_wait_timeout`
 * — the metadata lock a DDL needs — defaults to 31,536,000 seconds, so one
 * long-running SELECT against a big table can park an ALTER for a year and the
 * server never finishes starting; that is the shape of the 2026-08-17 outage the
 * runner's own comments describe. `innodb_lock_wait_timeout` defaults to 50s, and
 * production's log carries 51 transient-retry lines, each costing ~50s before the
 * retry that actually works — roughly 103 seconds of every restart, which is most
 * of the 502 window users see during a deploy.
 *
 * The retry loop was already correct. It just never got to run promptly.
 */
const runner = readFileSync(
  resolve(process.cwd(), 'src/db/runPendingMigrations.ts'),
  'utf8',
);

describe('migration connections bound their lock waits', () => {
  it('sets both timeouts, not just the InnoDB one', () => {
    const fn = runner.slice(runner.indexOf('async function openMigrationConnection'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('SET SESSION lock_wait_timeout');
    expect(body).toContain('SESSION innodb_lock_wait_timeout');
  });

  it('routes every migration connection through the helper', () => {
    // The advisory-lock connection, the per-file DDL connections and the ledger
    // writes all share connConfig; any one of them left on mysql.createConnection
    // would inherit the year-long metadata-lock default.
    expect(runner).not.toContain('mysql.createConnection(connConfig)');
    expect(runner.match(/openMigrationConnection\(connConfig\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('clamps the configured value to a sane range', () => {
    const decl = runner.slice(runner.indexOf('const MIGRATION_LOCK_WAIT_SECONDS'));
    const body = decl.slice(0, decl.indexOf('})();'));
    expect(body).toContain('Number.isFinite(raw)');
    expect(body).toMatch(/raw >= 1 && raw <= 600/);
  });

  it('does not refuse the boot when the SET itself fails', () => {
    // A server that rejects the SET is not a schema problem, and the runner treats
    // any recorded failure as fatal in production.
    const fn = runner.slice(runner.indexOf('async function openMigrationConnection'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('catch');
    expect(body).toContain('using server defaults');
  });

  it('keeps the retry policy it exists to serve', () => {
    expect(runner).toContain('const MIGRATION_MAX_ATTEMPTS = 3');
    expect(runner).toContain('isTransientMigrationError');
  });
});
