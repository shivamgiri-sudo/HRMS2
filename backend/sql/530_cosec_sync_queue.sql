-- COSEC employee registration sync queue.
-- Tracks push outcomes for every new-hire COSEC registration attempt.
-- Allows admin retry for failed records without re-running the full orchestrator.
USE mas_hrms;

CREATE TABLE IF NOT EXISTS cosec_user_sync_queue (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)      NOT NULL,
  employee_code   VARCHAR(30)   NOT NULL,
  cosec_user_id   VARCHAR(50)   NULL,
  status          ENUM('pending','success','failed') NOT NULL DEFAULT 'pending',
  message         TEXT          NULL,
  retry_count     INT           NOT NULL DEFAULT 0,
  attempted_at    DATETIME      NULL,
  completed_at    DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_cosec_sync_employee (employee_id),
  INDEX idx_cosec_sync_status (status),
  INDEX idx_cosec_sync_code (employee_code)
);

-- View: mas_hrms employees in the format COSEC historically read from db_bill.
-- Allows a future pull-based COSEC import to read from mas_hrms instead of db_bill
-- without changing the COSEC import configuration.
CREATE OR REPLACE VIEW v_cosec_employee_feed AS
SELECT
  e.employee_code     AS EmpCode,
  e.full_name         AS EmpName,
  e.employee_code     AS BiometricCode,
  b.branch_name       AS Location,
  d.dept_name         AS Depart,
  dsg.designation_name AS Desig,
  DATE_FORMAT(e.date_of_joining, '%d/%m/%Y') AS DOJ,
  CASE WHEN e.active_status = 1 THEN 'A' ELSE 'I' END AS Status
FROM employees e
LEFT JOIN branch_master     b   ON b.id   = e.branch_id
LEFT JOIN department_master d   ON d.id   = e.department_id
LEFT JOIN designation_master dsg ON dsg.id = e.designation_id;