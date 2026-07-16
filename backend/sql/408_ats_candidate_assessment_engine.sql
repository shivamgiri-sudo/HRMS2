-- 408_ats_candidate_assessment_engine.sql
-- Additive pre-employment assessment engine. Does not alter ATS queue or lifecycle statuses.

CREATE TABLE IF NOT EXISTS ats_assessment_template (
  id CHAR(36) NOT NULL PRIMARY KEY,
  template_code VARCHAR(100) NOT NULL UNIQUE,
  template_name VARCHAR(255) NOT NULL,
  process_key ENUM('inbound','outbound','backoffice','document','email') NOT NULL,
  role_key ENUM('executive','team_leader','quality_auditor') NOT NULL,
  difficulty_level ENUM('basic','intermediate','advanced') NOT NULL DEFAULT 'intermediate',
  duration_minutes INT NOT NULL DEFAULT 30,
  passing_percentage DECIMAL(5,2) NOT NULL DEFAULT 60.00,
  gate_mode ENUM('advisory','soft_gate','hard_gate') NOT NULL DEFAULT 'advisory',
  template_version INT NOT NULL DEFAULT 1,
  config_json JSON NOT NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATETIME NULL,
  effective_to DATETIME NULL,
  created_by CHAR(36) NULL,
  approved_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_assessment_template_lookup (process_key, role_key, active_status)
);

CREATE TABLE IF NOT EXISTS ats_assessment_mapping (
  id CHAR(36) NOT NULL PRIMARY KEY,
  mapping_name VARCHAR(255) NOT NULL,
  branch_name VARCHAR(255) NULL,
  process_match VARCHAR(255) NULL,
  role_match VARCHAR(255) NULL,
  experience_match VARCHAR(100) NULL,
  template_id CHAR(36) NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  mandatory_flag TINYINT(1) NOT NULL DEFAULT 0,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  effective_from DATETIME NULL,
  effective_to DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_assessment_mapping_template FOREIGN KEY (template_id) REFERENCES ats_assessment_template(id),
  INDEX idx_assessment_mapping_active (active_status, priority)
);

CREATE TABLE IF NOT EXISTS ats_candidate_assessment (
  id CHAR(36) NOT NULL PRIMARY KEY,
  candidate_id CHAR(36) NOT NULL,
  queue_token_id CHAR(36) NULL,
  q_token_snapshot VARCHAR(100) NULL,
  template_id CHAR(36) NOT NULL,
  template_version INT NOT NULL DEFAULT 1,
  public_token_hash CHAR(64) NULL UNIQUE,
  status ENUM('assigned','in_progress','submitted_pending_scoring','manual_review','completed','technical_error','expired','cancelled','skipped') NOT NULL DEFAULT 'assigned',
  attempt_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
  typing_attempts_used TINYINT UNSIGNED NOT NULL DEFAULT 0,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  submitted_at DATETIME NULL,
  completed_at DATETIME NULL,
  expires_at DATETIME NULL,
  overall_score DECIMAL(8,2) NULL,
  max_score DECIMAL(8,2) NULL,
  percentage DECIMAL(5,2) NULL,
  result ENUM('pass','fail','pending_review') NULL,
  section_scores JSON NULL,
  recommendation_json JSON NULL,
  integrity_flags JSON NULL,
  client_meta JSON NULL,
  failure_reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_candidate_assessment_candidate FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  CONSTRAINT fk_candidate_assessment_template FOREIGN KEY (template_id) REFERENCES ats_assessment_template(id),
  CONSTRAINT fk_candidate_assessment_queue FOREIGN KEY (queue_token_id) REFERENCES ats_queue_token(id) ON DELETE SET NULL,
  UNIQUE KEY uq_candidate_queue_template_attempt (candidate_id, queue_token_id, template_id, attempt_no),
  INDEX idx_candidate_assessment_candidate (candidate_id, status),
  INDEX idx_candidate_assessment_queue (queue_token_id),
  INDEX idx_candidate_assessment_status (status, assigned_at)
);

CREATE TABLE IF NOT EXISTS ats_assessment_response (
  id CHAR(36) NOT NULL PRIMARY KEY,
  assessment_id CHAR(36) NOT NULL,
  question_id VARCHAR(120) NOT NULL,
  section_key VARCHAR(100) NOT NULL,
  question_type VARCHAR(40) NOT NULL,
  answer_json JSON NULL,
  answer_text LONGTEXT NULL,
  marks_awarded DECIMAL(8,2) NULL,
  max_marks DECIMAL(8,2) NOT NULL DEFAULT 0,
  evaluation_mode ENUM('auto','keyword','manual') NOT NULL DEFAULT 'auto',
  evaluation_notes VARCHAR(1000) NULL,
  time_taken_seconds INT NULL,
  answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_assessment_response_attempt FOREIGN KEY (assessment_id) REFERENCES ats_candidate_assessment(id) ON DELETE CASCADE,
  UNIQUE KEY uq_assessment_question (assessment_id, question_id),
  INDEX idx_assessment_response_section (assessment_id, section_key)
);

CREATE TABLE IF NOT EXISTS ats_typing_test_attempt (
  id CHAR(36) NOT NULL PRIMARY KEY,
  assessment_id CHAR(36) NOT NULL,
  attempt_no TINYINT UNSIGNED NOT NULL,
  reference_text LONGTEXT NOT NULL,
  typed_text LONGTEXT NULL,
  duration_limit_seconds INT NOT NULL DEFAULT 180,
  elapsed_seconds INT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME NULL,
  gross_wpm DECIMAL(8,2) NULL,
  net_wpm DECIMAL(8,2) NULL,
  accuracy_percentage DECIMAL(5,2) NULL,
  correct_characters INT NULL,
  incorrect_characters INT NULL,
  missing_characters INT NULL,
  extra_characters INT NULL,
  correct_words INT NULL,
  incorrect_words INT NULL,
  backspace_count INT NOT NULL DEFAULT 0,
  paste_attempts INT NOT NULL DEFAULT 0,
  score_percentage DECIMAL(5,2) NULL,
  result_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_typing_attempt_assessment FOREIGN KEY (assessment_id) REFERENCES ats_candidate_assessment(id) ON DELETE CASCADE,
  UNIQUE KEY uq_typing_assessment_attempt (assessment_id, attempt_no),
  INDEX idx_typing_assessment (assessment_id, submitted_at)
);

CREATE TABLE IF NOT EXISTS ats_assessment_audit_log (
  id CHAR(36) NOT NULL PRIMARY KEY,
  assessment_id CHAR(36) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  event_payload JSON NULL,
  actor_type ENUM('candidate','system','recruiter','hr','admin') NOT NULL DEFAULT 'system',
  actor_id VARCHAR(100) NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assessment_audit_attempt FOREIGN KEY (assessment_id) REFERENCES ats_candidate_assessment(id) ON DELETE CASCADE,
  INDEX idx_assessment_audit (assessment_id, created_at),
  INDEX idx_assessment_audit_event (event_type, created_at)
);

-- Optional snapshots on the canonical full-parity interview submission. These are nullable and do not change the existing flow.
SET @has_assessment_attempt_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'assessment_attempt_id'
);
SET @sql_assessment_attempt_id := IF(
  @has_assessment_attempt_id = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN assessment_attempt_id CHAR(36) NULL',
  'SELECT 1'
);
PREPARE stmt_assessment_attempt_id FROM @sql_assessment_attempt_id;
EXECUTE stmt_assessment_attempt_id;
DEALLOCATE PREPARE stmt_assessment_attempt_id;

SET @has_assessment_snapshot := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'assessment_snapshot_json'
);
SET @sql_assessment_snapshot := IF(
  @has_assessment_snapshot = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN assessment_snapshot_json JSON NULL',
  'SELECT 1'
);
PREPARE stmt_assessment_snapshot FROM @sql_assessment_snapshot;
EXECUTE stmt_assessment_snapshot;
DEALLOCATE PREPARE stmt_assessment_snapshot;

SET @has_assessment_override := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'assessment_override_reason'
);
SET @sql_assessment_override := IF(
  @has_assessment_override = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN assessment_override_reason VARCHAR(500) NULL',
  'SELECT 1'
);
PREPARE stmt_assessment_override FROM @sql_assessment_override;
EXECUTE stmt_assessment_override;
DEALLOCATE PREPARE stmt_assessment_override;
