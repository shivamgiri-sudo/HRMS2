-- Migration 2074: Roster Requests hub - a real "raised at" for disputes and week-off rejections.
--
-- The hub's SLA age (and the escalation sweep) used updated_at for both kinds, which moves on any
-- later edit of the row, so a dispute re-touched by an unrelated write looked brand new again.
--
-- 1. roster_daily_assignment.disputed_at: set by POST /roster-governance/assignments/:id/dispute.
--    Backfilled from updated_at for rows that are disputed today (best value available).
-- 2. Week-off rejections need no new column: wfm_roster_assignment.employee_ack_at (migration 228)
--    is the time of the employee's response; the acknowledge handler already sets it and the reject
--    handler now does too. Only the existing rejected rows that never got it are backfilled.
--    wfm_roster_assignment has ~413k rows: the backfill touches rejected rows only, through
--    idx_wra_ack_status (employee_ack_status), and no DDL runs against that table.
--
-- Additive and idempotent: a nullable column without a default (an INSTANT add on MySQL 8), guarded
-- on information_schema; both backfills only fill NULLs.

SET @tbl := (SELECT COUNT(*) FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_daily_assignment');
SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_daily_assignment' AND COLUMN_NAME = 'disputed_at');
SET @ddl := IF(@tbl = 1 AND @has_col = 0,
               'ALTER TABLE roster_daily_assignment ADD COLUMN disputed_at DATETIME NULL',
               'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_daily_assignment' AND COLUMN_NAME = 'disputed_at');
SET @dml := IF(@has_col = 1,
               'UPDATE roster_daily_assignment SET disputed_at = updated_at WHERE acknowledgement_status = ''disputed'' AND disputed_at IS NULL',
               'SELECT 1');
PREPARE stmt FROM @dml; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_col := (SELECT COUNT(*) FROM information_schema.COLUMNS
                  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'employee_ack_at');
SET @dml := IF(@has_col = 1,
               'UPDATE wfm_roster_assignment SET employee_ack_at = updated_at WHERE employee_ack_status = ''rejected'' AND employee_ack_at IS NULL',
               'SELECT 1');
PREPARE stmt FROM @dml; EXECUTE stmt; DEALLOCATE PREPARE stmt;
