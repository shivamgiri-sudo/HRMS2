import mysql, { type RowDataPacket, type FieldPacket, type QueryResult, type Pool, type PoolConnection } from "mysql2/promise";
import { env } from "../config/env.js";
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
 * - Circuit breaker: fast-fails when DB is overwhelmed
 */
const _pool: Pool = mysql.createPool({
  host:               env.DB_HOST,
  port:               env.DB_PORT,
  user:               env.DB_USER,
  password:           env.DB_PASSWORD,
  database:           env.DB_NAME,
  connectionLimit:    env.DB_POOL_MAX,
  waitForConnections: true,
  queueLimit:         100, // SECURITY: bounded queue prevents memory exhaustion
  connectTimeout:     10000, // 10s timeout to establish connection
  timezone:           "+05:30",  // Always IST regardless of server OS timezone
  dateStrings:        true,      // Return DATETIME/TIMESTAMP as strings, not JS Date objects
  decimalNumbers:     true,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 30000, // 30s keep-alive
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
  "ER_CON_COUNT_ERROR",  // Connection exhaustion -- retry makes it worse
  "ER_TOO_MANY_USER_CONNECTIONS",
  "POOL_ENQUEUELIMIT",
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

function isConnectionPressureDbError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (CONNECTION_PRESSURE_DB_ERROR_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : "";
  return /queue limit reached|too many connections|too many user connections/i.test(message);
}

/**
 * RELIABILITY: Check circuit breaker before attempting operation.
 * Throws immediately if circuit is open (fast-fail).
 */
function checkCircuitBreaker(): void {
  const now = Date.now();

  if (circuitBreaker.status === "open") {
    circuitBreaker = checkCircuitBreakerState(circuitBreaker, CIRCUIT_BREAKER_CONFIG, now);
    if (circuitBreaker.status === "open") {
      const retryAfter = Math.ceil((circuitBreaker.nextProbeTime - now) / 1000);
      const error = new Error(`Database circuit breaker open. Retry after ${retryAfter}s`);
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
  circuitBreaker = recordCircuitBreakerSuccess(circuitBreaker, CIRCUIT_BREAKER_CONFIG);
}

/**
 * RELIABILITY: Record operation failure for circuit breaker.
 */
function recordFailure(): void {
  const now = Date.now();
  circuitBreaker = recordCircuitBreakerFailure(circuitBreaker, CIRCUIT_BREAKER_CONFIG, now);
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

      // Connection pressure should fail fast for this request. Retrying would
      // add load, but one short deployment spike should not freeze all logins.
      if (isConnectionPressureDbError(error)) {
        recordFailure();
        throw error;
      }

      // Transient connection errors: retry with backoff, trip breaker only on exhaustion
      if (isTransientDbError(error)) {
        if (attempt === MAX_DB_RETRIES - 1) {
          recordFailure();
        }
        if (attempt < MAX_DB_RETRIES - 1) {
          await sleep(250 * (attempt + 1));
          continue;
        }
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

export const db = {
  execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> {
    return withTransientRetry(() => _pool.execute<T>(sql, params as ExecuteParams));
  },
  executeRun(sql: string, params?: unknown[]): Promise<[QueryResult, FieldPacket[]]> {
    return withTransientRetry(() => _pool.execute(sql, params as ExecuteParams));
  },
  async getConnection(): Promise<PoolConnection & { execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> }> {
    const conn = await withTransientRetry(() => _pool.getConnection());
    return conn as unknown as PoolConnection & { execute<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> };
  },
  query<T extends QueryResult = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, FieldPacket[]]> {
    return withTransientRetry(() => _pool.query<T>(sql, params as ExecuteParams));
  },
  end: _pool.end.bind(_pool),
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
