-- 1671_payroll_run_cost_centre_scope.sql
--
-- Lets a payroll run cover a chosen set of cost centres instead of the whole company.
--
-- THE PROBLEM. Every one of the 104 rows in salary_prep_run is company-wide: branch_filter,
-- process_filter, branch_id and process_id are NULL on all of them. So one blocked branch holds up
-- everybody. Measured 2026-09-04, August 2026 sat at 52 branch/process readiness rows 'blocked'
-- with 0 Branch Head sign-offs, while three HEAD OFFICE cost centres had already cleared all three
-- attendance approval stages and could have been paid.
--
-- WHY A TABLE AND NOT A COLUMN. A run covers many cost centres, possibly spanning branches, so the
-- relationship is many-to-many. Holding it as a JSON list on the run would leave nothing able to
-- enforce that a cost centre belongs to only one run in a month -- and the thing that guards
-- against is paying somebody twice. UNIQUE (run_month, cost_centre_id) makes a second claim a
-- constraint violation rather than something application code has to remember to check. The
-- service layer checks it too, but only so the caller gets a message naming the clashing run; this
-- key is what actually guarantees it. Cancelling a run deletes its scope rows, releasing those
-- cost centres for a fresh run.
--
-- WHY THE LINE IS STAMPED. employees.cost_centre_id is current-state only -- the effective-dated
-- employee_cost_centre_allocation table exists but holds 0 rows -- so a salary register that
-- derives cost centre from the employee changes retroactively when somebody transfers, and a cost
-- centre that was paid can later read as unpaid. Stamping branch and cost centre onto the line at
-- calculation freezes where each person was actually paid, and makes "which cost centres have been
-- run this month" answerable from the lines themselves.
--
-- TYPES MATCHED DELIBERATELY. salary_prep_run.id, salary_prep_line.id, cost_centre_master.id and
-- branch_master.id are all char(36) utf8mb4_unicode_ci, and run_month is varchar(7)
-- utf8mb4_unicode_ci -- verified against information_schema before writing this. 58 of this
-- schema's tables carry drifted collation, and a mismatch here would silently stop every future
-- join to this table from using its index.
--
-- PURELY ADDITIVE. One new table, one enum column, two nullable columns, one index. No existing
-- column is altered, no row is modified, nothing is dropped. Existing runs are marked 'company' by
-- the column default and keep selecting exactly the population they always did; their lines keep
-- NULL stamps and are never backfilled.
--
-- NOT YET APPLIED.
--
-- Rollback:
--   DROP TABLE IF EXISTS salary_prep_run_scope;
--   ALTER TABLE salary_prep_run DROP COLUMN scope_kind;
--   ALTER TABLE salary_prep_line DROP COLUMN branch_id, DROP COLUMN cost_centre_id;

USE mas_hrms;

CREATE TABLE IF NOT EXISTS salary_prep_run_scope (
  id             CHAR(36)   COLLATE utf8mb4_unicode_ci NOT NULL,
  run_id         CHAR(36)   COLLATE utf8mb4_unicode_ci NOT NULL,
  run_month      VARCHAR(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  branch_id      CHAR(36)   COLLATE utf8mb4_unicode_ci NOT NULL,
  cost_centre_id CHAR(36)   COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- The double-payment guard. One cost centre, one live run, one month.
  UNIQUE KEY uq_scope_month_cost_centre (run_month, cost_centre_id),
  KEY idx_scope_run (run_id),
  KEY idx_scope_month_branch (run_month, branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- salary_prep_run.scope_kind -----------------------------------------------------------------
-- 'company' is the default so all 104 existing rows keep their present behaviour without an
-- UPDATE. Guarded on information_schema because an unguarded ALTER against a column that already
-- exists aborts the whole migration run at boot.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'salary_prep_run'
              AND COLUMN_NAME = 'scope_kind');
SET @s := IF(@c = 0,
  "ALTER TABLE salary_prep_run ADD COLUMN scope_kind ENUM('company','scoped') NOT NULL DEFAULT 'company'",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- salary_prep_line stamps --------------------------------------------------------------------
-- Nullable, because the 104 legacy runs' lines have no stamp and are not backfilled. The register
-- falls back to the employee's current cost centre for those, exactly as it does today.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'salary_prep_line'
              AND COLUMN_NAME = 'branch_id');
SET @s := IF(@c = 0,
  'ALTER TABLE salary_prep_line
     ADD COLUMN branch_id      CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
     ADD COLUMN cost_centre_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Supports the month-coverage rollup, which groups the month's lines by cost centre.
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'salary_prep_line'
              AND INDEX_NAME = 'idx_spl_cost_centre');
SET @s := IF(@c = 0,
  'CREATE INDEX idx_spl_cost_centre ON salary_prep_line (cost_centre_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Verification (expect scope_kind='company' on all existing rows, and an empty scope table):
-- SELECT scope_kind, COUNT(*) FROM salary_prep_run GROUP BY scope_kind;
-- SELECT COUNT(*) FROM salary_prep_run_scope;
