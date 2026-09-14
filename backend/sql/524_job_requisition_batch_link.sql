-- 524_job_requisition_batch_link.sql
-- Links Job Requisitions to Training Batches for funnel tracking
-- Additive migration - no destructive changes

USE mas_hrms;

-- ─── Add planned batch columns to job_requisition ────────────────────────────

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_requisition' AND COLUMN_NAME = 'planned_batch_no') = 0,
  'ALTER TABLE job_requisition ADD COLUMN planned_batch_no VARCHAR(50) NULL COMMENT ''Expected training batch for hired candidates''',
  'SELECT ''planned_batch_no already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_requisition' AND COLUMN_NAME = 'planned_batch_name') = 0,
  'ALTER TABLE job_requisition ADD COLUMN planned_batch_name VARCHAR(255) NULL COMMENT ''Display name of planned training batch''',
  'SELECT ''planned_batch_name already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_requisition' AND COLUMN_NAME = 'training_start_date') = 0,
  'ALTER TABLE job_requisition ADD COLUMN training_start_date DATE NULL COMMENT ''Expected training start date from batch''',
  'SELECT ''training_start_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── Add batch index ─────────────────────────────────────────────────────────

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'job_requisition' AND INDEX_NAME = 'idx_jr_batch') = 0,
  'CREATE INDEX idx_jr_batch ON job_requisition (planned_batch_no)',
  'SELECT ''idx_jr_batch already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── Create view for requisition funnel metrics ──────────────────────────────

CREATE OR REPLACE VIEW v_job_requisition_funnel AS
SELECT
  jr.id AS requisition_id,
  jr.requisition_code,
  jr.designation_name,
  jr.branch_name,
  jr.process_name,
  jr.requested_headcount,
  jr.fulfilled_headcount,
  jr.planned_batch_no,
  jr.planned_batch_name,
  jr.training_start_date,
  jr.approval_status,
  jr.created_at AS demand_raised_date,
  jr.approved_at AS demand_approved_date,

  -- Funnel counts from linked candidates
  COUNT(DISTINCT jrc.candidate_id) AS total_linked_candidates,

  -- Walk-in count: candidates who have a queue token or walk_in_date set
  COUNT(DISTINCT CASE
    WHEN c.walk_in_date IS NOT NULL OR qt.id IS NOT NULL
    THEN c.id
  END) AS walkin_count,

  -- Screened count: candidates past Applied stage
  COUNT(DISTINCT CASE
    WHEN c.current_stage NOT IN ('Applied', 'New', 'Registered')
    THEN c.id
  END) AS screened_count,

  -- Selected count: candidates in Selected or later stages
  COUNT(DISTINCT CASE
    WHEN c.current_stage IN ('Selected', 'Offered', 'Joined', 'Converted')
    THEN c.id
  END) AS selected_count,

  -- Offered count: candidates with offer letters
  COUNT(DISTINCT CASE
    WHEN c.current_stage IN ('Offered', 'Joined', 'Converted')
    THEN c.id
  END) AS offered_count,

  -- Onboarding count: candidates with onboarding bridge record
  COUNT(DISTINCT ob.id) AS onboarding_count,

  -- Joined count: candidates converted to employees
  COUNT(DISTINCT CASE
    WHEN ob.employee_id IS NOT NULL AND e.active_status = 1
    THEN e.id
  END) AS joined_count,

  -- LMS enrolled count: employees with LMS mapping
  COUNT(DISTINCT lm.id) AS lms_enrolled_count

FROM job_requisition jr
LEFT JOIN job_requisition_candidate jrc ON jrc.requisition_id = jr.id
LEFT JOIN ats_candidate c ON c.id = jrc.candidate_id
LEFT JOIN ats_queue_token qt ON qt.candidate_id = c.id
LEFT JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
LEFT JOIN employees e ON e.id = ob.employee_id
LEFT JOIN lms_employee_mapping lm ON lm.employee_id = e.id

WHERE jr.active_status = 1
GROUP BY jr.id;

SELECT '524_job_requisition_batch_link.sql applied successfully' AS migration_status;
