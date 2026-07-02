USE mas_hrms;

CREATE TABLE IF NOT EXISTS vendor_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  vendor_code     VARCHAR(32)  NOT NULL UNIQUE,
  vendor_name     VARCHAR(128) NOT NULL,
  vendor_type     ENUM('supplier','service','contractor','other') NOT NULL DEFAULT 'supplier',
  contact_name    VARCHAR(128),
  contact_email   VARCHAR(255),
  contact_phone   VARCHAR(20),
  address         TEXT,
  gst_number      VARCHAR(20),
  pan_number      VARCHAR(20),
  payment_terms   VARCHAR(64),
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contract_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  contract_code   VARCHAR(32)  NOT NULL UNIQUE,
  title           VARCHAR(255) NOT NULL,
  vendor_id       CHAR(36),
  client_id       VARCHAR(128),
  contract_type   ENUM('sow','msa','nda','po','other') NOT NULL DEFAULT 'sow',
  start_date      DATE         NOT NULL,
  end_date        DATE,
  value           DECIMAL(14,2),
  status          ENUM('draft','active','expired','terminated') NOT NULL DEFAULT 'draft',
  notes           TEXT,
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contract_vendor (vendor_id)
);

CREATE TABLE IF NOT EXISTS expense_claim (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  expense_date    DATE         NOT NULL,
  category        ENUM('travel','accommodation','meals','transport','communication','office','other') NOT NULL DEFAULT 'other',
  amount          DECIMAL(10,2) NOT NULL,
  currency        VARCHAR(3)   NOT NULL DEFAULT 'INR',
  description     TEXT,
  receipt_ref     VARCHAR(255),
  project_code    VARCHAR(64),
  cost_centre_id  CHAR(36),
  status          ENUM('draft','submitted','approved','rejected','paid') NOT NULL DEFAULT 'draft',
  reviewed_by     CHAR(36),
  reviewed_at     DATETIME,
  remarks         TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_expense_emp (employee_id),
  INDEX idx_expense_status (status)
);

CREATE TABLE IF NOT EXISTS procurement_request (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  req_code        VARCHAR(32)  NOT NULL UNIQUE,
  requested_by    CHAR(36)     NOT NULL,
  item_name       VARCHAR(255) NOT NULL,
  quantity        INT          NOT NULL DEFAULT 1,
  estimated_cost  DECIMAL(10,2),
  vendor_id       CHAR(36),
  department_id   CHAR(36),
  required_by     DATE,
  justification   TEXT,
  status          ENUM('draft','submitted','approved','ordered','received','rejected') NOT NULL DEFAULT 'draft',
  approved_by     CHAR(36),
  approved_at     DATETIME,
  remarks         TEXT,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_proc_req (requested_by)
);
