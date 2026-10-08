-- 2137: DRA (Debt Recovery Agent) certificate verification history for SBI Credit Card joiners
-- (cost centre BSS/OB/AHMH-JD/1050). One row per upload; is_current marks the row the candidate is judged on, older rows are
-- kept as history. Purely additive and idempotent (CREATE TABLE IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS candidate_dra_certificate (
  id                  CHAR(36)     NOT NULL,
  candidate_id        CHAR(36)     NOT NULL,
  document_id         CHAR(36)     NOT NULL,
  is_current          TINYINT(1)   NOT NULL DEFAULT 1,
  status              ENUM('pending','verified','invalid','expired','mismatch') NOT NULL DEFAULT 'pending',
  auto_checks_passed  TINYINT(1)   NOT NULL DEFAULT 0,
  registration_no     VARCHAR(40)  NULL,
  serial_no           VARCHAR(50)  NULL,
  security_code       VARCHAR(30)  NULL,
  certificate_date    DATE         NULL,
  valid_until         DATE         NULL,
  extracted_name      VARCHAR(150) NULL,
  name_match_score    TINYINT UNSIGNED NULL,
  photo_match_score   TINYINT UNSIGNED NULL,
  failure_reason      VARCHAR(500) NULL,
  verification_source VARCHAR(30)  NULL,
  hr_note             VARCHAR(500) NULL,
  uploaded_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at         DATETIME     NULL,
  verified_by         CHAR(36)     NULL,
  PRIMARY KEY (id),
  KEY idx_dra_candidate_current (candidate_id, is_current),
  KEY idx_dra_status (status, is_current),
  KEY idx_dra_registration (registration_no),
  KEY idx_dra_serial (serial_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
