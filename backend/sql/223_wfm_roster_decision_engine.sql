-- Migration 223: WFM Roster Decision Engine Foundation
-- Adds decision audit trail, generation run tracking, process weekoff rules,
-- RTA sync log, and extends existing tables with new governance columns.
-- MySQL 8.4 compatibility: additive columns and constraints are guarded through
-- INFORMATION_SCHEMA rather than unsupported ADD COLUMN IF NOT EXISTS syntax.

SET @dbname = DATABASE();

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. ALTER wfm_roster_assignment — add decision traceability columns
-- ─────────────────────────────────────────────────────────────────────────────
SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='wfm_roster_assignment' AND column_name='generation_run_id');
SET @sql = IF(@cnt=0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN generation_run_id VARCHAR(36) NULL COMMENT ''FK roster_generation_run.id — NULL for manually created rows''',
  'SELECT ''wfm_roster_assignment.generation_run_id exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='wfm_roster_assignment' AND column_name='decision_source');
SET @sql = IF(@cnt=0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN decision_source ENUM(''manual'',''template'',''bulk_upload'',''swap'',''rule_engine'') NOT NULL DEFAULT ''manual'' COMMENT ''How this assignment was created''',
  'SELECT ''wfm_roster_assignment.decision_source exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idxname = 'idx_wra_generation_run';
SET @cnt = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @dbname
    AND table_name   = 'wfm_roster_assignment'
    AND index_name   = @idxname
);
SET @sql = IF(@cnt = 0,
  'ALTER TABLE wfm_roster_assignment ADD INDEX idx_wra_generation_run (generation_run_id)',
  'SELECT ''idx_wra_generation_run exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ALTER weekly_roster_cycle — acknowledgement governance columns
-- ─────────────────────────────────────────────────────────────────────────────
SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='weekly_roster_cycle' AND column_name='required_ack_pct');
SET @sql = IF(@cnt=0,
  'ALTER TABLE weekly_roster_cycle ADD COLUMN required_ack_pct DECIMAL(5,2) NOT NULL DEFAULT 80.00 COMMENT ''Min percentage of employees who must acknowledge before acknowledged status''',
  'SELECT ''weekly_roster_cycle.required_ack_pct exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='weekly_roster_cycle' AND column_name='ack_deadline');
SET @sql = IF(@cnt=0,
  'ALTER TABLE weekly_roster_cycle ADD COLUMN ack_deadline DATETIME NULL COMMENT ''Deadline for employee acknowledgements; engine auto-acks on expiry''',
  'SELECT ''weekly_roster_cycle.ack_deadline exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='weekly_roster_cycle' AND column_name='manager_review_notes');
SET @sql = IF(@cnt=0,
  'ALTER TABLE weekly_roster_cycle ADD COLUMN manager_review_notes TEXT NULL COMMENT ''Manager/WFM notes before publishing''',
  'SELECT ''weekly_roster_cycle.manager_review_notes exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ALTER roster_daily_assignment — dispute resolution columns
-- ─────────────────────────────────────────────────────────────────────────────
SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='roster_daily_assignment' AND column_name='dispute_reason');
SET @sql = IF(@cnt=0, 'ALTER TABLE roster_daily_assignment ADD COLUMN dispute_reason VARCHAR(500) NULL', 'SELECT ''roster_daily_assignment.dispute_reason exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='roster_daily_assignment' AND column_name='dispute_resolved_by');
SET @sql = IF(@cnt=0, 'ALTER TABLE roster_daily_assignment ADD COLUMN dispute_resolved_by VARCHAR(36) NULL', 'SELECT ''roster_daily_assignment.dispute_resolved_by exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='roster_daily_assignment' AND column_name='dispute_resolved_at');
SET @sql = IF(@cnt=0, 'ALTER TABLE roster_daily_assignment ADD COLUMN dispute_resolved_at DATETIME NULL', 'SELECT ''roster_daily_assignment.dispute_resolved_at exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cnt = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=@dbname AND table_name='roster_daily_assignment' AND column_name='dispute_resolution');
SET @sql = IF(@cnt=0, 'ALTER TABLE roster_daily_assignment ADD COLUMN dispute_resolution VARCHAR(500) NULL', 'SELECT ''roster_daily_assignment.dispute_resolution exists'' AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fkname = 'fk_rda_dispute_resolver';
SET @cnt = (
  SELECT COUNT(1)
  FROM information_schema.table_constraints
  WHERE constraint_schema = @dbname
    AND table_name         = 'roster_daily_assignment'
    AND constraint_name    = @fkname
);
SET @sql = IF(@cnt = 0,
  'ALTER TABLE roster_daily_assignment ADD CONSTRAINT fk_rda_dispute_resolver FOREIGN KEY (dispute_resolved_by) REFERENCES employees(id) ON DELETE SET NULL',
  'SELECT ''fk_rda_dispute_resolver exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Per-execution audit of the auto-decision engine
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roster_generation_run (
  id                    VARCHAR(36)   NOT NULL PRIMARY KEY DEFAULT (UUID()),
  cycle_id              VARCHAR(36)   NOT NULL COMMENT 'FK weekly_roster_cycle.id',
  process_id            VARCHAR(36)   NOT NULL,
  branch_id             VARCHAR(36)   NULL,
  run_type              ENUM('auto','manual_trigger','rerun') NOT NULL DEFAULT 'auto',
  parameters_json       JSON          NOT NULL COMMENT 'Inputs used: capacity config, rules, week date range',
  status                ENUM('running','completed','failed','partial') NOT NULL DEFAULT 'running',
  employees_processed   INT           NOT NULL DEFAULT 0,
  assignments_created   INT           NOT NULL DEFAULT 0,
  weekoffs_allocated    INT           NOT NULL DEFAULT 0,
  conflicts_found       INT           NOT NULL DEFAULT 0,
  error_details         JSON          NULL,
  triggered_by          VARCHAR(36)   NOT NULL COMMENT 'auth_user.id who triggered the run',
  started_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at          DATETIME      NULL,
  INDEX idx_rgr_cycle   (cycle_id),
  INDEX idx_rgr_process (process_id),
  INDEX idx_rgr_status  (status),
  CONSTRAINT fk_rgr_cycle FOREIGN KEY (cycle_id)
    REFERENCES weekly_roster_cycle(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Per-employee-per-date decision trace
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roster_decision_audit (
  id                          VARCHAR(36)   NOT NULL PRIMARY KEY DEFAULT (UUID()),
  run_id                      VARCHAR(36)   NOT NULL COMMENT 'FK roster_generation_run.id',
  cycle_id                    VARCHAR(36)   NOT NULL,
  employee_id                 VARCHAR(36)   NOT NULL,
  roster_date                 DATE          NOT NULL,
  decision_type               ENUM(
                                'shift_assigned',
                                'weekoff_assigned',
                                'weekoff_denied',
                                'weekoff_waitlisted',
                                'shift_frozen',
                                'holiday_applied'
                              ) NOT NULL,
  assigned_shift_template_id  VARCHAR(36)   NULL,
  is_week_off                 TINYINT(1)    NOT NULL DEFAULT 0,
  preferred_day               INT           NULL COMMENT '0-6 day employee requested',
  allocated_day               INT           NULL COMMENT '0-6 day actually granted',
  allocation_sequence         INT           NULL COMMENT 'FCFS position at time of allocation',
  capacity_at_allocation      JSON          NULL COMMENT 'Snapshot of remaining capacity for the allocated day',
  rule_applied                VARCHAR(100)  NULL COMMENT 'fcfs, frozen_rotation, holiday_override, manager_override',
  override_by                 VARCHAR(36)   NULL COMMENT 'employee.id of manager who overrode engine decision',
  override_reason             VARCHAR(500)  NULL,
  override_at                 DATETIME      NULL,
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rda_run           (run_id),
  INDEX idx_rda_emp_date      (employee_id, roster_date),
  INDEX idx_rda_cycle         (cycle_id),
  CONSTRAINT fk_rda_run FOREIGN KEY (run_id)
    REFERENCES roster_generation_run(id) ON DELETE CASCADE,
  CONSTRAINT fk_rda_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Per-process rule config for FCFS engine
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS process_weekoff_rule (
  id            VARCHAR(36)   NOT NULL PRIMARY KEY DEFAULT (UUID()),
  process_id    VARCHAR(36)   NOT NULL,
  rule_type     ENUM(
                  'min_gap_days',
                  'blackout_date',
                  'force_sunday_for_role',
                  'senior_priority',
                  'rotation_enforce'
                ) NOT NULL,
  rule_params   JSON          NOT NULL COMMENT 'min_gap, blackout date or role-specific parameters',
  priority      INT           NOT NULL DEFAULT 10 COMMENT 'Lower number = higher priority when rules conflict',
  active_status TINYINT(1)    NOT NULL DEFAULT 1,
  created_by    VARCHAR(36)   NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pwr_process_active (process_id, active_status),
  CONSTRAINT fk_pwr_process FOREIGN KEY (process_id)
    REFERENCES process_master(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Roster-to-RTA reconciliation sync audit
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rta_roster_sync_log (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY DEFAULT (UUID()),
  cycle_id        VARCHAR(36)   NOT NULL,
  sync_type       ENUM('initial_publish','rerun','manual_resync') NOT NULL DEFAULT 'initial_publish',
  records_synced  INT           NOT NULL DEFAULT 0,
  records_updated INT           NOT NULL DEFAULT 0,
  sync_status     ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  error_details   JSON          NULL,
  synced_by       VARCHAR(36)   NOT NULL COMMENT 'auth_user.id',
  started_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    DATETIME      NULL,
  INDEX idx_rrsl_cycle  (cycle_id),
  INDEX idx_rrsl_status (sync_status),
  CONSTRAINT fk_rrsl_cycle FOREIGN KEY (cycle_id)
    REFERENCES weekly_roster_cycle(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '223_wfm_roster_decision_engine.sql applied successfully' AS migration_status;
