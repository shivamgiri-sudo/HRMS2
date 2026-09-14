-- Company signing certificate, managed by Super Admin.
--
-- Appointment letters are signed by the company before they reach the employee.
-- The existing "company sign" step (appointment-esign.service.ts) is not a
-- signature at all — it flips a column, with no provider, no PDF and no
-- cryptography, and any admin/hr user can POST an arbitrary signedBy string.
--
-- This table holds the actual credential. Two kinds are supported and the
-- difference is legally material:
--
--   CA-issued (IT Act 2000 s.3)  — a Class-3 organisation DSC from a
--     CCA-licensed Certifying Authority. Carries the s.85B evidentiary
--     presumption. This is what a bank or court will accept.
--
--   self-signed — generated here so the pipeline can be built and tested before
--     a DSC is procured. Adobe reports "Signature validity is UNKNOWN". Letters
--     signed with one carry a visible mark saying so, and that mark cannot be
--     removed without a real certificate.
--
-- is_self_signed and is_ca_issued are DERIVED at upload time by parsing the
-- certificate (issuer vs subject, and the issuer chain against the licensed CA
-- list) — never taken from what the uploader typed.
--
-- The private key and its passphrase are stored encrypted with the field
-- encryption helper and are never returned by any API.

CREATE TABLE IF NOT EXISTS company_signing_certificate (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  label               VARCHAR(160) NOT NULL,

  -- Parsed from the certificate itself, not supplied by the uploader.
  subject_cn          VARCHAR(255) NULL,
  issuer_cn           VARCHAR(255) NULL,
  serial_number       VARCHAR(128) NULL,
  valid_from          DATETIME     NULL,
  valid_to            DATETIME     NULL,
  fingerprint_sha256  VARCHAR(95)  NULL,
  is_self_signed      TINYINT(1)   NOT NULL DEFAULT 0,
  is_ca_issued        TINYINT(1)   NOT NULL DEFAULT 0,

  -- Key material. Encrypted at rest; never selected into an API response.
  p12_encrypted       LONGTEXT     NOT NULL,
  passphrase_encrypted TEXT        NULL,

  -- Printed in the signature block on the letter.
  signer_name         VARCHAR(160) NOT NULL,
  signer_designation  VARCHAR(160) NOT NULL,

  -- Exactly one active certificate. NULLs compare distinct in MySQL, so this
  -- unique key permits unlimited inactive rows but only one marked 'Y'.
  active_marker       CHAR(1)      NULL,
  active_status       TINYINT(1)   NOT NULL DEFAULT 0,

  uploaded_by         CHAR(36)     NULL,
  uploaded_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deactivated_at      DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_csc_active (active_marker),
  INDEX idx_csc_valid_to (valid_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every upload / generate / activate / deactivate, so a disputed letter can be
-- traced to the credential that signed it and to who put it there.
CREATE TABLE IF NOT EXISTS company_signing_certificate_audit (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  certificate_id CHAR(36)     NULL,
  action         VARCHAR(40)  NOT NULL,
  actor_user_id  CHAR(36)     NULL,
  detail_json    JSON         NULL,
  acted_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_csca_cert (certificate_id),
  INDEX idx_csca_acted (acted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
