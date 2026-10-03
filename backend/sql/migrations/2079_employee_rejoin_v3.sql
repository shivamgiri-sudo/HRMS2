-- Employee Rejoin v3 (spec 2026-10-03): employment_stint, employee_rehire_control and the
-- employee_reactivation_requests columns. No ALTER on hot tables (employees, exit_request);
-- eligibility is computed from live facts. Additive and guarded: re-run is a no-op.

CREATE TABLE IF NOT EXISTS employment_stint (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  employee_id   CHAR(36)     NOT NULL,
  stint_no      INT          NOT NULL,
  start_date    DATE         NOT NULL,
  end_date      DATE         NULL,
  end_exit_request_id CHAR(36) NULL,
  rejoin_request_id   CHAR(36) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stint_emp_no (employee_id, stint_no),
  INDEX idx_stint_emp (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Side table for the HR disciplinary flag and the super_admin lift of a rehire block.
-- Deliberately a new table: employees is a hot table and ALTERs on it at startup are banned
-- (tests/migration-hot-table-guard.test.ts, 2026-09-30 lock pile-up outage).
CREATE TABLE IF NOT EXISTS employee_rehire_control (
  employee_id CHAR(36) NOT NULL PRIMARY KEY,
  disciplinary_flag TINYINT(1) NOT NULL DEFAULT 0,
  disciplinary_reason TEXT NULL,
  disciplinary_flag_date DATE NULL,
  disciplinary_flagged_by CHAR(36) NULL,
  disciplinary_document_url VARCHAR(500) NULL,
  block_lifted_by CHAR(36) NULL,
  block_lifted_at DATETIME NULL,
  block_lift_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- employee_reactivation_requests: who raised it, in what role, the eligibility snapshot the
-- approver saw, and the branch head's absconding acknowledgement.
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'employee_reactivation_requests' AND COLUMN_NAME = 'raised_by_role') = 0,
  'ALTER TABLE employee_reactivation_requests ADD COLUMN raised_by_role VARCHAR(30) NULL, ADD COLUMN eligibility_status VARCHAR(16) NULL, ADD COLUMN eligibility_snapshot JSON NULL, ADD COLUMN absconding_acknowledged TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
