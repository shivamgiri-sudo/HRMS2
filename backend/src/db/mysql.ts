import mysql, { type RowDataPacket, type FieldPacket, type QueryResult, type Pool, type PoolConnection } from "mysql2/promise";
import { env } from "../config/env.js";

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
 * NOTE: ER_CON_COUNT_ERROR is NOT included — connection exhaustion should NOT
 * be retried as it makes the problem worse. Return 503 immediately instead.
 */
const TRANSIENT_DB_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "PROTOCOL_CONNECTION_LOST",
  "ECONNRESET",
]);

/**
 * Non-retryable errors — return 503 immediately.
 */
const NON_RETRYABLE_DB_ERROR_CODES = new Set([
  "ER_CON_COUNT_ERROR",  // Connection exhaustion — retry makes it worse
  "ER_TOO_MANY_USER_CONNECTIONS",
]);

const MAX_DB_RETRIES = 3;

/**
 * RELIABILITY: Circuit breaker state.
 * Prevents cascading failures when DB is overwhelmed.
 */
interface CircuitBreakerState {
  status: "closed" | "open" | "half-open";
  failures: number;
  lastFailure: number;
  nextProbeTime: number;
}

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5, // Open after N consecutive failures
  recoveryTimeMs: 30000, // Wait 30s before probing
  halfOpenSuccessThreshold: 2, // Close after N successes in half-open
};

let circuitBreaker: CircuitBreakerState = {
  status: "closed",
  failures: 0,
  lastFailure: 0,
  nextProbeTime: 0,
};

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

function isNonRetryableDbError(error: unknown): boolean {
  return NON_RETRYABLE_DB_ERROR_CODES.has(getErrorCode(error));
}

/**
 * RELIABILITY: Check circuit breaker before attempting operation.
 * Throws immediately if circuit is open (fast-fail).
 */
function checkCircuitBreaker(): void {
  const now = Date.now();

  if (circuitBreaker.status === "open") {
    if (now >= circuitBreaker.nextProbeTime) {
      // Transition to half-open, allow probe
      circuitBreaker.status = "half-open";
      circuitBreaker.failures = 0;
    } else {
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
  if (circuitBreaker.status === "half-open") {
    circuitBreaker.failures++;
    if (circuitBreaker.failures >= CIRCUIT_BREAKER_CONFIG.halfOpenSuccessThreshold) {
      // Close circuit after successful probes
      circuitBreaker = { status: "closed", failures: 0, lastFailure: 0, nextProbeTime: 0 };
    }
  } else if (circuitBreaker.status === "closed" && circuitBreaker.failures > 0) {
    // Reset failure count on success
    circuitBreaker.failures = 0;
  }
}

/**
 * RELIABILITY: Record operation failure for circuit breaker.
 */
function recordFailure(error: unknown): void {
  const now = Date.now();
  circuitBreaker.lastFailure = now;

  if (isNonRetryableDbError(error)) {
    // Non-retryable errors (connection exhaustion) trip circuit immediately
    circuitBreaker.status = "open";
    circuitBreaker.nextProbeTime = now + CIRCUIT_BREAKER_CONFIG.recoveryTimeMs;
    return;
  }

  if (circuitBreaker.status === "half-open") {
    // Failure during probe — re-open circuit
    circuitBreaker.status = "open";
    circuitBreaker.nextProbeTime = now + CIRCUIT_BREAKER_CONFIG.recoveryTimeMs;
    return;
  }

  circuitBreaker.failures++;
  if (circuitBreaker.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    circuitBreaker.status = "open";
    circuitBreaker.nextProbeTime = now + CIRCUIT_BREAKER_CONFIG.recoveryTimeMs;
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

      // Non-retryable errors should fail immediately
      if (isNonRetryableDbError(error)) {
        recordFailure(error);
        throw error;
      }

      if (!isTransientDbError(error) || attempt === MAX_DB_RETRIES - 1) {
        recordFailure(error);
        throw error;
      }

      await sleep(250 * (attempt + 1));
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
