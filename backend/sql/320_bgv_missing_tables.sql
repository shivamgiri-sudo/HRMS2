-- 320_bgv_missing_tables.sql
-- Creates four tables referenced in bgv-verification.service.ts that were
-- never created by prior migrations. Also adds Befisc/Luckpay/Crimescan
-- org_settings provider config rows.
-- Idempotent — safe to re-run.

-- ── 1. API request / response log ─────────────────────────────────────────────
-- Column names match exactly what bgv-verification.service.ts inserts.
CREATE TABLE IF NOT EXISTS candidate_bgv_api_request_log (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id          CHAR(36)     NOT NULL,
  check_id              CHAR(36)     NULL,
  provider_key          VARCHAR(50)  NOT NULL,
  endpoint_key          VARCHAR(100) NOT NULL,    -- e.g. 'PAN_VERIFY', 'AADHAAR_OTP'
  request_ref           VARCHAR(255) NULL,        -- provider request/transaction ID
  request_payload_hash  VARCHAR(64)  NULL,        -- SHA-256 hash of sanitised payload
  response_status_code  INT          NULL,
  response_payload      MEDIUMTEXT   NULL,        -- full provider JSON response
  duration_ms           INT          NULL,
  success_flag          TINYINT(1)   NOT NULL DEFAULT 0,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bgv_log_candidate (candidate_id),
  INDEX idx_bgv_log_check     (check_id),
  INDEX idx_bgv_log_provider  (provider_key, endpoint_key)
);

-- ── 2. Verification event / audit trail ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_bgv_verification_event (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id  CHAR(36)     NOT NULL,
  check_id      CHAR(36)     NULL,
  event_type    VARCHAR(100) NOT NULL,
  event_status  VARCHAR(50)  NULL,
  event_payload MEDIUMTEXT   NULL,         -- JSON
  actor_type    ENUM('candidate','hr','system','provider') NOT NULL DEFAULT 'system',
  actor_id      CHAR(36)     NULL,
  ip_address    VARCHAR(45)  NULL,
  user_agent    VARCHAR(512) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bgv_event_candidate (candidate_id),
  INDEX idx_bgv_event_type      (event_type),
  INDEX idx_bgv_event_check     (check_id)
);

-- ── 3. Exception / waiver record ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_bgv_exception (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id    CHAR(36)     NOT NULL,
  check_type      VARCHAR(50)  NOT NULL,
  exception_type  ENUM('waiver','manual_clear','escalation','hold') NOT NULL DEFAULT 'waiver',
  raised_by       CHAR(36)     NULL,       -- HR user_id
  raised_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason          TEXT         NULL,
  resolved        TINYINT(1)   NOT NULL DEFAULT 0,
  resolved_by     CHAR(36)     NULL,
  resolved_at     DATETIME     NULL,
  resolution_note TEXT         NULL,
  INDEX idx_bgv_exc_candidate (candidate_id),
  INDEX idx_bgv_exc_type      (check_type, exception_type)
);

-- ── 4. Bank verification record ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_bank_verification (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id          CHAR(36)     NOT NULL,
  bank_detail_id        CHAR(36)     NULL,  -- FK to candidate_onboarding_bank_detail
  provider_key          VARCHAR(50)  NOT NULL DEFAULT 'mock_bgv',
  provider_request_id   VARCHAR(255) NULL,
  provider_reference_id VARCHAR(255) NULL,
  account_number_masked VARCHAR(50)  NULL,  -- masked (last 4 only)
  ifsc_code             VARCHAR(20)  NULL,
  bank_name_returned    VARCHAR(255) NULL,
  account_holder_name_returned VARCHAR(255) NULL,
  fuzzy_match_score     INT          NULL,
  verification_status   ENUM('pending','verified','mismatch','failed','manual_review','waived') NOT NULL DEFAULT 'pending',
  result_summary        TEXT         NULL,
  raw_response_json     MEDIUMTEXT   NULL,
  penny_drop_amount     DECIMAL(5,2) NULL,
  verified_at           DATETIME     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cbv_candidate (candidate_id),
  INDEX idx_cbv_status    (verification_status)
);

-- ── 5. Aadhaar OTP session (for Befisc two-step flow) ─────────────────────────
CREATE TABLE IF NOT EXISTS candidate_aadhaar_otp_session (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id    CHAR(36)     NOT NULL,
  aadhaar_masked  VARCHAR(20)  NULL,       -- last-4 only
  reference_id    VARCHAR(255) NOT NULL,   -- Befisc referenceId
  status          ENUM('otp_sent','verified','failed','expired') NOT NULL DEFAULT 'otp_sent',
  provider_key    VARCHAR(50)  NOT NULL DEFAULT 'befisc',
  raw_send_json   TEXT         NULL,
  raw_verify_json TEXT         NULL,
  expires_at      DATETIME     NOT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cao_candidate (candidate_id),
  INDEX idx_cao_reference (reference_id)
);

-- ── 6. Org settings: Befisc + Luckpay + Crimescan provider config ─────────────
-- Insert only if not already present (idempotent)
INSERT IGNORE INTO org_settings (`key`, `value`, updated_at)
VALUES
  ('bgv_befisc_api_key',          '',  NOW()),
  ('bgv_luckpay_basic_token',     '',  NOW()),
  ('bgv_luckpay_client_id',       '',  NOW()),
  ('bgv_crimescan_api_key',       '',  NOW()),
  ('bgv_prescreening_api_key',    '',  NOW());

SELECT 'migration 320 bgv_missing_tables complete' AS status;
