-- Migration 1807: eSign signer-identity check (alert-only fraud signal).
--
-- Owner-directed (2026-09-18), demonstrated live as a deliberate test: a joining kit
-- addressed to one employee (MAS63544/RISHABH PANDEY) was completed using a DIFFERENT
-- person's Aadhaar. Neither Luckpay's status API nor the document's own visible text
-- carries independently-verified signer identity — both just echo what our own system
-- supplied. The one place real identity exists is the PDF's embedded PKCS#7 signature's
-- X.509 certificate (issued by a licensed CA at signing time) — see
-- backend/src/shared/esignCertificateIdentity.ts.
--
-- Deliberately its OWN table, not a reuse of candidate_fraud_alert: that table's
-- candidate_id is NOT NULL and its whole model (duplicate identity across candidates,
-- gating employee CREATION) is a different concern from "did the person who actually
-- completed THIS signature match the document's named owner" at eSign-COMPLETION time,
-- often well after conversion when candidate_id is frequently no longer populated
-- (confirmed live: RISHABH's kit has candidate_id = NULL).
--
-- Alert-only per owner directive: nothing here blocks or reverses anything. A row is
-- written for EVERY completed eSign (match or mismatch), not just mismatches, so "what
-- fraction of our signed documents have a verified identity match" is answerable later.
CREATE TABLE IF NOT EXISTS esign_signer_identity_check (
  id CHAR(36) NOT NULL PRIMARY KEY,
  employee_id CHAR(36) NOT NULL,
  candidate_id CHAR(36) NULL,
  scope ENUM('joining_kit', 'appointment_letter', 'document') NOT NULL,
  reference_id CHAR(36) NULL COMMENT 'kit id / letter issue id / checklist id, whichever scope applies',
  transaction_id CHAR(36) NULL COMMENT 'employee_document_esign_transaction.id, when there is one',
  document_owner_name VARCHAR(200) NOT NULL COMMENT 'the name this document was issued to (employee record at signing time)',
  certificate_common_name VARCHAR(200) NULL COMMENT 'Subject CN from the embedded PKCS#7 signature — the CA-verified signer',
  certificate_issuer_cn VARCHAR(200) NULL,
  certificate_valid_from DATETIME NULL,
  certificate_valid_to DATETIME NULL,
  match_tier ENUM('exact', 'variant', 'weak', 'none', 'unknown', 'unverifiable') NOT NULL,
  is_suspicious TINYINT NOT NULL DEFAULT 0,
  match_reason VARCHAR(255) NULL,
  status ENUM('open', 'confirmed_fraud', 'false_positive', 'dismissed') NOT NULL DEFAULT 'open',
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  review_notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_esign_identity_employee (employee_id),
  KEY idx_esign_identity_suspicious (is_suspicious, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
