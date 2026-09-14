-- ATS registration and onboarding contract repair.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS ats_branch_alias_master (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  canonical_key VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  alias_text VARCHAR(255) NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ats_branch_alias_display (display_name),
  INDEX idx_ats_branch_alias_canonical (canonical_key)
);

INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
SELECT UUID(), b.branch_name, b.branch_name, b.branch_name, b.active_status
FROM (
  SELECT branch_name, MAX(active_status) AS active_status
  FROM branch_master
  GROUP BY branch_name
) b
WHERE NOT EXISTS (
  SELECT 1
  FROM ats_branch_alias_master a
  WHERE a.canonical_key = b.branch_name
     OR a.display_name = b.branch_name
);

UPDATE ats_branch_alias_master a
JOIN branch_master b
  ON b.branch_name = a.canonical_key
  OR b.branch_name = a.display_name
SET a.active_status = b.active_status;

SET @candidate_columns_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'SELECT 1',
    CONCAT(
      'ALTER TABLE ats_candidate ',
      GROUP_CONCAT(CONCAT('ADD COLUMN ', definition) ORDER BY sort_order SEPARATOR ', ')
    )
  )
  FROM (
    SELECT 1 sort_order, 'role_applied' column_name, 'role_applied VARCHAR(255) NULL' definition
    UNION ALL SELECT 2, 'branch_display_name', 'branch_display_name VARCHAR(255) NULL'
    UNION ALL SELECT 3, 'preferred_recruiter_id', 'preferred_recruiter_id CHAR(36) NULL'
    UNION ALL SELECT 4, 'assigned_recruiter_id', 'assigned_recruiter_id CHAR(36) NULL'
    UNION ALL SELECT 5, 'recruiter_assigned_id', 'recruiter_assigned_id CHAR(36) NULL'
    UNION ALL SELECT 6, 'recruiter_id', 'recruiter_id CHAR(36) NULL'
    UNION ALL SELECT 7, 'recruiter_selected', 'recruiter_selected CHAR(36) NULL'
    UNION ALL SELECT 8, 'assignment_reason', 'assignment_reason VARCHAR(255) NULL'
    UNION ALL SELECT 9, 'photo_url', 'photo_url VARCHAR(512) NULL'
    UNION ALL SELECT 10, 'aadhar_number_hash', 'aadhar_number_hash CHAR(64) NULL'
    UNION ALL SELECT 11, 'pan_number_hash', 'pan_number_hash CHAR(64) NULL'
    UNION ALL SELECT 12, 'bank_account_no_hash', 'bank_account_no_hash CHAR(64) NULL'
  ) definitions
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = DATABASE()
      AND c.table_name = 'ats_candidate'
      AND c.column_name = definitions.column_name
  )
);
PREPARE candidate_columns_stmt FROM @candidate_columns_sql;
EXECUTE candidate_columns_stmt;
DEALLOCATE PREPARE candidate_columns_stmt;

ALTER TABLE ats_candidate
  MODIFY COLUMN profile_status
    ENUM('registered','selected','onboarding_sent','profile_in_progress','profile_submitted','onboarded')
    NOT NULL DEFAULT 'registered';

CREATE TABLE IF NOT EXISTS ats_queue_token (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  token CHAR(36) NOT NULL UNIQUE,
  arrival_time DATETIME NOT NULL,
  current_stage VARCHAR(100) NOT NULL DEFAULT 'Arrived',
  assigned_recruiter_id CHAR(36) NULL,
  assigned_interviewer_id CHAR(36) NULL,
  status ENUM('active','walked_out','completed') NOT NULL DEFAULT 'active',
  wait_alert_sent TINYINT(1) NOT NULL DEFAULT 0,
  walk_out_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ats_queue_candidate (candidate_id),
  INDEX idx_ats_queue_status (status)
);

SET @queue_columns_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'SELECT 1',
    CONCAT(
      'ALTER TABLE ats_queue_token ',
      GROUP_CONCAT(CONCAT('ADD COLUMN ', definition) ORDER BY sort_order SEPARATOR ', ')
    )
  )
  FROM (
    SELECT 1 sort_order, 'assigned_recruiter_id' column_name, 'assigned_recruiter_id CHAR(36) NULL' definition
    UNION ALL SELECT 2, 'assigned_interviewer_id', 'assigned_interviewer_id CHAR(36) NULL'
    UNION ALL SELECT 3, 'wait_alert_sent', 'wait_alert_sent TINYINT(1) NOT NULL DEFAULT 0'
    UNION ALL SELECT 4, 'walk_out_at', 'walk_out_at DATETIME NULL'
    UNION ALL SELECT 5, 'token_number', 'token_number VARCHAR(50) NULL'
    UNION ALL SELECT 6, 'branch_name', 'branch_name VARCHAR(255) NULL'
    UNION ALL SELECT 7, 'queue_status', 'queue_status ENUM(''waiting'',''called'',''in_interview'',''completed'',''no_show'') NULL DEFAULT ''waiting'''
    UNION ALL SELECT 8, 'recruiter_id', 'recruiter_id CHAR(36) NULL'
    UNION ALL SELECT 9, 'estimated_wait_time', 'estimated_wait_time INT NULL'
    UNION ALL SELECT 10, 'called_at', 'called_at DATETIME NULL'
    UNION ALL SELECT 11, 'interview_started_at', 'interview_started_at DATETIME NULL'
    UNION ALL SELECT 12, 'interview_completed_at', 'interview_completed_at DATETIME NULL'
  ) definitions
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = DATABASE()
      AND c.table_name = 'ats_queue_token'
      AND c.column_name = definitions.column_name
  )
);
PREPARE queue_columns_stmt FROM @queue_columns_sql;
EXECUTE queue_columns_stmt;
DEALLOCATE PREPARE queue_columns_stmt;

CREATE TABLE IF NOT EXISTS ats_recruiter_assignment_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  old_recruiter_id CHAR(36) NULL,
  new_recruiter_id CHAR(36) NULL,
  assignment_reason VARCHAR(255) NOT NULL,
  assigned_by VARCHAR(50) DEFAULT 'SYSTEM',
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ats_assignment_candidate (candidate_id),
  INDEX idx_ats_assignment_recruiter (new_recruiter_id)
);

ALTER TABLE ats_onboarding_request
  MODIFY COLUMN status
    ENUM('pending','in_progress','profile_submitted','offer_submitted','approved','rejected')
    NOT NULL DEFAULT 'pending';
