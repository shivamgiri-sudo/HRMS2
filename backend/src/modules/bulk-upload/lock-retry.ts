
/**
 * Retry a bulk row that lost a lock race.
 *
 * WHY THIS REPLACED FOUR LOCAL COPIES
 *
 * attendance-regularization, leave, incentive and deduction each carried their own
 * `withDeadlockRetry`, and all four matched **only** `ER_LOCK_DEADLOCK` / errno 1213.
 * The live server (verified 2026-09-02) runs `innodb_lock_wait_timeout = 60`, and the
 * error real users actually hit is the other one:
 *
 *     upload_batch_row: ["Row 13: Lock wait timeout exceeded; try restarting transaction"]
 *     upload_batch_row: ["Row 1 (MAS63411): Lock wait timeout exceeded; try restarting transaction"]
 *
 * That is errno **1205**, which none of the four helpers recognised. So the row blocked
 * for a full 60 seconds, then fell straight through to the `catch` and was recorded as a
 * permanent failure — the single biggest contributor to both complaints at once: the
 * batch was slow *because* rows sat in 60-second stalls, and it "had database lock
 * issues" *because* those stalls were never retried.
 *
 * WHY 1213 AND 1205 GET DIFFERENT BUDGETS
 *
 * They cost wildly different amounts of wall-clock, so retrying them identically is wrong:
 *
 *   - **1213 (deadlock)** is detected by InnoDB's wait-for graph and raised *immediately*.
 *     A retry costs only the backoff, so it can afford several attempts. Live evidence that
 *     it needs them: BATCH-1788270838165 lost every one of its 107 rows to a single deadlock
 *     under the old 3-attempt / 50 ms budget.
 *
 *   - **1205 (lock wait timeout)** is raised only *after* blocking for the full
 *     `innodb_lock_wait_timeout` — 60 s here. Each attempt therefore costs a minute, so a
 *     5-attempt budget would spend five minutes on one row. It gets one retry: enough to
 *     survive a contended moment, not enough to hang the batch.
 *
 * Jitter is not decoration. Bulk rows run BULK_ROW_CONCURRENCY at a time against the same
 * tables, so a fixed backoff marches the collided tasks back into the lock in lockstep and
 * they simply collide again. Randomising spreads them out.
 *
 * Anything that is not a lock conflict is rethrown on the first attempt — a bad date or a
 * missing employee must surface as itself, not be retried four times and reported late.
 */
const DEADLOCK_ATTEMPTS = 5;
const LOCK_WAIT_ATTEMPTS = 2;

/** InnoDB deadlock — raised instantly, cheap to retry. */
function isDeadlock(err: unknown): boolean {
  const e = err as { code?: unknown; errno?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  return e.code === "ER_LOCK_DEADLOCK" || e.errno === 1213;
}

/** Lock wait timeout — raised only after innodb_lock_wait_timeout seconds, expensive to retry. */
function isLockWaitTimeout(err: unknown): boolean {
  const e = err as { code?: unknown; errno?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  return e.code === "ER_LOCK_WAIT_TIMEOUT" || e.errno === 1205;
}

export async function withBulkLockRetry<T>(fn: () => Promise<T>): Promise<T> {
  let deadlockTries = 0;
  let lockWaitTries = 0;

  for (;;) {
    try {
      return await fn();
    } catch (err: unknown) {
      let waitBase: number;

      if (isDeadlock(err)) {
        deadlockTries++;
        if (deadlockTries >= DEADLOCK_ATTEMPTS) throw err;
        // 150ms, 300, 600, 1200 — doubling, so a contended row backs off further each time
        // instead of hammering a lock that is plainly still held.
        waitBase = 150 * 2 ** (deadlockTries - 1);
      } else if (isLockWaitTimeout(err)) {
        lockWaitTries++;
        if (lockWaitTries >= LOCK_WAIT_ATTEMPTS) throw err;
        // The 60 s block already *was* the backoff; a further long sleep only wastes the
        // batch's time, so this one is short.
        waitBase = 250;
      } else {
        throw err;
      }

      // Full jitter over [0, waitBase). Collided tasks must not resume together.
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * waitBase)));
    }
  }
}
