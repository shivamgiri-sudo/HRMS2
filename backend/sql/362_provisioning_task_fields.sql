-- Structured output fields for IT and Admin provisioning tasks
ALTER TABLE it_provisioning_request
  ADD COLUMN official_email     VARCHAR(120) NULL AFTER evidence_note,
  ADD COLUMN domain_account     VARCHAR(120) NULL AFTER official_email,
  ADD COLUMN asset_tag          VARCHAR(80)  NULL AFTER domain_account,
  ADD COLUMN biometric_enrolled TINYINT(1)   NOT NULL DEFAULT 0 AFTER asset_tag,
  ADD COLUMN id_card_printed    TINYINT(1)   NOT NULL DEFAULT 0 AFTER biometric_enrolled;
