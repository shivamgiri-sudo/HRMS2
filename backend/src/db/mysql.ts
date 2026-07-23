import mysql, { type RowDataPacket, type FieldPacket, type QueryResult, type Pool, type PoolConnection } from "mysql2/promise";
import { env } from "../config/env.js";

// Connection pool configuration
const POOL_CONFIG = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_POOL_MAX,
  waitForConnections: true,
  // RELIABILITY FIX: Bounded queue prevents memory exhaustion under load
  queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 100,
  // RELIABILITY FIX: Connection acquire timeout
  acquireTimeout: Number(process.env.DB_ACQUIRE_TIMEOUT_MS) || 10000,
  timezone: "+05:30", // Always IST regardless of server OS timezone
  dateStrings: true, // Return DATETIME/TIMESTAMP as strings, not JS Date objects
  decimalNumbers: true,
  // RELIABILITY FIX: Enable keep-alive to detect dead connections
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
};

const _pool: Pool = mysql.createPool(POOL_CONFIG);

// RELIABILITY FIX: ER_CON_COUNT_ERROR is NOT transient - retrying makes it worse
// Connection exhaustion requires immediate 503, not retry loop
const TRANSIENT_DB_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ECONNRESET",
  "EPIPE",
  "PROTOCOL_CONNECTION_LOST",
]);

// Non-retryable errors that should return 503 immediately
const NON_RETRYABLE_ERROR_CODES = new Set([
  "ER_CON_COUNT_ERROR", // Too many connections - do NOT retry
  "ER_HOST_IS_BLOCKED", // Host blocked due to too many connection errors
  "ER_ACCESS_DENIED_ERROR",
]);

const MAX_DB_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 250;

// Circuit breaker state
let circuitBreakerState: "closed" | "open" | "half-open" = "closed";
let consecutiveFailures = 0;
let lastFailureTime = 0;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 30000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDbError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return TRANSIENT_DB_ERROR_CODES.has(code);
}

function isNonRetryableError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return NON_RETRYABLE_ERROR_CODES.has(code);
}

/**
 * Check circuit breaker state before attempting database operations.
 */
function checkCircuitBreaker(): void {
  if (circuitBreakerState === "open") {
    const timeSinceFailure = Date.now() - lastFailureTime;
    if (timeSinceFailure >= CIRCUIT_BREAKER_RESET_MS) {
      // Try half-open state
      circuitBreakerState = "half-open";
      console.log("[mysql] circuit breaker entering half-open state");
    } else {
      const retryAfterSeconds = Math.ceil((CIRCUIT_BREAKER_RESET_MS - timeSinceFailure) / 1000);
      const err = new Error("Database circuit breaker is open - too many consecutive failures") as Error & { code: string; retryAfter: number };
      err.code = "CIRCUIT_BREAKER_OPEN";
      err.retryAfter = retryAfterSeconds;
      throw err;
    }
  }
}

/**
 * Record success for circuit breaker.
 */
function recordSuccess(): void {
  if (circuitBreakerState !== "closed") {
    console.log("[mysql] circuit breaker closing - operation succeeded");
    circuitBreakerState = "closed";
  }
  consecutiveFailures = 0;
}

/**
 * Record failure for circuit breaker.
 */
function recordFailure(error: unknown): void {
  consecutiveFailures++;
  lastFailureTime = Date.now();

  if (isNonRetryableError(error)) {
    // Non-retryable errors immediately open circuit
    if (circuitBreakerState !== "open") {
      console.error("[mysql] circuit breaker opening due to non-retryable error");
      circuitBreakerState = "open";
    }
  } else if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    if (circuitBreakerState !== "open") {
      console.error(`[mysql] circuit breaker opening after ${consecutiveFailures} consecutive failures`);
      circuitBreakerState = "open";
    }
  }
}

async function withTransientRetry<T>(operation: () => Promise<T>): Promise<T> {
  checkCircuitBreaker();

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_DB_RETRIES; attempt += 1) {
    try {
      const result = await operation();
      recordSuccess();
      return result;
    } catch (error) {
      lastError = error;

      // RELIABILITY FIX: Non-retryable errors should fail immediately
      if (isNonRetryableError(error)) {
        recordFailure(error);
        throw error;
      }

      // Only retry transient errors
      if (!isTransientDbError(error) || attempt === MAX_DB_RETRIES - 1) {
        recordFailure(error);
        throw error;
      }

      // Exponential backoff
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[mysql] transient error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_DB_RETRIES})`);
      await sleep(delay);
    }
  }

  recordFailure(lastError);
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

  /**
   * Get circuit breaker status for health checks.
   */
  getCircuitBreakerStatus(): { state: string; consecutiveFailures: number; lastFailureTime: number } {
    return {
      state: circuitBreakerState,
      consecutiveFailures,
      lastFailureTime,
    };
  },

  /**
   * Get pool statistics for monitoring.
   */
  getPoolStats(): { limit: number; queueLimit: number } {
    return {
      limit: POOL_CONFIG.connectionLimit,
      queueLimit: POOL_CONFIG.queueLimit,
    };
  },
};

// Catch pool-level errors to avoid unhandled rejections
const poolEvents = _pool as unknown as {
  pool?: { on?: (event: string, listener: (err: Error) => void) => void };
  on?: { (event: string, listener: (err: Error) => void): void };
};

(poolEvents.pool ?? poolEvents).on?.("error", (err: Error) => {
  console.error("[mysql pool] unexpected error:", err.message);
  recordFailure(err);
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
 * Connection budget documentation.
 * Total connections = (API instances × poolMax) + (worker instances × poolMax) + (external pools × 5 each)
 * Ensure total < MySQL max_connections (typically 151 default, 500+ in production)
 *
 * Example calculation:
 * - 2 API instances × 10 pool max = 20
 * - 1 worker instance × 10 pool max = 10
 * - 3 external DB pools × 5 each = 15
 * - Total = 45 connections (well under 151 default)
 */
export const CONNECTION_BUDGET_DOC = {
  apiPoolMax: POOL_CONFIG.connectionLimit,
  queueLimit: POOL_CONFIG.queueLimit,
  acquireTimeoutMs: POOL_CONFIG.acquireTimeout,
  note: "Ensure sum of all pool connectionLimit values < MySQL max_connections",
};
