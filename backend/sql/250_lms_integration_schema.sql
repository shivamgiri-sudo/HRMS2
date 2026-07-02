-- 250_lms_integration_schema.sql
-- LMS Integration Snapshot Schema — enhanced tables for dashboard and readiness tracking
-- Syncs learner progress, assessment scores and operations handover readiness from mcn_lms

USE mas_hrms;

-- 1. Learner progress snapshot — enriched with batch, process, readiness and attrition signals
CREATE TABLE IF NOT EXISTS lms_learner_progress (
  id CHAR(36) PRIMARY KEY,
  employee_id VARCHAR(20) NOT NULL,
  employee_code VARCHAR(20),
  batch_no VARCHAR(50),
  batch_name VARCHAR(200),
  process_name VARCHAR(100),
  branch_name VARCHAR(100),
  course_completion_pct DECIMAL(5,2) DEFAULT 0,
  mcq_best_score DECIMAL(5,2) DEFAULT 0,
  mcq_pass_status ENUM('pass', 'fail', 'pending') DEFAULT 'pending',
  attendance_pct DECIMAL(5,2) DEFAULT 0,
  certification_status ENUM('not_started', 'in_progress', 'eligible', 'certified', 'failed') DEFAULT 'not_started',
  readiness_score DECIMAL(5,2) DEFAULT 0,
  attrition_risk_signal ENUM('green', 'yellow', 'red') DEFAULT 'green',
  last_activity_date DATETIME,
  ops_handover_ready BOOLEAN DEFAULT 0,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (employee_id, batch_no),
  KEY (employee_code),
  KEY (certification_status),
  KEY (attrition_risk_signal),
  KEY (ops_handover_ready)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Assessment scores snapshot — MCQ attempt history and performance tracking
CREATE TABLE IF NOT EXISTS lms_assessment_scores (
  id CHAR(36) PRIMARY KEY,
  employee_id VARCHAR(20) NOT NULL,
  employee_code VARCHAR(20),
  batch_no VARCHAR(50),
  assessment_name VARCHAR(200),
  attempt_no INT DEFAULT 1,
  score DECIMAL(5,2),
  percentage DECIMAL(5,2),
  result ENUM('pass', 'fail') NOT NULL,
  time_taken_seconds INT,
  attempted_at DATETIME NOT NULL,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY (employee_id, batch_no, assessment_name, attempt_no),
  KEY (employee_code),
  KEY (batch_no),
  KEY (attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Sync audit trail — tracks LMS data sync status, errors and audit
CREATE TABLE IF NOT EXISTS lms_sync_audit (
  id CHAR(36) PRIMARY KEY,
  sync_type VARCHAR(50) NOT NULL,
  status ENUM('pending', 'running', 'success', 'failed') DEFAULT 'pending',
  rows_synced INT DEFAULT 0,
  rows_failed INT DEFAULT 0,
  error_message TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  KEY (sync_type),
  KEY (status),
  KEY (completed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
