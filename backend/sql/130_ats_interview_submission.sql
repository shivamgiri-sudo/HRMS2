-- 130_ats_interview_submission.sql
USE mas_hrms;

-- Interview submission (upsert target — one row per candidate+qtoken pair)
CREATE TABLE IF NOT EXISTS ats_interview_submission (
  id                       CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id             CHAR(36)       NOT NULL,
  q_token                  VARCHAR(100)   NOT NULL,
  recruiter_user_id        CHAR(36),
  recruiter_code           VARCHAR(50),

  -- Submission payload
  interviewed_for_process  VARCHAR(255),
  walkin_end_stage         VARCHAR(100),
  final_decision           VARCHAR(100),

  -- Round 1 - HR Screening
  round1_result            VARCHAR(100),
  round1_voc               VARCHAR(255),
  round1_remarks           TEXT,

  -- Skill Test (optional)
  skilltest_typing         DECIMAL(5,2),
  skilltest_ai             DECIMAL(5,2),
  skilltest_result         VARCHAR(100),
  skilltest_voc            VARCHAR(255),
  skilltest_remarks        TEXT,

  -- Round 2 - Op's
  round2_result            VARCHAR(100),
  round2_voc               VARCHAR(255),
  round2_remarks           TEXT,

  -- Round 3 - Client
  round3_result            VARCHAR(100),
  round3_voc               VARCHAR(255),
  round3_remarks           TEXT,

  -- Offer details (required when final_decision = Selected)
  offer_salary             DECIMAL(12,2),
  offer_doj                DATE,
  reporting_timing         VARCHAR(100),
  ot_details               VARCHAR(255),
  performance_incentives   VARCHAR(255),

  -- Resubmission tracking — preserved on every UPDATE
  previous_submitted_time  DATETIME       NULL,
  last_walkin_end_stage    VARCHAR(100)   NULL,
  last_final_decision      VARCHAR(100)   NULL,

  -- Timestamps
  submitted_at             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  UNIQUE KEY uq_submission (candidate_id, q_token),
  INDEX idx_submission_recruiter (recruiter_code),
  INDEX idx_submission_stage (walkin_end_stage),
  INDEX idx_submission_decision (final_decision)
);

-- Audit trail for every insert/update to ats_interview_submission
CREATE TABLE IF NOT EXISTS ats_interview_submission_audit (
  id             CHAR(36)          NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  submission_id  CHAR(36)          NOT NULL,
  action         ENUM('INSERT','UPDATE') NOT NULL,
  actor_user_id  CHAR(36),
  snapshot       JSON,
  created_at     DATETIME          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (submission_id) REFERENCES ats_interview_submission(id) ON DELETE CASCADE,
  INDEX idx_sub_audit_submission (submission_id),
  INDEX idx_sub_audit_action (action)
);
