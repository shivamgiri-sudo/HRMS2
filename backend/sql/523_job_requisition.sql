-- 523_job_requisition.sql
-- Job Requisition / Hiring Demand Management (Stage 1 of HRMS Journey)
-- This migration is ADDITIVE ONLY - no destructive changes

USE mas_hrms;

-- ---------------------------------------------------------------------------
-- Job Requisition Master Table
-- Tracks headcount demands with multi-level approval workflow
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_requisition (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  requisition_code      VARCHAR(50)  NOT NULL UNIQUE,

  -- Position details
  designation_id        CHAR(36)     NULL,
  designation_name      VARCHAR(255) NOT NULL,
  department_id         CHAR(36)     NULL,
  department_name       VARCHAR(255) NULL,

  -- Location and process
  branch_id             CHAR(36)     NULL,
  branch_name           VARCHAR(255) NOT NULL,
  process_id            CHAR(36)     NULL,
  process_name          VARCHAR(255) NULL,

  -- Headcount details
  requested_headcount   INT          NOT NULL DEFAULT 1,
  fulfilled_headcount   INT          NOT NULL DEFAULT 0,
  employment_type       ENUM('full_time', 'part_time', 'contract', 'intern', 'trainee') NOT NULL DEFAULT 'full_time',

  -- Compensation range
  salary_min            DECIMAL(12,2) NULL,
  salary_max            DECIMAL(12,2) NULL,
  salary_currency       VARCHAR(10)  NOT NULL DEFAULT 'INR',

  -- Requirements
  experience_min_years  DECIMAL(4,1) NULL,
  experience_max_years  DECIMAL(4,1) NULL,
  education_requirement VARCHAR(255) NULL,
  skills_required       TEXT         NULL,
  job_description       TEXT         NULL,

  -- Shift and timing
  shift_requirement     VARCHAR(100) NULL,
  rotational_shift      TINYINT(1)   NOT NULL DEFAULT 0,
  night_shift_required  TINYINT(1)   NOT NULL DEFAULT 0,

  -- Timeline
  target_joining_date   DATE         NULL,
  requisition_validity  DATE         NULL COMMENT 'Auto-close after this date if not filled',

  -- Priority and justification
  priority              ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
  requisition_type      ENUM('new_position', 'replacement', 'expansion', 'seasonal', 'project_based') NOT NULL DEFAULT 'new_position',
  business_justification TEXT        NULL,

  -- Approval workflow
  approval_status       ENUM('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'on_hold', 'closed') NOT NULL DEFAULT 'draft',
  approval_request_id   CHAR(36)     NULL COMMENT 'Links to approval_request table',
  approved_by           CHAR(36)     NULL,
  approved_at           DATETIME     NULL,
  rejection_reason      TEXT         NULL,

  -- Tracking
  requested_by          CHAR(36)     NOT NULL,
  requested_by_name     VARCHAR(255) NULL,
  owner_recruiter_id    CHAR(36)     NULL COMMENT 'Assigned recruiter once approved',

  -- Sourcing preferences
  preferred_sources     JSON         NULL COMMENT '["Walk-In", "Referral", "Job Portal"]',
  internal_posting      TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'Post internally for transfers/promotions',

  -- Status
  active_status         TINYINT(1)   NOT NULL DEFAULT 1,
  closed_at             DATETIME     NULL,
  closed_reason         VARCHAR(255) NULL,

  -- Audit
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Foreign keys (soft - allows flexibility)
  INDEX idx_jr_branch (branch_id),
  INDEX idx_jr_process (process_id),
  INDEX idx_jr_department (department_id),
  INDEX idx_jr_designation (designation_id),
  INDEX idx_jr_status (approval_status),
  INDEX idx_jr_requested_by (requested_by),
  INDEX idx_jr_owner (owner_recruiter_id),
  INDEX idx_jr_target_date (target_joining_date),
  INDEX idx_jr_priority (priority),
  INDEX idx_jr_code (requisition_code)
);

-- ---------------------------------------------------------------------------
-- Requisition Approval Log
-- Tracks each approval action for audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_requisition_approval_log (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  requisition_id    CHAR(36)     NOT NULL,
  approval_step     INT          NOT NULL DEFAULT 1,
  action            ENUM('submitted', 'approved', 'rejected', 'returned', 'escalated', 'cancelled') NOT NULL,
  actor_id          CHAR(36)     NOT NULL,
  actor_name        VARCHAR(255) NULL,
  actor_role        VARCHAR(100) NULL,
  remarks           TEXT         NULL,
  action_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_jral_requisition (requisition_id),
  INDEX idx_jral_actor (actor_id),
  INDEX idx_jral_action_at (action_at),
  FOREIGN KEY (requisition_id) REFERENCES job_requisition(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Candidate-Requisition Link
-- Tracks which candidates were sourced against which requisition
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_requisition_candidate (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  requisition_id    CHAR(36)     NOT NULL,
  candidate_id      CHAR(36)     NOT NULL,
  linked_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  linked_by         CHAR(36)     NULL,
  link_source       ENUM('manual', 'auto_match', 'candidate_applied') NOT NULL DEFAULT 'manual',
  current_stage     VARCHAR(100) NULL COMMENT 'Snapshot of candidate stage at link time',
  outcome           ENUM('in_progress', 'selected', 'rejected', 'withdrawn', 'offer_declined') NULL DEFAULT 'in_progress',
  outcome_at        DATETIME     NULL,
  remarks           TEXT         NULL,

  UNIQUE KEY uq_jrc_req_cand (requisition_id, candidate_id),
  INDEX idx_jrc_candidate (candidate_id),
  INDEX idx_jrc_outcome (outcome),
  FOREIGN KEY (requisition_id) REFERENCES job_requisition(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Add requisition_id column to ats_candidate if not exists
-- ---------------------------------------------------------------------------
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'requisition_id') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN requisition_id CHAR(36) NULL COMMENT ''Linked job requisition''',
  'SELECT ''requisition_id already exists on ats_candidate'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND INDEX_NAME = 'idx_ats_candidate_requisition') = 0,
  'CREATE INDEX idx_ats_candidate_requisition ON ats_candidate (requisition_id)',
  'SELECT ''idx_ats_candidate_requisition already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Requisition Analytics View (for dashboards)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_job_requisition_summary AS
SELECT
  jr.id,
  jr.requisition_code,
  jr.designation_name,
  jr.branch_name,
  jr.process_name,
  jr.requested_headcount,
  jr.fulfilled_headcount,
  (jr.requested_headcount - jr.fulfilled_headcount) AS open_positions,
  jr.employment_type,
  jr.salary_min,
  jr.salary_max,
  jr.priority,
  jr.requisition_type,
  jr.approval_status,
  jr.target_joining_date,
  jr.requested_by_name,
  jr.owner_recruiter_id,
  e.full_name AS owner_recruiter_name,
  jr.created_at,
  jr.approved_at,
  DATEDIFF(CURRENT_DATE(), DATE(jr.created_at)) AS aging_days,
  CASE
    WHEN jr.approval_status = 'approved' AND jr.fulfilled_headcount < jr.requested_headcount THEN 'active'
    WHEN jr.approval_status = 'approved' AND jr.fulfilled_headcount >= jr.requested_headcount THEN 'filled'
    WHEN jr.approval_status IN ('draft', 'pending_approval') THEN 'pending'
    ELSE jr.approval_status
  END AS derived_status,
  (SELECT COUNT(*) FROM job_requisition_candidate jrc WHERE jrc.requisition_id = jr.id) AS total_candidates,
  (SELECT COUNT(*) FROM job_requisition_candidate jrc WHERE jrc.requisition_id = jr.id AND jrc.outcome = 'selected') AS selected_candidates,
  (SELECT COUNT(*) FROM job_requisition_candidate jrc WHERE jrc.requisition_id = jr.id AND jrc.outcome = 'in_progress') AS pipeline_candidates
FROM job_requisition jr
LEFT JOIN employees e ON e.id = jr.owner_recruiter_id
WHERE jr.active_status = 1;

-- ---------------------------------------------------------------------------
-- Seed approval workflow for Job Requisition
-- ---------------------------------------------------------------------------
INSERT INTO approval_workflow_master (id, workflow_code, workflow_name, module_key, description, active_status)
SELECT UUID(), 'JOB_REQUISITION_APPROVAL', 'Job Requisition Approval', 'recruitment', 'Multi-level approval for new hiring requests', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM approval_workflow_master WHERE workflow_code = 'JOB_REQUISITION_APPROVAL'
);

-- Get the workflow ID for step insertion
SET @wf_id = (SELECT id FROM approval_workflow_master WHERE workflow_code = 'JOB_REQUISITION_APPROVAL' LIMIT 1);

-- Insert approval steps if workflow exists and steps don't exist
INSERT INTO approval_workflow_step (id, workflow_id, step_order, step_name, approver_role, sla_hours, active_status)
SELECT UUID(), @wf_id, 1, 'Branch Head Approval', 'branch_head', 24, 1
FROM DUAL
WHERE @wf_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM approval_workflow_step
    WHERE workflow_id = @wf_id AND step_order = 1
  );

INSERT INTO approval_workflow_step (id, workflow_id, step_order, step_name, approver_role, sla_hours, active_status)
SELECT UUID(), @wf_id, 2, 'HR Manager Approval', 'hr', 24, 1
FROM DUAL
WHERE @wf_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM approval_workflow_step
    WHERE workflow_id = @wf_id AND step_order = 2
  );

INSERT INTO approval_workflow_step (id, workflow_id, step_order, step_name, approver_role, sla_hours, active_status)
SELECT UUID(), @wf_id, 3, 'Management Approval', 'management', 48, 1
FROM DUAL
WHERE @wf_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM approval_workflow_step
    WHERE workflow_id = @wf_id AND step_order = 3
  );

-- ---------------------------------------------------------------------------
-- Seed page access for Job Requisition
-- ---------------------------------------------------------------------------
INSERT INTO page_master (id, page_code, page_name, page_path, module_key, description, active_status)
SELECT UUID(), 'JOB_REQUISITION', 'Job Requisition', '/recruitment/job-requisition', 'recruitment', 'Manage hiring demands and requisitions', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM page_master WHERE page_code = 'JOB_REQUISITION'
);

INSERT INTO page_master (id, page_code, page_name, page_path, module_key, description, active_status)
SELECT UUID(), 'JOB_REQUISITION_APPROVAL', 'Job Requisition Approvals', '/recruitment/job-requisition/approvals', 'recruitment', 'Approve or reject hiring requests', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM page_master WHERE page_code = 'JOB_REQUISITION_APPROVAL'
);

-- Grant access to HR and management roles
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_edit, can_delete, can_approve)
SELECT UUID(), 'hr', 'JOB_REQUISITION', 1, 1, 0, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access WHERE role_key = 'hr' AND page_code = 'JOB_REQUISITION'
);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_edit, can_delete, can_approve)
SELECT UUID(), 'super_admin', 'JOB_REQUISITION', 1, 1, 1, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access WHERE role_key = 'super_admin' AND page_code = 'JOB_REQUISITION'
);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_edit, can_delete, can_approve)
SELECT UUID(), 'branch_head', 'JOB_REQUISITION', 1, 1, 0, 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access WHERE role_key = 'branch_head' AND page_code = 'JOB_REQUISITION'
);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_edit, can_delete, can_approve)
SELECT UUID(), 'operations_manager', 'JOB_REQUISITION', 1, 1, 0, 0
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access WHERE role_key = 'operations_manager' AND page_code = 'JOB_REQUISITION'
);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_edit, can_delete, can_approve)
SELECT UUID(), 'recruitment_hr', 'JOB_REQUISITION', 1, 1, 0, 0
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access WHERE role_key = 'recruitment_hr' AND page_code = 'JOB_REQUISITION'
);
