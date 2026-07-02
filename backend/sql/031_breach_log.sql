USE mas_hrms;

CREATE TABLE IF NOT EXISTS data_breach_log (
  id                      CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  breach_ref              VARCHAR(32)  NOT NULL UNIQUE,
  detected_at             DATETIME     NOT NULL,
  breach_type             ENUM('unauthorized_access','data_leak','system_breach','insider_threat','ransomware','other') NOT NULL DEFAULT 'other',
  affected_records_count  INT          NOT NULL DEFAULT 0,
  affected_data_types     JSON         COMMENT 'Array: ["name","email","salary","aadhaar",...]',
  severity                ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  description             TEXT         NOT NULL,
  immediate_action_taken  TEXT,
  notified_authority_at   DATETIME     COMMENT 'CERT-In / DPDP Authority notification (within 72 hours)',
  notified_principals_at  DATETIME     COMMENT 'Affected data principals notified',
  authority_ref           VARCHAR(128) COMMENT 'Reference number from authority',
  remediation_notes       TEXT,
  status                  ENUM('detected','investigating','contained','resolved','reported') NOT NULL DEFAULT 'detected',
  reported_by             CHAR(36)     NOT NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
