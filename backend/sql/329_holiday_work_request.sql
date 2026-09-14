-- Migration 329: Holiday work request / approval workflow tables
-- Implements the multi-stage approval flow:
--   Branch WFM → Branch Payroll → Payroll Head → Super Admin → payroll_included

CREATE TABLE IF NOT EXISTS holiday_work_request (
  id                        CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  holiday_id                CHAR(36)      NOT NULL,
  request_month             DATE          NOT NULL COMMENT 'YYYY-MM-01',
  branch_id                 CHAR(36)      NOT NULL,
  process_id                CHAR(36)      NOT NULL,
  cost_centre_id            CHAR(36)      NULL,
  department_id             CHAR(36)      NULL,
  requested_by              CHAR(36)      NOT NULL,
  request_reason            TEXT          NOT NULL,
  client_approval_reference VARCHAR(200)  NULL,
  payout_policy_id          CHAR(36)      NOT NULL,
  status                    ENUM('draft','submitted','branch_payroll_validated',
                                 'payroll_head_approved','superadmin_approved',
                                 'rejected','cancelled','payroll_included')
                            NOT NULL DEFAULT 'draft',
  current_approval_stage    VARCHAR(50)   NOT NULL DEFAULT 'wfm',
  min_hours_required        SMALLINT      NOT NULL DEFAULT 480,
  remarks                   TEXT          NULL,
  attachment_document_id    CHAR(36)      NULL,
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (holiday_id)       REFERENCES leave_holiday_master(id),
  FOREIGN KEY (payout_policy_id) REFERENCES holiday_work_policy_master(id),
  INDEX idx_hwr_month  (request_month),
  INDEX idx_hwr_branch (branch_id),
  INDEX idx_hwr_status (status)
);

-- Designations selected as eligible for this request
CREATE TABLE IF NOT EXISTS holiday_work_request_designation (
  id            CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  request_id    CHAR(36)  NOT NULL,
  designation_id CHAR(36) NOT NULL,
  created_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES holiday_work_request(id) ON DELETE CASCADE,
  UNIQUE KEY uq_req_desig (request_id, designation_id)
);

-- Per-employee eligibility and payout tracking for an approved request
CREATE TABLE IF NOT EXISTS holiday_work_request_employee (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  request_id         CHAR(36)     NOT NULL,
  employee_id        CHAR(36)     NOT NULL,
  eligibility_status ENUM('eligible','ineligible','override_eligible','pending')
                     NOT NULL DEFAULT 'pending',
  ineligibility_reason VARCHAR(200) NULL,
  worked_minutes     SMALLINT     NOT NULL DEFAULT 0,
  payout_unit        ENUM('none','half_day','full_day') NOT NULL DEFAULT 'none',
  payout_amount      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  calculation_status ENUM('pending','calculated','approved','excluded')
                     NOT NULL DEFAULT 'pending',
  calculation_notes  TEXT         NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id)  REFERENCES holiday_work_request(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  UNIQUE KEY uq_req_emp (request_id, employee_id),
  INDEX idx_hwre_employee (employee_id)
);

-- Full audit trail of approval actions
CREATE TABLE IF NOT EXISTS holiday_work_approval_log (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  request_id   CHAR(36)     NOT NULL,
  approver_id  CHAR(36)     NOT NULL,
  approver_role VARCHAR(50)  NOT NULL,
  action       ENUM('submitted','validated','approved','rejected','cancelled','overridden')
               NOT NULL,
  from_status  VARCHAR(50)  NULL,
  to_status    VARCHAR(50)  NOT NULL,
  remarks      TEXT         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES holiday_work_request(id) ON DELETE CASCADE,
  INDEX idx_hwal_request (request_id),
  INDEX idx_hwal_approver (approver_id)
);

SELECT '329_holiday_work_request.sql applied' AS migration_status;
