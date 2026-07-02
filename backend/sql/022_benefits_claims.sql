USE mas_hrms;

CREATE TABLE IF NOT EXISTS benefit_plan (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  plan_name       VARCHAR(128) NOT NULL,
  plan_type       ENUM('insurance','transport','meal','wellness','other') NOT NULL DEFAULT 'other',
  description     TEXT,
  eligibility_rule TEXT,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS benefit_enrollment (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  plan_id         CHAR(36)     NOT NULL,
  enrolled_date   DATE         NOT NULL,
  effective_from  DATE         NOT NULL,
  effective_to    DATE,
  status          ENUM('active','inactive','pending') NOT NULL DEFAULT 'pending',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_enrollment (employee_id, plan_id),
  INDEX idx_enroll_emp (employee_id)
);

CREATE TABLE IF NOT EXISTS reimbursement_claim (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  claim_type      ENUM('travel','medical','meal','equipment','other') NOT NULL DEFAULT 'other',
  amount          DECIMAL(10,2) NOT NULL,
  claim_date      DATE         NOT NULL,
  description     TEXT,
  receipt_ref     VARCHAR(255),
  status          ENUM('draft','submitted','approved','rejected','paid') NOT NULL DEFAULT 'draft',
  reviewed_by     CHAR(36),
  reviewed_at     DATETIME,
  remarks         TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_claim_emp (employee_id),
  INDEX idx_claim_status (status)
);
