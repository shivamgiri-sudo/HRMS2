import { inlineLimitPlaceholders } from "./limit-placeholders.js";
import mysql, {
  type RowDataPacket,
  type FieldPacket,
  type QueryResult,
  type Pool,
  type PoolConnection,
} from "mysql2/promise";
import { env } from "../config/env.js";
import {
  isSchemaOrLogicDbError,
  describeDbError,
} from "./db-error-classification.js";
import {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  checkCircuitBreakerState,
  initialCircuitBreakerState,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
  type CircuitBreakerState,
} from "./circuitBreaker.js";

/**
 * RELIABILITY: Connection pool with bounded queue and circuit breaker.
 *
 * - queueLimit: 100 prevents unbounded queue growth under load
 * - connectTimeout: prevents hung connections from blocking forever
 * - enableKeepAlive: detects stale connections
 * - maxIdle/idleTimeout: releases connections the server would otherwise hold
 *   for wait_timeout (8h here), which is what starves max_connections
 * - Circuit breaker: fast-fails when DB is overwhelmed
 */
const _pool: Pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_POOL_MAX,
  waitForConnections: true,
  queueLimit: 100, // SECURITY: bounded queue prevents memory exhaustion
  connectTimeout: 10000, // 10s timeout to establish connection
  timezone: "+05:30", // Always IST regardless of server OS timezone
  dateStrings: true, // Return DATETIME/TIMESTAMP as strings, not JS Date objects
  decimalNumbers: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000, // 30s keep-alive
  maxIdle: env.DB_POOL_MAX_IDLE,
  idleTimeout: env.DB_POOL_IDLE_TIMEOUT_MS,
});

// 0 = no limit (MySQL default). Only the API process sets one: without it a SELECT keeps running
// on the server long after nginx (120s) has dropped the request, and repeat requests stack copies.
// MySQL applies max_execution_time to read-only SELECTs only; writes, DDL and migrations are untouched.
let sessionMaxExecutionMs = 0;

export function setSessionMaxExecutionTime(ms: number): void {
  sessionMaxExecutionMs = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
}

_pool.on("connection", (conn) => {
  conn.query("SET time_zone = '+05:30'");
  if (sessionMaxExecutionMs > 0) {
    conn.query(`SET SESSION max_execution_time = ${sessionMaxExecutionMs}`);
  }
});

/**
 * RELIABILITY: Transient errors that are safe to retry.
 *
 * NOTE: ER_CON_COUNT_ERROR is NOT included -- connection exhaustion should NOT
 * be retried as it makes the problem worse. Return 503 immediately instead.
 */
const TRANSIENT_DB_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
  "ECONNRESET",
]);

/**
 * Connection pressure errors -- do not retry the same request, but also do
 * not open the process-wide breaker on the first spike.
 */
const CONNECTION_PRESSURE_DB_ERROR_CODES = new Set([
  "ER_CON_COUNT_ERROR", // Connection exhaustion -- retry makes it worse
  "ER_TOO_MANY_USER_CONNECTIONS",
  "POOL_ENQUEUELIMIT",
]);

/**
 * Lock contention (metadata-lock / row-lock waits). Not a DB-availability problem: do not retry it
 * (a retry just holds another connection) and do not let it trip the circuit breaker.
 * Referenced by isLockContentionDbError(); 5083898f6 used it without defining it, which failed typecheck.
 */
const LOCK_CONTENTION_DB_ERROR_CODES = new Set([
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_LOCK_DEADLOCK",
]);

const MAX_DB_RETRIES = 3;

/**
 * RELIABILITY: Circuit breaker state.
 * Prevents cascading failures when DB is overwhelmed.
 */
const CIRCUIT_BREAKER_CONFIG = DEFAULT_CIRCUIT_BREAKER_CONFIG;

let circuitBreaker: CircuitBreakerState = initialCircuitBreakerState();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

function isTransientDbError(error: unknown): boolean {
  return TRANSIENT_DB_ERROR_CODES.has(getErrorCode(error));
}

function isLockContentionDbError(error: unknown): boolean {
  return LOCK_CONTENTION_DB_ERROR_CODES.has(getErrorCode(error));
}

function isConnectionPressureDbError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (CONNECTION_PRESSURE_DB_ERROR_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : "";
  return /queue limit reached|too many connections|too many user connections/i.test(
    message,
  );
}

/**
 * RELIABILITY: Check circuit breaker before attempting operation.
 * Throws immediately if circuit is open (fast-fail).
 */
function checkCircuitBreaker(): void {
  const now = Date.now();

  if (circuitBreaker.status === "open") {
    circuitBreaker = checkCircuitBreakerState(
      circuitBreaker,
      CIRCUIT_BREAKER_CONFIG,
      now,
    );
    if (circuitBreaker.status === "open") {
      const retryAfter = Math.ceil((circuitBreaker.nextProbeTime - now) / 1000);
      const error = new Error(
        `Database circuit breaker open. Retry after ${retryAfter}s`,
      );
      (error as any).code = "CIRCUIT_BREAKER_OPEN";
      (error as any).retryAfter = retryAfter;
      throw error;
    }
  }
}

/**
 * RELIABILITY: Record operation success for circuit breaker.
 */
function recordSuccess(): void {
  circuitBreaker = recordCircuitBreakerSuccess(
    circuitBreaker,
    CIRCUIT_BREAKER_CONFIG,
  );
}

/**
 * RELIABILITY: Record operation failure for circuit breaker.
 *
 * Logs the CAUSE, once, on the closed/half-open -> open transition.
 *
 * Without this the breaker was undiagnosable. Only isSchemaOrLogicDbError is
 * logged in the retry loop below, and those never trip the breaker — the errors
 * that do (connection pressure, transient) were swallowed. So production showed
 * 241 "Database circuit breaker open" lines across 2026-08-08 20:00-21:10 with
 * ZERO underlying errors recorded: every worker reporting the symptom, nothing
 * reporting why. Grepping for ETIMEDOUT / ECONNREFUSED / ECONNRESET /
 * "Too many connections" returned nothing at all, which reads as "no cause"
 * rather than "cause never printed".
 *
 * Deliberately only on the transition, not per failure: when the database is
 * unreachable EVERY query fails, and logging each one buries the line that
 * matters — which is the mistake that produced the 28-of-50 dashboard noise this
 * same log already suffered from.
 */
function recordFailure(error?: unknown): void {
  const now = Date.now();
  const previous = circuitBreaker.status;

  // Jitter the reopen delay so the probe cannot lock to a fixed caller cadence.
  //
  // The 2026-08-08 outage described above was exactly that resonance, and the pool size
  // was only half of it: the workers poll on a shared 30s tick and recoveryTimeMs is
  // 30000, so every half-open probe landed on the very next burst, failed, and reopened —
  // indefinitely, across restarts. Up to +40% drifts the probe off the burst within a
  // cycle or two, letting the breaker find a quiet moment on its own.
  //
  // Math.random() lives here rather than in circuitBreaker.ts so that module stays pure
  // and its tests keep asserting an exact `now + recoveryTimeMs`.
  const jitterMs = Math.floor(
    Math.random() * CIRCUIT_BREAKER_CONFIG.recoveryTimeMs * 0.4,
  );
  circuitBreaker = recordCircuitBreakerFailure(
    circuitBreaker,
    CIRCUIT_BREAKER_CONFIG,
    now,
    jitterMs,
  );

  if (circuitBreaker.status === "open" && previous !== "open") {
    // Distinguish the two ways the breaker opens. Reopening from half-open does NOT touch the
    // failure counter (see recordCircuitBreakerFailure), so reporting it there printed
    // "OPEN after 0 consecutive failure(s)" — which reads as a counter bug and sends whoever
    // is debugging an outage looking in the wrong place. It is a single failed probe, and
    // saying so is the whole point of the line.
    const cause =
      previous === "half-open"
        ? "a failed recovery probe"
        : `${circuitBreaker.failures} consecutive failure(s)`;
    console.error(
      `[mysql] circuit breaker OPEN after ${cause}; ` +
        // Derived from nextProbeTime, not the nominal config value, so the line stays
        // truthful now that the delay carries jitter.
        `probing again in ${Math.max(0, Math.ceil((circuitBreaker.nextProbeTime - now) / 1000))}s. ` +
        `Tripped by: ${describeDbError(error)}`,
    );
  }
}

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  // Check circuit breaker before attempting
  checkCircuitBreaker();

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_DB_RETRIES; attempt += 1) {
    try {
      const result = await operation();
      recordSuccess();
      return result;
    } catch (error) {
      lastError = error;

      // Visibility, not control flow: the error still propagates exactly as before. Many
      // callers turn it into an empty result set, so without this line a wrong column or a
      // missing table is indistinguishable from "no rows matched".
      if (isSchemaOrLogicDbError(error)) {
        console.error(`[mysql] ${describeDbError(error)}`);
      }

      // Connection pressure should fail fast for this request. Retrying would
      // add load, but one short deployment spike should not freeze all logins.
      if (isConnectionPressureDbError(error)) {
        recordFailure(error);
        throw error;
      }

      // Transient connection errors: retry with backoff, trip breaker only on exhaustion
      if (isTransientDbError(error)) {
        if (attempt === MAX_DB_RETRIES - 1) {
          recordFailure(error);
        }
        if (attempt < MAX_DB_RETRIES - 1) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw error;
      }

      // InnoDB lock contention: log it, fail fast, no retry, no circuit breaker.
      // The blocker is another transaction; retrying wastes a connection.
      if (isLockContentionDbError(error)) {
        console.error(`[mysql] ${describeDbError(error)}`);
        throw error;
      }

      // Application/SQL errors (bad query, wrong arguments, missing column, etc.)
      // do NOT count against the circuit breaker — they are code bugs, not DB failures.
      throw error;
    }
  }

  throw lastError;
}

/**
 * Typed db facade that accepts unknown[] params (mysql2 requires ExecuteValues,
 * but services build dynamic param arrays typed as unknown[]).
 */
type ExecuteParams = Parameters<Pool["execute"]>[1];

/** Same LIMIT/OFFSET rewrite for statements run on a connection taken for a transaction. Patched once per connection. */
const patchedConnections = new WeakSet<object>();
function patchConnectionExecute(conn: PoolConnection): void {
  if (patchedConnections.has(conn)) return;
  patchedConnections.add(conn);
  const original = conn.execute.bind(conn) as (sql: string, params?: unknown) => Promise<unknown>;
  (conn as unknown as { execute: unknown }).execute = (sql: string, params?: unknown[]) => {
    const q = inlineLimitPlaceholders(sql, params);
    return original(q.sql, q.params);
  };
}

export const db = {
  execute<T extends QueryResult = RowDataPacket[]>(
    sql: string,
    params?: unknown[],
  ): Promise<[T, FieldPacket[]]> {
    // A bound numeric LIMIT/OFFSET is rejected by this server ("Incorrect arguments to mysqld_stmt_execute");
    // turn it into the literal integer first. See limit-placeholders.ts.
    const q = inlineLimitPlaceholders(sql, params);
    return withTransientRetry(() =>
      _pool.execute<T>(q.sql, q.params as ExecuteParams),
    );
  },
  executeRun(
    sql: string,
    params?: unknown[],
  ): Promise<[QueryResult, FieldPacket[]]> {
    const q = inlineLimitPlaceholders(sql, params);
    return withTransientRetry(() =>
      _pool.execute(q.sql, q.params as ExecuteParams),
    );
  },
  async getConnection(): Promise<
    PoolConnection & {
      execute<T extends QueryResult = RowDataPacket[]>(
        sql: string,
        params?: unknown[],
      ): Promise<[T, FieldPacket[]]>;
    }
  > {
    const conn = await withTransientRetry(() => _pool.getConnection());
    patchConnectionExecute(conn);
    return conn as unknown as PoolConnection & {
      execute<T extends QueryResult = RowDataPacket[]>(
        sql: string,
        params?: unknown[],
      ): Promise<[T, FieldPacket[]]>;
    };
  },
  query<T extends QueryResult = RowDataPacket[]>(
    sql: string,
    params?: unknown[],
  ): Promise<[T, FieldPacket[]]> {
    return withTransientRetry(() =>
      _pool.query<T>(sql, params as ExecuteParams),
    );
  },
  end: _pool.end.bind(_pool),
  // Safe literal-escaping for the rare case a value must be interpolated into SQL text
  // rather than bound as a `?` placeholder (e.g. building one big template string where
  // inserting a new positional placeholder would risk misaligning existing ones). Never
  // use this for untrusted/user-supplied input — bind those with `?` instead.
  escape: _pool.escape.bind(_pool),
};

// Catch pool-level errors to avoid unhandled rejections
const poolEvents = _pool as unknown as {
  pool?: { on?: (event: string, listener: (err: Error) => void) => void };
  on?: { (event: string, listener: (err: Error) => void): void };
};

(poolEvents.pool ?? poolEvents).on?.("error", (err: Error) => {
  console.error("[mysql pool] unexpected error:", err.message);
});

export async function pingDb(): Promise<void> {
  const conn = await withTransientRetry(() => _pool.getConnection());
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

/**
 * RELIABILITY: Get circuit breaker status for health checks.
 */
export function getCircuitBreakerStatus(): {
  status: "closed" | "open" | "half-open";
  failures: number;
  lastFailure: number;
  nextProbeTime: number;
} {
  return { ...circuitBreaker };
}

/**
 * RELIABILITY: Admin-only manual reset of the circuit breaker.
 * Use when DB is confirmed healthy but the in-memory breaker is still open.
 */
export function resetCircuitBreaker(): void {
  circuitBreaker = initialCircuitBreakerState();
}

/**
 * RELIABILITY: Get pool statistics for health checks.
 */
export function getPoolStats(): {
  connectionLimit: number;
  queueLimit: number;
  connectTimeout: number;
} {
  return {
    connectionLimit: env.DB_POOL_MAX,
    queueLimit: 100,
    connectTimeout: 10000,
  };
}

/**
 * RELIABILITY: Gracefully close all connections.
 * Called during shutdown to prevent connection leaks.
 */
export async function closePool(): Promise<void> {
  try {
    await _pool.end();
  } catch (error) {
    console.error("[mysql] Error closing pool:", error);
  }
}
