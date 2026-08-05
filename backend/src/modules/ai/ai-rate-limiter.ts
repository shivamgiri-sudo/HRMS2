/**
 * PeopleOS Copilot — Per-User Rate Limiter
 *
 * DB-backed sliding-window rate limiter for AI endpoints (ai_rate_limit_bucket,
 * migration 1078). Previously an in-process in-memory Map — no persistence, no
 * cross-process sharing, so each backend process had its own independent
 * 100/day bucket per user and a restart silently reset everyone's counter to
 * zero. No Redis exists in this stack, so a DB table is the fix.
 *
 * Bucket key is (user_id, window_start) where window_start is the calendar
 * day (local server midnight, matching the "today"/"month" boundary
 * convention already used elsewhere in ai-audit.service.ts), not a rolling
 * 24h window from first request — a small, deliberate behavior shift from the
 * old Map's semantics, stated here rather than hidden.
 *
 * Limits are resolved from the active provider's DB config first, then fall
 * back to the module-level default.
 *
 * Deliberately NOT in this pass: a per-minute/burst limit dimension. This is
 * about making the daily limit actually global across processes, not adding a
 * new limit dimension.
 */

import { db } from '../../db/mysql.js';

const DEFAULT_DAILY_REQUEST_LIMIT = 100;
const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

function todayWindowStart(): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

/**
 * Check and increment the per-user request counter.
 * @param userId       authenticated user ID
 * @param dailyLimit   provider-configured limit (0 = use default)
 */
export async function checkAndIncrement(userId: string, dailyLimit = 0): Promise<RateLimitResult> {
  const limit = dailyLimit > 0 ? dailyLimit : DEFAULT_DAILY_REQUEST_LIMIT;
  const windowStart = todayWindowStart();
  const resetAt = new Date(windowStart.getTime() + WINDOW_MS);

  // Single round trip, atomic: LAST_INSERT_ID(expr) smuggles the post-
  // increment count out through the OK packet's insertId even though this
  // table has no AUTO_INCREMENT column — the standard MySQL idiom for an
  // atomic increment-and-read, avoiding the read-then-write race a naive
  // SELECT-then-UPDATE port would introduce under concurrent requests from
  // the same user. LAST_INSERT_ID(expr) is only evaluated on whichever
  // branch actually runs, so the VALUES clause must wrap the initial count
  // in it too — otherwise the very first request of the day (the plain
  // INSERT branch, no key conflict) would leave insertId unset/stale instead
  // of reflecting the row's real count of 1.
  //
  // Increments unconditionally, even past `limit` — tried pinning
  // request_count at the ceiling (matching the old in-memory version's
  // never-increment-once-denied behavior) via a CASE expression, but that
  // makes "just reached the limit this call" (allow) and "already pinned
  // there from an earlier call" (deny) indistinguishable from the single
  // returned count — both collapse to the same value, so every request past
  // the limit would incorrectly be allowed. Confirmed by simulating it
  // before shipping. The unconditional increment is simpler and correct:
  // remaining is clamped to 0 either way, and the only cost is a cosmetic
  // one — request_count can exceed `limit` in storage for a client that
  // keeps calling after being denied (e.g. 600 for 500 rejected requests) —
  // harmless, since nothing reads the raw stored count today (peekUsage has
  // zero callers, confirmed by grep).
  const [result] = await db.execute<any>(
    `INSERT INTO ai_rate_limit_bucket (user_id, window_start, request_count)
     VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE request_count = LAST_INSERT_ID(request_count + 1)`,
    [userId, windowStart],
  );
  const count = Number((result as { insertId?: number }).insertId || 1);

  if (count > limit) {
    return { allowed: false, remaining: 0, resetAt };
  }
  return { allowed: true, remaining: Math.max(0, limit - count), resetAt };
}

/** Read current usage without modifying it (for tests / admin endpoints). */
export async function peekUsage(userId: string): Promise<{ count: number }> {
  const [rows] = await db.execute<any[]>(
    `SELECT request_count FROM ai_rate_limit_bucket WHERE user_id = ? AND window_start = ?`,
    [userId, todayWindowStart()],
  );
  return { count: Number(rows[0]?.request_count || 0) };
}

/** Reset a user's bucket for today (for testing / admin override). */
export async function resetBucket(userId: string): Promise<void> {
  await db.execute(
    `DELETE FROM ai_rate_limit_bucket WHERE user_id = ? AND window_start = ?`,
    [userId, todayWindowStart()],
  );
}
