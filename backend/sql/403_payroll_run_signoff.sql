-- Migration 403: Finance + CEO Sign-Off columns for salary_prep_run
-- Additive only — safe to run on existing schema.

ALTER TABLE salary_prep_run
  ADD COLUMN IF NOT EXISTS finance_approved_by  VARCHAR(36)  NULL COMMENT 'User ID who gave finance approval',
  ADD COLUMN IF NOT EXISTS finance_approved_at  DATETIME     NULL COMMENT 'Timestamp of finance approval',
  ADD COLUMN IF NOT EXISTS finance_remarks      TEXT         NULL COMMENT 'Optional remarks from finance approver',
  ADD COLUMN IF NOT EXISTS ceo_acknowledged_by  VARCHAR(36)  NULL COMMENT 'User ID who gave CEO acknowledgement',
  ADD COLUMN IF NOT EXISTS ceo_acknowledged_at  DATETIME     NULL COMMENT 'Timestamp of CEO acknowledgement',
  ADD COLUMN IF NOT EXISTS ceo_remarks          TEXT         NULL COMMENT 'Optional remarks from CEO';

-- Seed CEO acknowledgement threshold into payroll_config_flags if not already present.
-- Default: 5,000,000 (₹50 lakhs).  Admins can update this row at any time.
INSERT IGNORE INTO payroll_config_flags (config_key, config_value, description, updated_by)
VALUES ('ceo_ack_threshold', '5000000', 'Minimum total net salary (INR) that requires CEO sign-off before disbursement', 'system');
