-- ============================================================
-- Migration 228: wfm_roster_assignment — full lifecycle status columns
--
-- Adds employee acknowledgement, manager action, and RTA publish
-- tracking directly to the operational roster assignment table.
-- This table becomes the single source of truth for RTA state.
--
-- SAFE: All ADD COLUMN IF NOT EXISTS, all nullable or have safe defaults.
-- Existing rows: all new status columns default to NULL / 'pending' /
--   'generated' — engine and RTA sync guard handle NULL as legacy draft.
--
-- ROLLBACK:
--   ALTER TABLE wfm_roster_assignment
--     DROP COLUMN IF EXISTS cycle_id,
--     DROP COLUMN IF EXISTS shift_template_id,
--     DROP COLUMN IF EXISTS is_week_off,
--     DROP COLUMN IF EXISTS final_roster_status,
--     DROP COLUMN IF EXISTS employee_ack_status,
--     DROP COLUMN IF EXISTS employee_ack_at,
--     DROP COLUMN IF EXISTS employee_rejection_reason,
--     DROP COLUMN IF EXISTS manager_action_status,
--     DROP COLUMN IF EXISTS manager_action_by,
--     DROP COLUMN IF EXISTS manager_action_at,
--     DROP COLUMN IF EXISTS manager_action_reason,
--     DROP COLUMN IF EXISTS system_decision_reason,
--     DROP COLUMN IF EXISTS published_to_rta_at;
--   DROP INDEX IF EXISTS idx_wra_cycle ON wfm_roster_assignment;
--   DROP INDEX IF EXISTS idx_wra_final_status ON wfm_roster_assignment;
--   DROP INDEX IF EXISTS idx_wra_ack_status ON wfm_roster_assignment;
-- ============================================================

  -- Link to governance cycle (roster_daily_assignment is the governance table;
  -- this FK gives us the cross-reference without duplicating data)
SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'cycle_id'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN cycle_id          VARCHAR(36)  NULL COMMENT ''FK weekly_roster_cycle.id — set when assignment originates from a cycle''
    AFTER plan_id',
  'SELECT "cycle_id already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

  -- Shift template reference (wfm_shift_template) in addition to legacy shift_id (wfm_shift_master)
SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'shift_template_id'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN shift_template_id VARCHAR(36)  NULL COMMENT ''FK wfm_shift_template.id — preferred over shift_id for new assignments''
    AFTER cycle_id',
  'SELECT "shift_template_id already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

  -- Week-off flag
SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'is_week_off'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN is_week_off       TINYINT(1)   NOT NULL DEFAULT 0
    AFTER shift_template_id',
  'SELECT "is_week_off already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

  -- ── Final lifecycle status (source of truth for RTA) ──────────────────────
SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'final_roster_status'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN final_roster_status ENUM(
    ''generated'',
    ''pending_employee_ack'',
    ''acknowledged'',
    ''rejected_by_employee'',
    ''pending_manager_action'',
    ''realigned_by_manager'',
    ''force_approved_by_manager'',
    ''escalated_to_hr'',
    ''approved_final'',
    ''published_to_rta''
  ) NOT NULL DEFAULT ''generated''
  COMMENT ''Lifecycle status — RTA must only consume approved_final / force_approved_by_manager / realigned_by_manager / published_to_rta''',
  'SELECT "final_roster_status already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

  -- ── Employee acknowledgement ───────────────────────────────────────────────
SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'employee_ack_status'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN employee_ack_status       ENUM(''pending'',''acknowledged'',''rejected'')
                                                     NOT NULL DEFAULT ''pending''',
  'SELECT "employee_ack_status already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'employee_ack_at'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN employee_ack_at           DATETIME     NULL',
  'SELECT "employee_ack_at already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

SET @mcol_7 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'employee_rejection_reason'
);
SET @msql_7 = IF(@mcol_7 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN employee_rejection_reason VARCHAR(500) NULL',
  'SELECT "employee_rejection_reason already exists" AS message');
PREPARE mstmt_7 FROM @msql_7;
EXECUTE mstmt_7;
DEALLOCATE PREPARE mstmt_7;

  -- ── Manager action ─────────────────────────────────────────────────────────
SET @mcol_8 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'manager_action_status'
);
SET @msql_8 = IF(@mcol_8 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN manager_action_status     ENUM(
    ''pending'',''realigned'',''force_approved'',''escalated'',''rejected_request''
  ) NULL',
  'SELECT "manager_action_status already exists" AS message');
PREPARE mstmt_8 FROM @msql_8;
EXECUTE mstmt_8;
DEALLOCATE PREPARE mstmt_8;

SET @mcol_9 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'manager_action_by'
);
SET @msql_9 = IF(@mcol_9 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN manager_action_by         VARCHAR(36)  NULL COMMENT ''auth_user.id who acted''',
  'SELECT "manager_action_by already exists" AS message');
PREPARE mstmt_9 FROM @msql_9;
EXECUTE mstmt_9;
DEALLOCATE PREPARE mstmt_9;

SET @mcol_10 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'manager_action_at'
);
SET @msql_10 = IF(@mcol_10 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN manager_action_at         DATETIME     NULL',
  'SELECT "manager_action_at already exists" AS message');
PREPARE mstmt_10 FROM @msql_10;
EXECUTE mstmt_10;
DEALLOCATE PREPARE mstmt_10;

SET @mcol_11 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'manager_action_reason'
);
SET @msql_11 = IF(@mcol_11 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN manager_action_reason     VARCHAR(500) NULL',
  'SELECT "manager_action_reason already exists" AS message');
PREPARE mstmt_11 FROM @msql_11;
EXECUTE mstmt_11;
DEALLOCATE PREPARE mstmt_11;

  -- ── System / engine metadata ───────────────────────────────────────────────
SET @mcol_12 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'system_decision_reason'
);
SET @msql_12 = IF(@mcol_12 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN system_decision_reason    VARCHAR(500) NULL COMMENT ''Why the engine made this assignment''',
  'SELECT "system_decision_reason already exists" AS message');
PREPARE mstmt_12 FROM @msql_12;
EXECUTE mstmt_12;
DEALLOCATE PREPARE mstmt_12;

SET @mcol_13 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND COLUMN_NAME = 'published_to_rta_at'
);
SET @msql_13 = IF(@mcol_13 = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN published_to_rta_at       DATETIME     NULL',
  'SELECT "published_to_rta_at already exists" AS message');
PREPARE mstmt_13 FROM @msql_13;
EXECUTE mstmt_13;
DEALLOCATE PREPARE mstmt_13;

-- Indexes for RTA sync and manager review queue
SET @midx_101 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND INDEX_NAME = 'idx_wra_cycle'
);
SET @midxsql_101 = IF(@midx_101 = 0,
  'ALTER TABLE wfm_roster_assignment ADD INDEX idx_wra_cycle        (cycle_id)',
  'SELECT "idx_wra_cycle already exists" AS message');
PREPARE midxstmt_101 FROM @midxsql_101;
EXECUTE midxstmt_101;
DEALLOCATE PREPARE midxstmt_101;

SET @midx_102 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND INDEX_NAME = 'idx_wra_final_status'
);
SET @midxsql_102 = IF(@midx_102 = 0,
  'ALTER TABLE wfm_roster_assignment ADD INDEX idx_wra_final_status (final_roster_status)',
  'SELECT "idx_wra_final_status already exists" AS message');
PREPARE midxstmt_102 FROM @midxsql_102;
EXECUTE midxstmt_102;
DEALLOCATE PREPARE midxstmt_102;

SET @midx_103 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment' AND INDEX_NAME = 'idx_wra_ack_status'
);
SET @midxsql_103 = IF(@midx_103 = 0,
  'ALTER TABLE wfm_roster_assignment ADD INDEX idx_wra_ack_status   (employee_ack_status)',
  'SELECT "idx_wra_ack_status already exists" AS message');
PREPARE midxstmt_103 FROM @midxsql_103;
EXECUTE midxstmt_103;
DEALLOCATE PREPARE midxstmt_103;

SELECT '228_wfm_roster_assignment_lifecycle.sql applied successfully' AS migration_status;
