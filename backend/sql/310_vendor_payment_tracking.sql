-- 310_vendor_payment_tracking.sql
-- Budget + GRN + Vendor Payment Tracking module
-- Adds: bank_master, grn_request, vendor_payment_tracking, finance_action_audit_log
-- All additive — safe to run on existing schema. MySQL 5.7+ compatible.

-- ── bank_master ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_master (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  bank_name     VARCHAR(255) NOT NULL,
  bank_code     VARCHAR(50)  NULL,
  ifsc_prefix   VARCHAR(10)  NULL,
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bank_name (bank_name),
  INDEX idx_bank_active (active_status)
);

-- Seed common Indian banks (idempotent via INSERT IGNORE)
INSERT IGNORE INTO bank_master (id, bank_name, bank_code, ifsc_prefix) VALUES
  (UUID(), 'State Bank of India', 'SBI', 'SBIN'),
  (UUID(), 'HDFC Bank', 'HDFC', 'HDFC'),
  (UUID(), 'ICICI Bank', 'ICICI', 'ICIC'),
  (UUID(), 'Axis Bank', 'AXIS', 'UTIB'),
  (UUID(), 'Punjab National Bank', 'PNB', 'PUNB'),
  (UUID(), 'Bank of Baroda', 'BOB', 'BARB'),
  (UUID(), 'Canara Bank', 'CANARA', 'CNRB'),
  (UUID(), 'Union Bank of India', 'UBI', 'UBIN'),
  (UUID(), 'Kotak Mahindra Bank', 'KOTAK', 'KKBK'),
  (UUID(), 'Yes Bank', 'YES', 'YESB'),
  (UUID(), 'IndusInd Bank', 'INDUSIND', 'INDB'),
  (UUID(), 'IDFC First Bank', 'IDFC', 'IDFB'),
  (UUID(), 'Federal Bank', 'FEDERAL', 'FDRL'),
  (UUID(), 'Bank of India', 'BOI', 'BKID'),
  (UUID(), 'Indian Bank', 'IB', 'IDIB'),
  (UUID(), 'Central Bank of India', 'CBI', 'CBIN'),
  (UUID(), 'UCO Bank', 'UCO', 'UCBA'),
  (UUID(), 'Indian Overseas Bank', 'IOB', 'IOBA'),
  (UUID(), 'RBL Bank', 'RBL', 'RATN'),
  (UUID(), 'South Indian Bank', 'SIB', 'SIBL');

-- ── grn_request ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS grn_request (
  id                      CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  grn_number              VARCHAR(50)    NULL,         -- Generated on approval e.g. Mas/7/21/121
  grn_type                ENUM('vendor','imprest') NOT NULL DEFAULT 'vendor',
  branch_id               CHAR(36)       NOT NULL,
  vendor_id               CHAR(36)       NULL,          -- FK vendor_master.id (NULL for imprest)
  vendor_name             VARCHAR(255)   NULL,          -- Denormalized for reporting
  head                    VARCHAR(255)   NOT NULL,       -- Budget head e.g. Repairs & Maintenance Capex
  sub_head                VARCHAR(255)   NOT NULL,       -- Budget sub-head
  amount                  DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  bill_date               DATE           NULL,
  payment_terms_days      INT            NOT NULL DEFAULT 0,
  due_date                DATE           NULL,          -- Computed: bill_date + payment_terms_days
  description             TEXT           NULL,
  attachment_file_name    VARCHAR(500)   NULL,
  attachment_file_path    VARCHAR(1000)  NULL,
  attachment_file_mime    VARCHAR(100)   NULL,
  status                  ENUM('draft','submitted','approved','rejected','cancelled')
                          NOT NULL DEFAULT 'draft',
  created_by              CHAR(36)       NOT NULL,
  submitted_at            DATETIME       NULL,
  approved_by             CHAR(36)       NULL,
  approved_at             DATETIME       NULL,
  rejection_reason        TEXT           NULL,
  financial_year          VARCHAR(10)    NULL,          -- e.g. 2024-25
  created_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_grn_branch    (branch_id),
  INDEX idx_grn_vendor    (vendor_id),
  INDEX idx_grn_status    (status),
  INDEX idx_grn_number    (grn_number),
  INDEX idx_grn_fy        (financial_year)
);

-- ── vendor_payment_tracking ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_payment_tracking (
  id                          CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  grn_request_id              CHAR(36)       NOT NULL,
  grn_number                  VARCHAR(50)    NULL,
  branch_id                   CHAR(36)       NOT NULL,
  vendor_id                   CHAR(36)       NULL,
  vendor_name                 VARCHAR(255)   NULL,
  head                        VARCHAR(255)   NULL,
  sub_head                    VARCHAR(255)   NULL,
  due_amount                  DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  due_date                    DATE           NULL,
  grn_file_name               VARCHAR(500)   NULL,
  grn_file_path               VARCHAR(1000)  NULL,
  grn_file_mime               VARCHAR(100)   NULL,
  payment_mode                ENUM('Cheque','NEFT','RTGS','IMPS','UPI','Cash','Bank Transfer','Adjustment','Other')
                              NULL,
  payment_date                DATE           NULL,
  bank_id                     CHAR(36)       NULL,
  bank_name                   VARCHAR(255)   NULL,      -- Denormalized for reporting
  transaction_id              VARCHAR(255)   NULL,      -- Cheque No. / UTR / Imprest Ref
  paid_amount                 DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  balance_amount              DECIMAL(12,2)  NOT NULL DEFAULT 0.00,
  payment_status              ENUM('Payment Pending','Partially Paid','Paid','On Hold','Rejected','Closed')
                              NOT NULL DEFAULT 'Payment Pending',
  remarks                     TEXT           NULL,
  payment_proof_file_name     VARCHAR(500)   NULL,
  payment_proof_file_path     VARCHAR(1000)  NULL,
  payment_proof_file_mime     VARCHAR(100)   NULL,
  financial_year              VARCHAR(10)    NULL,
  updated_by                  CHAR(36)       NULL,
  updated_at                  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at                  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vpt_grn       (grn_request_id),
  INDEX idx_vpt_branch        (branch_id),
  INDEX idx_vpt_vendor        (vendor_id),
  INDEX idx_vpt_status        (payment_status),
  INDEX idx_vpt_due_date      (due_date),
  INDEX idx_vpt_fy            (financial_year),
  INDEX idx_vpt_grn_number    (grn_number)
);

-- ── finance_action_audit_log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS finance_action_audit_log (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  action_type     VARCHAR(100) NOT NULL,              -- e.g. VENDOR_PAYMENT_UPDATED
  entity_type     VARCHAR(100) NOT NULL,              -- e.g. VENDOR_PAYMENT
  entity_id       CHAR(36)     NOT NULL,
  actor_user_id   CHAR(36)     NOT NULL,
  actor_role      VARCHAR(100) NULL,
  change_summary  JSON         NULL,                  -- before/after values
  ip_address      VARCHAR(45)  NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_faal_entity    (entity_type, entity_id),
  INDEX idx_faal_actor     (actor_user_id),
  INDEX idx_faal_action    (action_type),
  INDEX idx_faal_created   (created_at)
);
