USE mas_hrms;

CREATE TABLE IF NOT EXISTS job_posting (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  posting_code    VARCHAR(32)  NOT NULL UNIQUE,
  title           VARCHAR(255) NOT NULL,
  process_id      CHAR(36),
  branch_id       CHAR(36),
  department_id   CHAR(36),
  designation_id  CHAR(36),
  vacancies       INT          NOT NULL DEFAULT 1,
  job_type        ENUM('full_time','part_time','contract','internship') NOT NULL DEFAULT 'full_time',
  experience_min  INT          NOT NULL DEFAULT 0 COMMENT 'months',
  experience_max  INT          NOT NULL DEFAULT 0 COMMENT '0 = no limit',
  description     TEXT,
  requirements    TEXT,
  salary_min      DECIMAL(10,2),
  salary_max      DECIMAL(10,2),
  posted_by       CHAR(36),
  status          ENUM('draft','active','paused','closed') NOT NULL DEFAULT 'draft',
  closing_date    DATE,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_job_process (process_id),
  INDEX idx_job_status (status)
);

CREATE TABLE IF NOT EXISTS walkin_queue (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  token_number    VARCHAR(16)  NOT NULL,
  candidate_name  VARCHAR(128) NOT NULL,
  mobile          VARCHAR(20)  NOT NULL,
  email           VARCHAR(255),
  applied_role    VARCHAR(128),
  branch_id       CHAR(36),
  process_id      CHAR(36),
  registered_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at       DATETIME,
  status          ENUM('waiting','called','in_interview','completed','no_show') NOT NULL DEFAULT 'waiting',
  notes           TEXT,
  recruiter_id    CHAR(36),
  INDEX idx_walkin_branch (branch_id),
  INDEX idx_walkin_status (status),
  INDEX idx_walkin_date (registered_at)
);
