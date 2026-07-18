/**
 * PeopleOS Copilot — Per-User Rate Limiter
 *
 * In-process sliding-window rate limiter for AI endpoints.
 * Uses an in-memory Map keyed by userId (no Redis dependency).
 * TTL cleanup runs on every check — no background timer needed.
 *
 * Limits are resolved from the active provider's DB config first,
 * then fall back to the module-level default.
 */

const DEFAULT_DAILY_REQUEST_LIMIT = 100;

interface BucketEntry {
  count: number;
  windowStartMs: number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24-hour rolling window

const buckets = new Map<string, BucketEntry>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now - entry.windowStartMs >= WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Check and increment the per-user request counter.
 * @param userId       authenticated user ID
 * @param dailyLimit   provider-configured limit (0 = use default)
 */
export function checkAndIncrement(userId: string, dailyLimit = 0): RateLimitResult {
  const limit = dailyLimit > 0 ? dailyLimit : DEFAULT_DAILY_REQUEST_LIMIT;
  const now = Date.now();

  evictExpired();

  const existing = buckets.get(userId);

  if (!existing || now - existing.windowStartMs >= WINDOW_MS) {
    buckets.set(userId, { count: 1, windowStartMs: now });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: new Date(now + WINDOW_MS),
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(existing.windowStartMs + WINDOW_MS),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: new Date(existing.windowStartMs + WINDOW_MS),
  };
}

/** Read current usage without modifying it (for tests / admin endpoints). */
export function peekUsage(userId: string): { count: number } {
  evictExpired();
  const entry = buckets.get(userId);
  return { count: entry?.count ?? 0 };
}

/** Reset a user's bucket (for testing / admin override). */
export function resetBucket(userId: string): void {
  buckets.delete(userId);
}
