-- 1078_ai_rate_limit_bucket.sql
-- Backs ai-rate-limiter.ts with a real table instead of an in-process Map.
-- The Map had no persistence and no cross-process sharing — every backend
-- process got its own independent 100/day bucket per user, and a process
-- restart silently reset everyone's counter to zero. This stack has no Redis
-- (confirmed: a sibling cache file's own comment says so, and no rate-limit
-- table existed in any prior migration) — a DB table is the natural fix.
--
-- Bucket key is (user_id, window_start) rather than a rolling 24h window from
-- first request: window_start is truncated to UTC midnight of "now", so this
-- is a calendar-day bucket, not a rolling 24h one — a small, deliberate
-- behavior shift, not hidden. Atomic single-round-trip increment via
-- INSERT ... ON DUPLICATE KEY UPDATE avoids the read-then-write race a naive
-- port would introduce under concurrent requests from the same user.

CREATE TABLE IF NOT EXISTS ai_rate_limit_bucket (
  user_id VARCHAR(100) NOT NULL,
  window_start DATETIME NOT NULL,
  request_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
