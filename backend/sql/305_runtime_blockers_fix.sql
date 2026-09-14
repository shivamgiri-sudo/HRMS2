-- Migration 305: Runtime blockers fix
-- Fixes: exit_retention_action table, auth_user_id alias, employee column gaps
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, ALTER TABLE with CALL _m305_add_col helper

DELIMITER $$
CREATE PROCEDURE IF NOT EXISTS _m305_add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN def TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', def);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- ── Fix 1: Create exit_retention_action (missing table used by resignation lifecycle) ──
CREATE TABLE IF NOT EXISTS exit_retention_action (
  id               CHAR(36)    NOT NULL,
  exit_request_id  CHAR(36)    NOT NULL,
  action_type      VARCHAR(50) NOT NULL COMMENT 'status_change/offer/discussion/other',
  action_summary   TEXT        DEFAULT NULL,
  outcome          VARCHAR(30) DEFAULT NULL,
  performed_by     CHAR(36)    DEFAULT NULL,
  performed_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_exit (exit_request_id),
  INDEX idx_performed_at (performed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Fix 2: Add auth_user_id alias column to employees (phone OTP lookup) ──
-- auth.service.ts uses employees.auth_user_id but the column is user_id
-- Add a generated column as an alias so existing code works without a full service change
CALL _m305_add_col('employees', 'auth_user_id',
  'CHAR(36) GENERATED ALWAYS AS (user_id) STORED COMMENT ''alias for user_id — used by phone OTP lookup''');

-- ── Fix 3: Ensure candidate_name_match_summary has overall_status (migration 295 already adds it) ──
-- Employee code gate service queries overall_match_status but migration 295 uses overall_status
-- Add overall_match_status as alias if not present
CALL _m305_add_col('candidate_name_match_summary', 'overall_match_status',
  'VARCHAR(20) GENERATED ALWAYS AS (overall_status) STORED COMMENT ''alias for overall_status — used by employee-code-gate''');

-- ── Fix 4: BGV status ENUM extension ──
-- employee-code-gate checks for completed/approved/cleared but migration 241 only has pending/in_progress/verified/failed
-- Extend ENUM to include completed, approved, cleared
ALTER TABLE ats_bgv_verification
  MODIFY COLUMN verification_status
    ENUM('pending','in_progress','verified','failed','completed','approved','cleared')
    NOT NULL DEFAULT 'pending';

-- ── Fix 5: Incentive tables — ensure pay_month alias ──
-- incentives.routes.ts uses pay_month but migration 291 uses salary_month
-- Add pay_month as alias if not present
CALL _m305_add_col('incentive_upload_batch', 'pay_month',
  'CHAR(7) GENERATED ALWAYS AS (salary_month) STORED COMMENT ''alias for salary_month''');

CALL _m305_add_col('incentive_payroll_register', 'pay_month',
  'CHAR(7) GENERATED ALWAYS AS (salary_month) STORED COMMENT ''alias for salary_month''');

-- ── Fix 6: Incentive approval step columns ──
-- incentives.routes.ts uses actioned_by/actioned_at but migration 291 uses approver_user_id/decided_at
CALL _m305_add_col('incentive_approval_step', 'actioned_by',
  'CHAR(36) GENERATED ALWAYS AS (approver_user_id) STORED COMMENT ''alias for approver_user_id''');

-- decided_at → actioned_at: need a real column since routes UPDATE actioned_at
CALL _m305_add_col('incentive_approval_step', 'actioned_at',
  'DATETIME DEFAULT NULL COMMENT ''alias for decided_at — set by approval routes''');

-- ── Fix 7: incentive_payroll_register — add register_ref column ──
CALL _m305_add_col('incentive_payroll_register', 'register_ref',
  'VARCHAR(100) DEFAULT NULL COMMENT ''human-readable register reference''');

-- ── Fix 8: ats_candidate — add employee_code column if missing ──
CALL _m305_add_col('ats_candidate', 'employee_code',
  'VARCHAR(50) DEFAULT NULL COMMENT ''generated employee code''');

-- ── Fix 9: task_tat_instance — add title/description/owner columns used by inbox.service.ts ──
CALL _m305_add_col('task_tat_instance', 'task_title',
  'VARCHAR(255) DEFAULT NULL COMMENT ''human-readable task title''');
CALL _m305_add_col('task_tat_instance', 'task_description',
  'TEXT DEFAULT NULL');
CALL _m305_add_col('task_tat_instance', 'owner_user_id',
  'CHAR(36) DEFAULT NULL COMMENT ''direct user assignment (complements assigned_to)''');
CALL _m305_add_col('task_tat_instance', 'owner_role',
  'VARCHAR(50) DEFAULT NULL COMMENT ''role pool assignment''');
CALL _m305_add_col('task_tat_instance', 'reference_type',
  'VARCHAR(50) GENERATED ALWAYS AS (entity_type) STORED COMMENT ''alias for entity_type''');
CALL _m305_add_col('task_tat_instance', 'reference_id',
  'CHAR(36) GENERATED ALWAYS AS (entity_id) STORED COMMENT ''alias for entity_id''');
CALL _m305_add_col('task_tat_instance', 'priority',
  'VARCHAR(20) NOT NULL DEFAULT ''normal'' COMMENT ''urgent/high/normal/low''');

-- ── Fix 10: Back-fill task_tat_instance.owner_user_id from assigned_to ──
UPDATE task_tat_instance
  SET owner_user_id = assigned_to
  WHERE owner_user_id IS NULL AND assigned_to IS NOT NULL;

DROP PROCEDURE IF EXISTS _m305_add_col;
