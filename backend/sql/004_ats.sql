-- 004_ats.sql
USE mas_hrms;

CREATE TABLE IF NOT EXISTS ats_sourcing_channel (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  channel_code  VARCHAR(50)  NOT NULL UNIQUE,
  channel_name  VARCHAR(255) NOT NULL,
  channel_type  VARCHAR(50),
  active_status TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ats_candidate (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_code        VARCHAR(50)  NOT NULL UNIQUE,
  full_name             VARCHAR(255) NOT NULL,
  mobile                VARCHAR(20)  NOT NULL,
  email                 VARCHAR(255),
  gender                ENUM('Male','Female','Other'),
  date_of_birth         DATE,
  current_stage         VARCHAR(100) NOT NULL DEFAULT 'Applied',
  applied_for_process   VARCHAR(255),
  applied_for_branch    VARCHAR(255),
  sourcing_channel      VARCHAR(100),
  referred_by           VARCHAR(255),
  walk_in_date          DATE,
  remarks               TEXT,
  active_status         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ats_mobile (mobile),
  INDEX idx_ats_stage (current_stage)
);

CREATE TABLE IF NOT EXISTS ats_interview_slot (
  id            CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  slot_date     DATE      NOT NULL,
  slot_time     TIME,
  branch_id     CHAR(36),
  process_id    CHAR(36),
  max_capacity  INT       NOT NULL DEFAULT 20,
  registered    INT       NOT NULL DEFAULT 0,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id) ON DELETE SET NULL,
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  INDEX idx_slot_date (slot_date)
);

CREATE TABLE IF NOT EXISTS ats_candidate_stage_log (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id      CHAR(36)     NOT NULL,
  from_stage        VARCHAR(100),
  to_stage          VARCHAR(100) NOT NULL,
  stage_date        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  remarks           TEXT,
  updated_by        CHAR(36),
  interview_slot_id CHAR(36),
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  INDEX idx_stage_log_cand (candidate_id)
);

CREATE TABLE IF NOT EXISTS ats_onboarding_bridge (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id     CHAR(36)     NOT NULL UNIQUE,
  employee_id      CHAR(36),
  bridge_date      DATE         NOT NULL,
  offer_letter_url VARCHAR(500),
  joining_date     DATE,
  status           VARCHAR(50)  NOT NULL DEFAULT 'pending',
  notes            TEXT,
  created_by       CHAR(36),
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id)  REFERENCES employees(id)     ON DELETE SET NULL
);

INSERT INTO ats_sourcing_channel (channel_code, channel_name, channel_type) VALUES
  ('WALK_IN',  'Walk-in',          'walk_in'),
  ('REFERRAL', 'Employee Referral','referral'),
  ('NAUKRI',   'Naukri.com',       'portal'),
  ('INDEED',   'Indeed',           'portal'),
  ('LINKEDIN', 'LinkedIn',         'social'),
  ('WHATSAPP', 'WhatsApp Campaign','social'),
  ('AGENCY',   'Placement Agency', 'agency')
ON DUPLICATE KEY UPDATE channel_name = VALUES(channel_name);
