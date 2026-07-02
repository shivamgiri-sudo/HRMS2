USE mas_hrms;

-- =====================================================
-- Roster Master Management Schema
-- File: 060_roster_master.sql
-- Description: Master roster templates, week-off preferences,
--              and auto-roster generation tables
-- =====================================================

-- =====================================================
-- 1. ROSTER TEMPLATE
-- =====================================================
CREATE TABLE IF NOT EXISTS roster_template (
  id VARCHAR(36) PRIMARY KEY,
  template_name VARCHAR(100) NOT NULL,
  process_id VARCHAR(36) NOT NULL,
  pattern_type ENUM('fixed', 'rotation', 'custom') NOT NULL DEFAULT 'fixed',
  cycle_days INT NOT NULL DEFAULT 7 COMMENT '7=weekly, 14=bi-weekly, 28=monthly',
  pattern_json JSON NOT NULL COMMENT 'Roster pattern definition',
  support_ratio_min DECIMAL(5,2) NULL COMMENT 'Minimum on-duty percentage',
  support_ratio_max DECIMAL(5,2) NULL COMMENT 'Maximum on-duty percentage',
  is_active TINYINT(1) DEFAULT 1,
  created_by VARCHAR(36),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_process_active (process_id, is_active),
  INDEX idx_created_by (created_by),
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 2. WEEK-OFF PREFERENCE
-- =====================================================
CREATE TABLE IF NOT EXISTS week_off_preference (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  preferred_day INT NOT NULL COMMENT '0=Sunday, 1=Monday, ... 6=Saturday',
  alternate_day INT NULL COMMENT 'Alternate week-off day',
  approved TINYINT(1) DEFAULT 0,
  approved_by VARCHAR(36),
  approved_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_employee (employee_id),
  INDEX idx_approved (approved, approved_by),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES employees(id) ON DELETE SET NULL,
  CHECK (preferred_day BETWEEN 0 AND 6),
  CHECK (alternate_day IS NULL OR alternate_day BETWEEN 0 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 3. ROSTER ASSIGNMENT (if not exists from WFM)
-- =====================================================
CREATE TABLE IF NOT EXISTS roster_assignment (
  id VARCHAR(36) PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL,
  roster_date DATE NOT NULL,
  shift_template_id VARCHAR(36) NULL,
  is_week_off TINYINT(1) DEFAULT 0,
  acknowledgement_status ENUM('pending', 'acknowledged', 'disputed') DEFAULT 'pending',
  acknowledged_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_employee_date (employee_id, roster_date),
  INDEX idx_date (roster_date),
  INDEX idx_shift (shift_template_id),
  INDEX idx_status (acknowledgement_status),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_template_id) REFERENCES wfm_shift_template(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- 4. ROSTER GENERATION LOG
-- =====================================================
CREATE TABLE IF NOT EXISTS roster_generation_log (
  id VARCHAR(36) PRIMARY KEY,
  template_id VARCHAR(36) NOT NULL,
  process_id VARCHAR(36) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  employee_count INT NOT NULL,
  assignments_created INT NOT NULL,
  assignments_skipped INT NOT NULL,
  errors_count INT DEFAULT 0,
  error_details JSON NULL,
  generated_by VARCHAR(36),
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_template (template_id),
  INDEX idx_process (process_id),
  INDEX idx_date_range (start_date, end_date),
  INDEX idx_generated_by (generated_by),
  FOREIGN KEY (template_id) REFERENCES roster_template(id) ON DELETE CASCADE,
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE CASCADE,
  FOREIGN KEY (generated_by) REFERENCES employees(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- Sample Data: Default Weekly Template
-- =====================================================
INSERT INTO roster_template (id, template_name, process_id, pattern_type, cycle_days, pattern_json, support_ratio_min, support_ratio_max, is_active, created_by)
SELECT
  UUID(),
  '5-Day Week (Mon-Fri)',
  id,
  'fixed',
  7,
  '{
    "days": [
      {"day_number": 1, "shift_template_id": null, "is_week_off": true, "is_rotational": false},
      {"day_number": 2, "shift_template_id": null, "is_week_off": false, "is_rotational": false},
      {"day_number": 3, "shift_template_id": null, "is_week_off": false, "is_rotational": false},
      {"day_number": 4, "shift_template_id": null, "is_week_off": false, "is_rotational": false},
      {"day_number": 5, "shift_template_id": null, "is_week_off": false, "is_rotational": false},
      {"day_number": 6, "shift_template_id": null, "is_week_off": false, "is_rotational": false},
      {"day_number": 7, "shift_template_id": null, "is_week_off": true, "is_rotational": false}
    ]
  }',
  75.0,
  100.0,
  1,
  NULL
FROM process_master
WHERE NOT EXISTS (
  SELECT 1 FROM roster_template WHERE template_name = '5-Day Week (Mon-Fri)'
)
LIMIT 1;

-- =====================================================
-- END OF SCHEMA
-- =====================================================
