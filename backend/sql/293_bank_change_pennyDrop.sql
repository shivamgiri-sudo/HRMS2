-- 293_bank_change_pennyDrop.sql
-- Adds penny drop verification log for bank account change requests.
-- Also extends profile_update_approval with payroll-specific routing fields.
-- Additive migration.

-- ── Penny drop verification log ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_penny_drop_log (
  id                       CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id              CHAR(36)     NOT NULL,
  account_number_hash      VARCHAR(64)  NOT NULL,   -- SHA-256 of account number (never raw)
  ifsc_code                VARCHAR(20)  NOT NULL,
  penny_drop_ref           VARCHAR(255) NULL,        -- Provider transaction reference
  penny_drop_status        ENUM('initiated','success','failed','skipped')
                           NOT NULL DEFAULT 'initiated',
  beneficiary_name_returned VARCHAR(255) NULL,        -- Name returned by bank verification API
  initiated_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at               DATETIME     NULL,
  provider_response_json   JSON         NULL,         -- Raw provider response (for audit)
  INDEX idx_bpdl_employee (employee_id),
  INDEX idx_bpdl_status   (penny_drop_status)
);

-- ── Extend profile_update_approval ───────────────────────────────────────────
ALTER TABLE profile_update_approval
  ADD COLUMN IF NOT EXISTS penny_drop_log_id   CHAR(36)    NULL
    COMMENT 'FK to bank_penny_drop_log.id (for bank_details requests)',
  ADD COLUMN IF NOT EXISTS effective_run_month  VARCHAR(7)  NULL
    COMMENT 'YYYY-MM: payroll run from which new bank account is effective (set on approval)',
  ADD COLUMN IF NOT EXISTS routed_to_role       VARCHAR(50) NULL DEFAULT 'payroll'
    COMMENT 'Role the approval is routed to (payroll for bank changes)';
