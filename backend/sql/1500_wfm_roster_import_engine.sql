-- WFM Roster Import Engine Schema
-- Migration 1500: Tables for roster upload, preview, commit workflow

-- 1. Shift alias table for normalizing spreadsheet variations
CREATE TABLE IF NOT EXISTS wfm_shift_alias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shift_id CHAR(36) NOT NULL,
  alias VARCHAR(100) NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by CHAR(36),
  FOREIGN KEY (shift_id) REFERENCES wfm_shift_master(id),
  UNIQUE KEY uk_alias (alias)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Import batch for roster uploads
CREATE TABLE IF NOT EXISTS wfm_roster_import_batch (
  id INT AUTO_INCREMENT PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  cycle_id CHAR(36),
  import_mode ENUM('NEW', 'UPDATE') NOT NULL DEFAULT 'NEW',
  file_name VARCHAR(255),
  file_format ENUM('WIDE', 'LONG') NOT NULL DEFAULT 'WIDE',
  status ENUM('PARSING', 'PREVIEW', 'VALIDATING', 'READY', 'COMMITTED', 'FAILED', 'CANCELLED') DEFAULT 'PARSING',
  total_rows INT DEFAULT 0,
  valid_rows INT DEFAULT 0,
  warning_rows INT DEFAULT 0,
  error_rows INT DEFAULT 0,
  needs_mapping_rows INT DEFAULT 0,
  date_range_start DATE,
  date_range_end DATE,
  mapping_profile_id INT,
  validation_summary_json JSON,
  created_by CHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  committed_by CHAR(36),
  committed_at TIMESTAMP NULL,
  FOREIGN KEY (process_id) REFERENCES process_master(id),
  INDEX idx_status (status),
  INDEX idx_process (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Individual import rows for preview
CREATE TABLE IF NOT EXISTS wfm_roster_import_row (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  row_number INT NOT NULL,
  employee_id CHAR(36),
  employee_id_raw VARCHAR(100),
  employee_name_raw VARCHAR(255),
  roster_date DATE NOT NULL,
  raw_value VARCHAR(255),
  normalized_type ENUM('SHIFT', 'WEEK_OFF', 'LEAVE', 'HALF_DAY', 'HOLIDAY', 'TRAINING', 'UNSCHEDULED', 'UNASSIGNED', 'NEEDS_MAPPING', 'NO_CHANGE', 'HARD_ERROR') NOT NULL,
  resolved_shift_id CHAR(36),
  validation_state ENUM('VALID', 'WARNING', 'ERROR') NOT NULL DEFAULT 'VALID',
  validation_messages JSON,
  extra_metadata_json JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES wfm_roster_import_batch(id) ON DELETE CASCADE,
  INDEX idx_batch (batch_id),
  INDEX idx_batch_state (batch_id, validation_state),
  INDEX idx_employee_date (employee_id, roster_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Header mapping profiles (saved per process/source)
CREATE TABLE IF NOT EXISTS wfm_header_mapping_profile (
  id INT AUTO_INCREMENT PRIMARY KEY,
  process_id CHAR(36),
  profile_name VARCHAR(100) NOT NULL,
  source_identifier VARCHAR(100),
  column_mappings JSON NOT NULL,
  shift_alias_overrides JSON,
  status_alias_overrides JSON,
  blank_handling ENUM('UNASSIGNED', 'NO_CHANGE') DEFAULT 'UNASSIGNED',
  hd_maps_to ENUM('HALF_DAY', 'NEEDS_MAPPING') DEFAULT 'NEEDS_MAPPING',
  is_default TINYINT(1) DEFAULT 0,
  is_active TINYINT(1) DEFAULT 1,
  created_by CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (process_id) REFERENCES process_master(id),
  UNIQUE KEY uk_process_name (process_id, profile_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Add planning_mode to process table (ROSTER_LED is default)
ALTER TABLE process_master ADD COLUMN IF NOT EXISTS planning_mode ENUM('ROSTER_LED', 'VOLUME_BASED') DEFAULT 'ROSTER_LED';

-- 6. RTA exception disposition tracking
CREATE TABLE IF NOT EXISTS wfm_rta_exception (
  id INT AUTO_INCREMENT PRIMARY KEY,
  alert_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  exception_date DATE NOT NULL,
  exception_type ENUM('LATE', 'NO_SHOW', 'EARLY_EXIT', 'SHORT_HOURS', 'MISSED_PUNCH', 'ROSTER_MISMATCH', 'OVERTIME', 'OTHER') NOT NULL,
  exception_state ENUM('OPEN', 'ACKNOWLEDGED', 'ACTIONED', 'RESOLVED', 'ESCALATED') DEFAULT 'OPEN',
  disposition_type ENUM('CONTACTED_EMPLOYEE', 'TRANSPORT_ISSUE', 'SYSTEM_LOGIN_ISSUE', 'BIOMETRIC_ISSUE', 'APPROVED_EXCEPTION', 'EMERGENCY', 'SHIFT_CHANGE_PENDING', 'REGULARIZATION_REQUIRED', 'NO_RESPONSE', 'ESCALATE_TO_HR', 'OTHER'),
  disposition_owner_id CHAR(36),
  disposition_comment TEXT,
  disposition_at TIMESTAMP NULL,
  regularization_id CHAR(36),
  roster_amendment_id CHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (alert_id) REFERENCES adherence_alert(id),
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (disposition_owner_id) REFERENCES auth_user(id),
  INDEX idx_employee_date (employee_id, exception_date),
  INDEX idx_state (exception_state),
  INDEX idx_alert (alert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Extend roster_change_log for amendment workflow
ALTER TABLE roster_change_log
  ADD COLUMN IF NOT EXISTS old_shift_id CHAR(36),
  ADD COLUMN IF NOT EXISTS new_shift_id CHAR(36),
  ADD COLUMN IF NOT EXISTS old_assignment_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS new_assignment_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS amendment_reason TEXT,
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS ack_required TINYINT(1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acked_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS is_late_change TINYINT(1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lead_time_hours INT;
