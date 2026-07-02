-- DigiLocker integration for onboarding document authorization

CREATE TABLE IF NOT EXISTS candidate_digilocker_sessions (
  session_id            VARCHAR(100)  PRIMARY KEY,
  candidate_id          CHAR(36)      NOT NULL,
  auth_url              TEXT          NOT NULL,
  state                 VARCHAR(100)  NOT NULL UNIQUE,
  requested_documents   JSON,
  documents_received    JSON,
  expires_at            DATETIME      NOT NULL,
  status                ENUM('initiated', 'pending', 'documents_received', 'expired') DEFAULT 'initiated',
  initiated_at          DATETIME      DEFAULT CURRENT_TIMESTAMP,
  completed_at          DATETIME,
  created_at            DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  INDEX idx_candidate (candidate_id),
  INDEX idx_state (state),
  INDEX idx_status (status),
  INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add DigiLocker status to onboarding bridge

ALTER TABLE ats_onboarding_bridge
ADD COLUMN digilocker_status ENUM('not_started', 'initiated', 'documents_received', 'expired') DEFAULT 'not_started',
ADD COLUMN digilocker_session_id VARCHAR(100),
ADD COLUMN digilocker_completed_at DATETIME;

INSERT IGNORE INTO org_settings (id, setting_key, setting_value, label)
VALUES (UUID(), 'digilocker_enabled', 'true', 'Enable DigiLocker document verification in onboarding');
