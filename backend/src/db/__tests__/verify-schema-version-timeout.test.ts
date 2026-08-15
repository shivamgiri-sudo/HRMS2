/**
 * Regression cover for verifySchemaVersion() hanging indefinitely under DB contention.
 *
 * verifySchemaVersion() (called on every /api/health/version hit) opens its own raw,
 * unpooled mysql2 connection rather than reusing the app's shared pool — a deliberate
 * choice, since migrations must not compete with app traffic for pool slots and this
 * function has to work before the pool exists at boot. But that raw connection had no
 * timeout bound at all. Reported live 2026-08-13: instrumenting the Vite dev proxy
 * showed a single /api/health/version request take 79+ seconds end to end, with every
 * caller waiting on it (including the proxy itself) hanging for the same duration —
 * traced via the DB host currently running under contention from concurrent local
 * testing, not a Vite bug.
 *
 * These tests mock mysql2/promise entirely, so no live database is involved. They pin
 * two things: that createConnection is called with an explicit connectTimeout, and that
 * the whole operation resolves (with a clear error state, not a hang) well within
 * VERIFY_SCHEMA_TIMEOUT_MS even when the mocked connection's queries never settle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock('mysql2/promise', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mysql2/promise')>();
  return { ...actual, default: { ...actual.default, createConnection: mocks.createConnection } };
});

/**
 * These four must be present or verifySchemaVersion never reaches the code under test.
 *
 * It guards on config before it connects:
 *   if (!host || !user || !password || !dbName) { state = "error"; return ... }
 * and only then calls mysql.createConnection. With no DB env set, both tests below were
 * asserting against a function that had already returned — createConnection was called 0
 * times, and the failure read as "the connectTimeout guard is missing" when the guard is
 * present and correct (connectTimeout: VERIFY_SCHEMA_TIMEOUT_MS). The docstring above says
 * "no live database is involved", which is true and was the trap: mocking mysql2 is
 * necessary but not sufficient, because the early return happens first.
 *
 * The values are deliberately non-routable. mysql2 is mocked, so nothing dials them — they
 * exist only to get past the guard.
 */
const FAKE_DB_ENV = {
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_USER: 'test-user',
  DB_PASSWORD: 'test-password',
  DB_NAME: 'test_db',
} as const;

describe('verifySchemaVersion — bounded against a hanging DB connection', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [k, v] of Object.entries(FAKE_DB_ENV)) {
      savedEnv[k] = process.env[k];
      process.env[k] = v;
    }
    mocks.createConnection.mockReset();
    vi.resetModules();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.useRealTimers();
  });

  it('passes an explicit connectTimeout to createConnection, not the mysql2 default of none', async () => {
    const destroy = vi.fn();
    mocks.createConnection.mockResolvedValue({
      execute: vi.fn().mockResolvedValue([[]]),
      end: vi.fn().mockResolvedValue(undefined),
      destroy,
    });

    const { verifySchemaVersion } = await import('../runPendingMigrations.js');
    await verifySchemaVersion();

    expect(mocks.createConnection).toHaveBeenCalledTimes(1);
    const [args] = mocks.createConnection.mock.calls[0];
    expect(args.connectTimeout).toBeTypeOf('number');
    expect(args.connectTimeout).toBeGreaterThan(0);
  });

  it('resolves with an error state — never hangs — when every query on the connection stalls forever', async () => {
    // A connection whose execute() never resolves, simulating exactly the live symptom:
    // the connect phase succeeds but a query stalls indefinitely under contention.
    const destroy = vi.fn();
    mocks.createConnection.mockResolvedValue({
      execute: vi.fn(() => new Promise(() => {})), // never settles
      end: vi.fn().mockResolvedValue(undefined),
      destroy,
    });

    const { verifySchemaVersion } = await import('../runPendingMigrations.js');

    const start = Date.now();
    const result = await verifySchemaVersion();
    const elapsedMs = Date.now() - start;

    // The regression this guards against was a 79-second real-world hang. Bounding to
    // well under that (a few seconds of test wall-clock, real timers) proves the race
    // actually returns instead of hanging — a source-text check on VERIFY_SCHEMA_TIMEOUT_MS
    // alone would not catch a Promise.race wired up wrong.
    expect(elapsedMs).toBeLessThan(15000);
    expect(result.state).toBe('error');
    expect(result.valid).toBe(false);
    // Best-effort cleanup: the stalled connection should be force-closed, not leaked.
    expect(destroy).toHaveBeenCalled();
  }, 20000);

  it('resolves quickly and successfully when the connection behaves normally', async () => {
    mocks.createConnection.mockResolvedValue({
      execute: vi.fn().mockResolvedValue([[{ TABLE_NAME: 'schema_migrations' }]]),
      end: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
    });

    const { verifySchemaVersion } = await import('../runPendingMigrations.js');
    const start = Date.now();
    await verifySchemaVersion();
    const elapsedMs = Date.now() - start;

    // The fix must not slow down the common, healthy case.
    expect(elapsedMs).toBeLessThan(1000);
  });
});
