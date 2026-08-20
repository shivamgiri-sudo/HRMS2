-- Migration 1507: adds roster_daily_assignment.updated_at.
--
-- roster.governance.service.ts's shift-reassignment path (the roster amendment workflow,
-- Task 11, shipped 2026-08-20 in commit 1ab6cbae) writes
--   UPDATE roster_daily_assignment SET shift_template_id = ?, updated_at = NOW() WHERE ...
-- against a column that has never existed on this table — only created_at does. Confirmed
-- live: 0 columns named updated_at on roster_daily_assignment. Every call to this UPDATE
-- throws ER_BAD_FIELD_ERROR at runtime, so reassigning a shift via the amendment workflow
-- currently fails outright.
--
-- Adds the column matching created_at's own type (DATETIME) and the DEFAULT/ON UPDATE
-- CURRENT_TIMESTAMP convention already used elsewhere in this codebase (e.g.
-- exit_clearance_task.updated_at, wfm_header_mapping_profile.updated_at) — existing rows
-- get a real timestamp (now), not NULL, so "last updated" reads correctly from the moment
-- this migration runs rather than only after the first future write.
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'roster_daily_assignment'
              AND column_name = 'updated_at');
SET @ddl := IF(@c = 0,
  'ALTER TABLE roster_daily_assignment ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
