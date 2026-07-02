-- Penny drop verification storage for onboarding bank account validation

CREATE TABLE IF NOT EXISTS onboarding_penny_drop_requests (
  id                    CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  candidate_id          CHAR(36)      NOT NULL,
  request_id            VARCHAR(100)  NOT NULL UNIQUE,
  account_no            VARCHAR(25)   NOT NULL,
  ifsc_code             VARCHAR(11)   NOT NULL,
  account_holder_name   VARCHAR(255)  NOT NULL,
  account_name          VARCHAR(255),
  verification_code     VARCHAR(10),
  status                ENUM('initiated', 'success', 'pending', 'failed', 'reversed', 'name_mismatch') DEFAULT 'initiated',
  transaction_id        VARCHAR(100),
  response_code         VARCHAR(50),
  message               TEXT,
  name_match_score      INT,
  initiated_at          DATETIME      DEFAULT CURRENT_TIMESTAMP,
  completed_at          DATETIME,
  created_at            DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  INDEX idx_candidate (candidate_id),
  INDEX idx_request_id (request_id),
  INDEX idx_status (status),
  INDEX idx_initiated_at (initiated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Flag candidates with mismatches or issues for Payroll HQ manual review

CREATE TABLE IF NOT EXISTS candidate_payroll_review_flags (
  id                CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  candidate_id      CHAR(36)      NOT NULL UNIQUE,
  flag_reason       VARCHAR(100)  NOT NULL,
  status            ENUM('pending', 'reviewed', 'resolved', 'escalated') DEFAULT 'pending',
  reviewed_by       CHAR(36),
  review_notes      TEXT,
  flagged_at        DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  INDEX idx_candidate (candidate_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add column to onboarding bridge to track penny drop status

ALTER TABLE ats_onboarding_bridge
ADD COLUMN penny_drop_status ENUM('not_started', 'initiated', 'verified', 'failed', 'name_mismatch') DEFAULT 'not_started',
ADD COLUMN penny_drop_verified_at DATETIME;

INSERT IGNORE INTO org_settings (id, setting_key, setting_value, label)
VALUES (UUID(), 'penny_drop_enabled', 'true', 'Enable penny drop bank verification in onboarding');
