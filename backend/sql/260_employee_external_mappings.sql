-- External System Employee ID Mappings
-- Maps HRMS employee IDs to external system identifiers (NCOSEC, payroll, etc.)

CREATE TABLE IF NOT EXISTS employee_external_mapping (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id      CHAR(36)     NOT NULL,
  system_name      VARCHAR(50)  NOT NULL COMMENT 'ncosec, legacy_payroll, call_master, etc.',
  external_id      VARCHAR(100) NOT NULL COMMENT 'UserID in external system',
  mapping_source   ENUM('auto', 'manual', 'import') NOT NULL DEFAULT 'auto',
  verified_at      DATETIME     NULL,
  verified_by      CHAR(36)     NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  notes            TEXT         NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,

  UNIQUE KEY uq_emp_system (employee_id, system_name),
  INDEX idx_system_external (system_name, external_id),
  INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default: Map employee_code to NCOSEC UserID for existing employees
-- This assumes employee_code matches NCOSEC UserID by default
-- Override with manual mappings where needed
INSERT INTO employee_external_mapping (employee_id, system_name, external_id, mapping_source)
SELECT id, 'ncosec', employee_code, 'auto'
FROM employees
WHERE active_status = 1
  AND employee_code IS NOT NULL
  AND employee_code != ''
ON DUPLICATE KEY UPDATE
  external_id = VALUES(external_id),
  mapping_source = CASE
    WHEN mapping_source = 'manual' THEN 'manual'
    ELSE 'auto'
  END,
  updated_at = NOW();
