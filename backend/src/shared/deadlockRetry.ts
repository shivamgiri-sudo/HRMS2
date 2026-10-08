/**
 * Retry a single, self-contained, idempotent write that lost a deadlock.
 *
 * ⚠️ SCOPE — read this before reusing it.
 *
 * This is safe ONLY for an operation that is one autocommit statement and is idempotent.
 * It must NEVER wrap a statement that runs inside an explicit transaction. MySQL rolls the
 * WHOLE transaction back when it picks a deadlock victim, so retrying just the failed
 * statement would replay one step of a transaction whose earlier steps are already gone —
 * producing a silently partial write, which is far worse than the error it was hiding.
 * A transactional caller must retry the entire transaction, not one statement of it.
 *
 * For the same reason this deliberately does NOT live in mysql.ts's withTransientRetry.
 * That wrapper sits under every db.execute in the application, including statements inside
 * transactions, so adding deadlock codes there would apply exactly the unsafe behaviour
 * described above to hundreds of call sites at once.
 *
 * WHY IT EXISTS
 *   statutory-blind-index-backfill.ts writes 53,449 single-row UPDATEs against `employees`,
 *   a live OLTP table. With no retry it aborted twice against normal application traffic —
 *   once at 13,857 rows and again at 14,191 — because one lost deadlock killed the whole
 *   run. Its UPDATE carries `WHERE <index> IS NULL`, so it is idempotent and a retry cannot
 *   double-write.
 */

/** MySQL deadlock (1213) and lock-wait timeout (1205). Both mean "try again", nothing else. */
const RETRYABLE_LOCK_CODES: ReadonlySet<string> = new Set([
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
]);
const RETRYABLE_LOCK_ERRNOS: ReadonlySet<number> = new Set([1213, 1205]);

export function isDeadlockError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  if (typeof code === "string" && RETRYABLE_LOCK_CODES.has(code)) return true;
  return typeof errno === "number" && RETRYABLE_LOCK_ERRNOS.has(errno);
}

export interface DeadlockRetryOptions {
  /** Total attempts including the first. Bounded on purpose — an unbounded retry against a
   *  genuinely contended row spins for ever and reads as a hang rather than a failure. */
  attempts?: number;
  /** Base backoff; attempt N waits delayMs * N, so the lock holder gets room to finish. */
  delayMs?: number;
  /** Called with the attempt number before each retry, so a run reports contention instead
   *  of absorbing it silently. */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Test seam. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withDeadlockRetry<T>(
  operation: () => Promise<T>,
  options: DeadlockRetryOptions = {},
): Promise<T> {
  const { attempts = 5, delayMs = 100, onRetry, sleep = defaultSleep } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      // Anything that is not a lock conflict is a real failure: surface it immediately
      // rather than retrying a wrong column until the attempt budget runs out.
      if (!isDeadlockError(error)) throw error;

      lastError = error;
      if (attempt === attempts) break;
      onRetry?.(attempt, error);
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}
