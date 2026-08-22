-- 1550_budget_topup_cost_centre_split.sql
--
-- WHY
-- ---
-- Group D: extends the existing budget Top-up feature (1061 request entity, 1524 direct-apply)
-- rather than building a parallel one. Today a top-up request can only raise the amount/quantity
-- of one already-existing budget line, and applying it lands the whole increase on that line's own
-- single cost-centre attribution (or no attribution at all, if the line is planning_level='branch'
-- with no allocation rows yet). Two gaps that follow directly from that:
--
--  1. A top-up that should land across more than one cost centre (e.g. a branch-wide increase to
--     "Communication & Connectivity" split 60/40 across two floors) had nowhere to record that
--     split — the request and its applied increase were both a single number against a single line.
--  2. A head/sub-head that has NO budget line at all yet (something genuinely unbudgeted, not
--     merely short) had no path through this feature — the requester would have to ask Finance to
--     re-run the whole budget through draft -> ... -> active again just to add one item.
--
-- WHAT CHANGES
-- ------------
--  - finance_budget_topup_request.budget_line_id becomes NULLable: a "new line" request (is_new_line
--    = 1) has no existing line to point at until it is approved and applied, at which point
--    applyTopupAsNewLine() creates the finance_budget_line row itself. Every EXISTING request row
--    already names a real line, so no existing row's meaning changes — is_new_line defaults to 0 and
--    the four new descriptive columns default to NULL, which is correct: no new-line request existed
--    before this migration.
--  - Four new nullable columns on finance_budget_topup_request (head, sub_head, unit, unit_rate) hold
--    the description of a brand-new line for the is_new_line=1 case only. An existing-line request
--    (is_new_line=0) leaves all four NULL and keeps reading its head/sub-head/unit/unit-rate from the
--    joined finance_budget_line, exactly as today.
--  - New table finance_budget_topup_request_split: one row per (topup request, cost centre) naming
--    how much of that request's amount/quantity lands on which cost centre. Mirrors
--    finance_budget_line_allocation's own convention from 425_branch_budget_cost_centre_allocation.sql
--    (no FK to cost_centre_master, same reasoning: this table records attribution, not identity, and
--    cost_centre_master is looked up and validated at write time in application code, same as that
--    table already does). FK to finance_budget_topup_request itself, ON DELETE CASCADE — a split row
--    has no meaning once its parent request is gone.
--
-- Purely additive: one nullability relaxation (never narrows what already fits), four nullable
-- columns with safe defaults, one new table. No existing row's meaning changes, nothing is dropped,
-- nothing is backfilled because there is nothing to backfill (no split existed before this).
--
-- Re-runnable: every ALTER is information_schema-guarded (MySQL 8 has no ADD COLUMN IF NOT EXISTS,
-- and a raw ADD COLUMN would raise a duplicate-column error on a second run); the new table is
-- CREATE TABLE IF NOT EXISTS, naturally idempotent. Migrations run at boot here (pm2 restart applies
-- the manifest), so idempotency is not optional. Pattern copied exactly from
-- 1524_budget_topup_direct_apply.sql.
--
-- ROLLBACK (manual only, not attempted here)
-- -------------------------------------------
-- DROP TABLE IF EXISTS finance_budget_topup_request_split;
-- ALTER TABLE finance_budget_topup_request
--   DROP COLUMN is_new_line, DROP COLUMN head, DROP COLUMN sub_head, DROP COLUMN unit, DROP COLUMN unit_rate;
-- ALTER TABLE finance_budget_topup_request MODIFY COLUMN budget_line_id CHAR(36) NOT NULL;
--   -- Only safe if every row still has a non-null budget_line_id at rollback time. If any is_new_line
--   -- request was ever applied (applyTopupAsNewLine backfills budget_line_id is NOT done — a new-line
--   -- request's budget_line_id stays NULL even after it is applied, since the created line is a
--   -- SEPARATE row, not this request's own budget_line_id), this MODIFY will fail with an
--   -- ER_INVALID_USE_OF_NULL / truncation error, correctly refusing to narrow a column that still
--   -- holds NULLs. Do not force it — investigate which rows are NULL first.

SET @schema := DATABASE();

-- budget_line_id NOT NULL -> NULL: only if the column is currently NOT NULL. Re-run finds it
-- already NULLable and skips. A nullable FK column is fine as-is in MySQL/InnoDB: NULL never has
-- to satisfy a foreign key, and the existing fk_budget_topup_line constraint is untouched.
SET @needs_nullable_line := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'finance_budget_topup_request'
     AND COLUMN_NAME = 'budget_line_id'
     AND IS_NULLABLE = 'NO'
);
SET @sql := IF(
  @needs_nullable_line = 1,
  'ALTER TABLE finance_budget_topup_request MODIFY COLUMN budget_line_id CHAR(36) NULL',
  'SELECT "finance_budget_topup_request.budget_line_id already nullable" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @needs_is_new_line := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'finance_budget_topup_request'
     AND COLUMN_NAME = 'is_new_line'
);
SET @sql := IF(
  @needs_is_new_line = 0,
  'ALTER TABLE finance_budget_topup_request
     ADD COLUMN is_new_line TINYINT(1) NOT NULL DEFAULT 0 AFTER is_direct',
  'SELECT "finance_budget_topup_request.is_new_line already exists" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @needs_head := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'finance_budget_topup_request'
     AND COLUMN_NAME = 'head'
);
SET @sql := IF(
  @needs_head = 0,
  'ALTER TABLE finance_budget_topup_request
     ADD COLUMN head VARCHAR(255) NULL AFTER is_new_line',
  'SELECT "finance_budget_topup_request.head already exists" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @needs_sub_head := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'finance_budget_topup_request'
     AND COLUMN_NAME = 'sub_head'
);
SET @sql := IF(
  @needs_sub_head = 0,
  'ALTER TABLE finance_budget_topup_request
     ADD COLUMN sub_head VARCHAR(255) NULL AFTER head',
  'SELECT "finance_budget_topup_request.sub_head already exists" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @needs_unit := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'finance_budget_topup_request'
     AND COLUMN_NAME = 'unit'
);
SET @sql := IF(
  @needs_unit = 0,
  'ALTER TABLE finance_budget_topup_request
     ADD COLUMN unit VARCHAR(50) NULL AFTER sub_head',
  'SELECT "finance_budget_topup_request.unit already exists" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @needs_unit_rate := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @schema
     AND TABLE_NAME = 'finance_budget_topup_request'
     AND COLUMN_NAME = 'unit_rate'
);
SET @sql := IF(
  @needs_unit_rate = 0,
  'ALTER TABLE finance_budget_topup_request
     ADD COLUMN unit_rate DECIMAL(18,4) NULL AFTER unit',
  'SELECT "finance_budget_topup_request.unit_rate already exists" AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS finance_budget_topup_request_split (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  topup_request_id CHAR(36) NOT NULL,
  cost_centre_id CHAR(36) NOT NULL,
  amount DECIMAL(18,2) NOT NULL,
  quantity DECIMAL(18,4) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_topup_split (topup_request_id, cost_centre_id),
  INDEX idx_topup_split_request (topup_request_id),
  CONSTRAINT fk_topup_split_request
    FOREIGN KEY (topup_request_id) REFERENCES finance_budget_topup_request(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1550_budget_topup_cost_centre_split.sql applied' AS migration_status;
