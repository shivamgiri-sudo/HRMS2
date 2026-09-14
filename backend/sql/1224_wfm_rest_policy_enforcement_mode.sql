-- 1224 — WARN / BLOCK enforcement mode for the minimum-rest policy.
--
-- Owner ruling 2026-08-16 (decision 2): build WARN mode first, then activate the 11-hour
-- policy in WARN. Never switch straight to BLOCK.
--
-- Why a mode is needed rather than a second policy table: all four roster write paths
-- (weekly generation, auto-roster sync, manual assignment, bulk upload) resolve rest through
-- the one canonical resolver in rest-policy.service.ts, and the ruling is explicit that
-- enforcement must not be weakened separately in any of them. A column on the policy keeps
-- one decision point — the resolver reads the mode, every path obeys it.
--
-- DEFAULT 'block' deliberately. It preserves exactly today's behaviour for any policy row that
-- already exists or is created without an explicit mode, so this migration cannot loosen
-- enforcement on its own. The 11-hour organisation policy is seeded separately, in WARN, as a
-- configuration step under the owner's control.
--
-- Note there are no policy rows in production at all (wfm_rest_policy is empty), so this ALTER
-- rewrites nothing. That empty state is itself why roster generation currently fails closed
-- with REST_POLICY_MISSING.
--
-- Guarded with information_schema + PREPARE/EXECUTE rather than ADD COLUMN IF NOT EXISTS:
-- that syntax is not supported on this MySQL 8 server and fails while still being recorded as
-- applied, which is the exact failure mode that produced the 2026-08-13 outage. Re-runnable.

SET @c_enforcement_mode := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_rest_policy' AND COLUMN_NAME = 'enforcement_mode');

SET @add_enforcement_mode := IF(@c_enforcement_mode = 0,
  'ALTER TABLE wfm_rest_policy ADD COLUMN enforcement_mode ENUM(''warn'',''block'') NOT NULL DEFAULT ''block'' AFTER minimum_rest_minutes',
  'SELECT "enforcement_mode already exists" AS info');

PREPARE stmt FROM @add_enforcement_mode;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
