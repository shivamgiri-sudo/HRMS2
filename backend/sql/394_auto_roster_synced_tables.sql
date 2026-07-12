USE mas_hrms;

-- Migration 394: Auto-roster synced engine DB objects
-- Creates all tables and the wfm_shift view required by autoRosterSyncedService.
-- These objects were referenced in code but had no migration file.

-- ─── 1. VIEW: wfm_shift ───────────────────────────────────────────────────────
-- The autoRosterSyncedService queries "SELECT * FROM wfm_shift".
-- This view aliases wfm_shift_master transparently.
-- NOTE: Do not create a table named wfm_shift — this view would shadow it.
--       Long-term fix: update the service to query wfm_shift_master directly.
CREATE OR REPLACE VIEW wfm_shift AS
  SELECT id, shift_code, shift_name, start_time, end_time, active_status
  FROM wfm_shift_master;

-- ─── 2. ALTER: wfm_roster_conflict_log ───────────────────────────────────────
-- Already created in migration 017 with a different (employee-centric) schema.
-- The autoRosterSyncedService inserts plan-level conflicts with employee_id = NULL,
-- so we MODIFY employee_id to be nullable and add the new plan-level columns.

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'wfm_roster_conflict_log'
    AND COLUMN_NAME = 'plan_id'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE wfm_roster_conflict_log
     MODIFY COLUMN employee_id VARCHAR(36) NULL,
     ADD COLUMN plan_id         VARCHAR(36) NULL AFTER id,
     ADD COLUMN assignment_id   VARCHAR(36) NULL AFTER plan_id,
     ADD COLUMN roster_date     DATE        NULL,
     ADD COLUMN severity        ENUM(''info'',''medium'',''high'',''critical'') NOT NULL DEFAULT ''medium'',
     ADD COLUMN message         TEXT        NULL,
     ADD COLUMN resolution_status ENUM(''open'',''resolved'',''dismissed'') NOT NULL DEFAULT ''open'',
     ADD INDEX  idx_wrcl_plan   (plan_id),
     ADD INDEX  idx_wrcl_sev    (severity, resolution_status)',
  'SELECT 1 -- wfm_roster_conflict_log already has plan_id column, skipping ALTER'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ─── 3. TABLE: wfm_roster_plan_control ───────────────────────────────────────
-- One control row per wfm_roster_plan. Stores approval lifecycle state,
-- shrinkage setting, coverage score, and publish-lock state.
CREATE TABLE IF NOT EXISTS wfm_roster_plan_control (
  plan_id              VARCHAR(36)  NOT NULL,
  planning_mode        VARCHAR(32)  NOT NULL DEFAULT 'auto',
  approval_status      ENUM('draft','generated','submitted','approved','rejected','published')
                                    NOT NULL DEFAULT 'draft',
  shrinkage_pct        DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  publish_lock_status  VARCHAR(32)  NULL,
  notification_status  VARCHAR(32)  NULL,
  last_coverage_score  DECIMAL(6,2) NULL,
  generated_at         DATETIME     NULL,
  submitted_by         VARCHAR(36)  NULL,
  submitted_at         DATETIME     NULL,
  approved_by          VARCHAR(36)  NULL,
  approved_at          DATETIME     NULL,
  rejected_by          VARCHAR(36)  NULL,
  rejected_at          DATETIME     NULL,
  rejection_remarks    TEXT         NULL,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_id),
  CONSTRAINT fk_wrpc_plan FOREIGN KEY (plan_id)
    REFERENCES wfm_roster_plan(id) ON DELETE CASCADE
);

-- ─── 4. TABLE: wfm_client_slot_requirement ────────────────────────────────────
-- Per-process/branch demand signal: how many agents are needed per slot.
-- Supports both date-specific rows (requirement_date set) and
-- day-of-week recurring rows (day_of_week set, requirement_date NULL).
CREATE TABLE IF NOT EXISTS wfm_client_slot_requirement (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  process_id       CHAR(36)     NULL,
  branch_id        CHAR(36)     NULL,
  requirement_date DATE         NULL,
  day_of_week      TINYINT(1)   NULL COMMENT '0=Sunday … 6=Saturday',
  slot_start       TIME         NOT NULL,
  slot_end         TIME         NOT NULL,
  required_hc      INT          NOT NULL DEFAULT 0,
  shrinkage_pct    DECIMAL(5,2) NULL COMMENT 'Override per-slot; NULL = use plan-level default',
  active_status    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       VARCHAR(36)  NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_wcsr_process   (process_id, branch_id),
  INDEX idx_wcsr_date      (requirement_date),
  INDEX idx_wcsr_dow       (day_of_week)
);

-- ─── 5. TABLE: wfm_roster_coverage_matrix ────────────────────────────────────
-- One row per plan / date / slot. Recomputed on every generate and re-generate.
CREATE TABLE IF NOT EXISTS wfm_roster_coverage_matrix (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  plan_id      VARCHAR(36)  NOT NULL,
  roster_date  DATE         NOT NULL,
  slot_start   TIME         NOT NULL,
  slot_end     TIME         NOT NULL,
  required_hc  INT          NOT NULL DEFAULT 0,
  planned_hc   INT          NOT NULL DEFAULT 0,
  buffer_hc    INT          NOT NULL DEFAULT 0,
  gap_hc       INT          NOT NULL DEFAULT 0,
  coverage_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  shrinkage_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_wrcm_plan FOREIGN KEY (plan_id)
    REFERENCES wfm_roster_plan(id) ON DELETE CASCADE,
  INDEX idx_wrcm_plan_date (plan_id, roster_date)
);

-- ─── 6. TABLE: wfm_roster_change_request ─────────────────────────────────────
-- Records every change a Process Manager makes to a published assignment.
CREATE TABLE IF NOT EXISTS wfm_roster_change_request (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  plan_id             VARCHAR(36)  NOT NULL,
  assignment_id       VARCHAR(36)  NULL,
  employee_id         VARCHAR(36)  NULL,
  roster_date         DATE         NULL,
  old_shift_id        VARCHAR(36)  NULL,
  new_shift_id        VARCHAR(36)  NULL,
  old_shift_start_time TIME        NULL,
  old_shift_end_time   TIME        NULL,
  new_shift_start_time TIME        NULL,
  new_shift_end_time   TIME        NULL,
  old_roster_status   VARCHAR(64)  NULL,
  new_roster_status   VARCHAR(64)  NULL,
  change_category     ENUM('shift_change','weekoff_change','leave_adjustment','emergency','support_staff_update')
                                   NOT NULL DEFAULT 'shift_change',
  change_reason       TEXT         NULL,
  impact_summary_json JSON         NULL,
  requested_by        VARCHAR(36)  NULL,
  approved_by         VARCHAR(36)  NULL,
  status              ENUM('pending','applied','reversed') NOT NULL DEFAULT 'pending',
  notification_locked TINYINT(1)   NOT NULL DEFAULT 1,
  notification_status VARCHAR(32)  NULL,
  approved_at         DATETIME     NULL,
  applied_at          DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_wrcr_plan FOREIGN KEY (plan_id)
    REFERENCES wfm_roster_plan(id) ON DELETE CASCADE,
  INDEX idx_wrcr_plan       (plan_id),
  INDEX idx_wrcr_assignment (assignment_id)
);

-- ─── 7. TABLE: wfm_roster_event_log ──────────────────────────────────────────
-- Structured event stream for all roster lifecycle events.
CREATE TABLE IF NOT EXISTS wfm_roster_event_log (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
  plan_id             VARCHAR(36)  NULL,
  assignment_id       VARCHAR(36)  NULL,
  event_type          VARCHAR(64)  NOT NULL,
  event_title         VARCHAR(256) NOT NULL,
  event_message       TEXT         NULL,
  severity            ENUM('info','medium','high','critical') NOT NULL DEFAULT 'info',
  target_role         VARCHAR(64)  NULL,
  target_employee_id  VARCHAR(36)  NULL,
  process_id          VARCHAR(36)  NULL,
  branch_id           VARCHAR(36)  NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_wrel_plan       (plan_id, created_at),
  INDEX idx_wrel_event_type (event_type)
);

-- ─── 8. TABLE: wfm_roster_approval_log ───────────────────────────────────────
-- Immutable audit record for every approval lifecycle action.
CREATE TABLE IF NOT EXISTS wfm_roster_approval_log (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()),
  plan_id               VARCHAR(36)  NOT NULL,
  action                ENUM('submitted','approved','rejected','published') NOT NULL,
  action_by             VARCHAR(36)  NULL,
  action_role           VARCHAR(64)  NULL,
  remarks               TEXT         NULL,
  coverage_snapshot_json JSON        NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_wral_plan FOREIGN KEY (plan_id)
    REFERENCES wfm_roster_plan(id) ON DELETE CASCADE,
  INDEX idx_wral_plan (plan_id, created_at)
);

-- ─── 9. TABLE: wfm_roster_notification_log ───────────────────────────────────
-- Locked notification queue for roster publish/change events.
CREATE TABLE IF NOT EXISTS wfm_roster_notification_log (
  id                 CHAR(36)      NOT NULL DEFAULT (UUID()),
  plan_id            VARCHAR(36)   NULL,
  assignment_id      VARCHAR(36)   NULL,
  change_request_id  VARCHAR(36)   NULL,
  employee_id        VARCHAR(36)   NULL,
  recipient_email    VARCHAR(256)  NULL,
  notification_type  VARCHAR(64)   NOT NULL,
  subject            VARCHAR(512)  NOT NULL,
  body_preview       VARCHAR(1000) NULL,
  status             ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  locked             TINYINT(1)    NOT NULL DEFAULT 1,
  sent_at            DATETIME      NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_wrnl_plan     (plan_id),
  INDEX idx_wrnl_employee (employee_id),
  INDEX idx_wrnl_status   (status)
);

-- ─── 10. TABLE: wfm_roster_manager_task ──────────────────────────────────────
-- Tasks queued for support-staff managers to update their sub-team rosters.
CREATE TABLE IF NOT EXISTS wfm_roster_manager_task (
  id                   CHAR(36)     NOT NULL DEFAULT (UUID()),
  plan_id              VARCHAR(36)  NOT NULL,
  manager_employee_id  VARCHAR(36)  NOT NULL,
  support_staff_count  INT          NOT NULL DEFAULT 0,
  due_at               DATETIME     NULL,
  status               ENUM('email_queued','pending','completed','overdue') NOT NULL DEFAULT 'pending',
  notes                TEXT         NULL,
  last_email_sent_at   DATETIME     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wrmt_plan_mgr (plan_id, manager_employee_id),
  CONSTRAINT fk_wrmt_plan FOREIGN KEY (plan_id)
    REFERENCES wfm_roster_plan(id) ON DELETE CASCADE,
  INDEX idx_wrmt_manager (manager_employee_id)
);

-- ─── 11. TABLE: wfm_roster_assignment_control ────────────────────────────────
-- Per-assignment control row: change-lock state and acknowledgement tracking.
CREATE TABLE IF NOT EXISTS wfm_roster_assignment_control (
  id                       CHAR(36)    NOT NULL DEFAULT (UUID()),
  assignment_id            VARCHAR(36) NOT NULL,
  plan_id                  VARCHAR(36) NULL,
  change_lock_status       ENUM('draft_editable','pm_change_only','locked') NOT NULL DEFAULT 'draft_editable',
  acknowledgement_required TINYINT(1)  NOT NULL DEFAULT 0,
  acknowledgement_status   ENUM('not_required','pending','acknowledged') NOT NULL DEFAULT 'not_required',
  last_change_request_id   VARCHAR(36) NULL,
  last_notification_status VARCHAR(32) NULL,
  updated_at               DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wrac_assignment (assignment_id),
  INDEX idx_wrac_plan (plan_id)
);

-- ─── 12. TABLE: wfm_roster_acknowledgement ───────────────────────────────────
-- Employee acknowledgement events for published or changed roster rows.
-- ON DUPLICATE KEY in code = UNIQUE(assignment_id, employee_id).
CREATE TABLE IF NOT EXISTS wfm_roster_acknowledgement (
  id                   CHAR(36)    NOT NULL DEFAULT (UUID()),
  assignment_id        VARCHAR(36) NOT NULL,
  change_request_id    VARCHAR(36) NULL,
  employee_id          VARCHAR(36) NOT NULL,
  acknowledgement_type ENUM('publish','change') NOT NULL DEFAULT 'publish',
  remarks              TEXT        NULL,
  acknowledged_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wra_assignment_emp (assignment_id, employee_id),
  INDEX idx_wra_employee (employee_id)
);
