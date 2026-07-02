USE mas_hrms;

CREATE TABLE IF NOT EXISTS employee_roster_preference (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  preferred_shift_id CHAR(36) NULL COMMENT 'FK to wfm_shift_template',
  preferred_week_off ENUM('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') NULL,
  flexibility ENUM('fixed','semi_flexible','fully_flexible') NOT NULL DEFAULT 'fixed',
  notes TEXT NULL,
  effective_from DATE NOT NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  rejection_reason TEXT NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_emp_pref_status (employee_id, status),
  INDEX idx_pref_effective (effective_from, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_flexibility_config (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  min_flexibility_pct TINYINT NOT NULL DEFAULT 20 COMMENT 'Percentage of roster slots that can be flexible',
  allows_self_swap TINYINT(1) NOT NULL DEFAULT 0,
  requires_approval TINYINT(1) NOT NULL DEFAULT 1,
  max_consecutive_same_shift TINYINT NOT NULL DEFAULT 5,
  configured_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY ux_process_flex (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 047 applied: roster preference and shift flexibility tables created' AS status;
