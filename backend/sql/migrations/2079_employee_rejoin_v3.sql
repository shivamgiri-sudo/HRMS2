-- Employee Rejoin v3 (spec 2026-10-03). Additive and guarded: every ADD COLUMN checks
-- information_schema first so a re-run, or a partial earlier run, is a no-op.

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

-- employees: HR disciplinary flag (blocks rehire) and the super_admin lift of a block.
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'disciplinary_flag') = 0,
  'ALTER TABLE employees ADD COLUMN disciplinary_flag TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN disciplinary_reason TEXT NULL, ADD COLUMN disciplinary_flag_date DATE NULL, ADD COLUMN disciplinary_flagged_by CHAR(36) NULL, ADD COLUMN disciplinary_document_url VARCHAR(500) NULL, ADD COLUMN rehire_block_lifted_by CHAR(36) NULL, ADD COLUMN rehire_block_lifted_at DATETIME NULL, ADD COLUMN rehire_block_lift_reason TEXT NULL, ALGORITHM=INSTANT',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- exit_request: eligibility computed at exit time (backfilled by a later plan).
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'exit_request' AND COLUMN_NAME = 'rehire_status') = 0,
  'ALTER TABLE exit_request ADD COLUMN rehire_status VARCHAR(16) NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- employee_reactivation_requests: who raised it, in what role, the eligibility snapshot the
-- approver saw, and the branch head's absconding acknowledgement.
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'employee_reactivation_requests' AND COLUMN_NAME = 'raised_by_role') = 0,
  'ALTER TABLE employee_reactivation_requests ADD COLUMN raised_by_role VARCHAR(30) NULL, ADD COLUMN eligibility_status VARCHAR(16) NULL, ADD COLUMN eligibility_snapshot JSON NULL, ADD COLUMN absconding_acknowledged TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
