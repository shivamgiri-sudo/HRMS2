-- 017_ats_wfm_completion.sql
-- Package 3: ATS manpower requisition, BGV, offer, duplicate detection,
-- sourcing funnel; WFM roster swap/conflict, coverage/shrinkage/attrition.
-- All additive. Do not execute on production without explicit approval.
USE mas_hrms;

-- ── 1. ATS: Manpower Requisition ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS manpower_requisition (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  req_code          VARCHAR(50)  NOT NULL UNIQUE,
  process_id        CHAR(36),
  branch_id         CHAR(36),
  department_id     CHAR(36),
  designation_id    CHAR(36),
  requested_count   INT          NOT NULL DEFAULT 1,
  fulfilled_count   INT          NOT NULL DEFAULT 0,
  priority          ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  reason            TEXT,
  expected_joining  DATE,
  status            ENUM('draft','open','in_progress','fulfilled','cancelled','on_hold')
                                NOT NULL DEFAULT 'draft',
  raised_by         CHAR(36)     NOT NULL,
  approved_by       CHAR(36),
  approved_at       DATETIME,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mr_process (process_id),
  INDEX idx_mr_status (status),
  FOREIGN KEY (process_id)    REFERENCES process_master(id)    ON DELETE SET NULL,
  FOREIGN KEY (branch_id)     REFERENCES branch_master(id)     ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES department_master(id) ON DELETE SET NULL,
  FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE SET NULL
);

-- Link candidate to requisition (optional; preserves existing ATS flows)
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='requisition_id') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN requisition_id CHAR(36) NULL, ADD COLUMN bgv_status VARCHAR(50) NULL DEFAULT ''pending'', ADD COLUMN offer_status VARCHAR(50) NULL, ADD COLUMN duplicate_of CHAR(36) NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. ATS: BGV Tracking ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_bgv_record (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id      CHAR(36)     NOT NULL,
  bgv_vendor        VARCHAR(255),
  initiated_date    DATE,
  completed_date    DATE,
  overall_status    ENUM('pending','in_progress','clear','adverse','pending_review')
                                NOT NULL DEFAULT 'pending',
  address_check     ENUM('pending','clear','adverse') DEFAULT 'pending',
  education_check   ENUM('pending','clear','adverse') DEFAULT 'pending',
  employment_check  ENUM('pending','clear','adverse') DEFAULT 'pending',
  criminal_check    ENUM('pending','clear','adverse') DEFAULT 'pending',
  remarks           TEXT,
  initiated_by      CHAR(36)     NOT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bgv_candidate (candidate_id),
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 3. ATS: Offer Management ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_offer (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id      CHAR(36)     NOT NULL,
  requisition_id    CHAR(36),
  offered_ctc       DECIMAL(12,2),
  offered_designation VARCHAR(255),
  offered_process   VARCHAR(255),
  offered_branch    VARCHAR(255),
  offer_date        DATE         NOT NULL,
  offer_expiry_date DATE,
  joining_date      DATE,
  status            ENUM('draft','sent','accepted','rejected','withdrawn','expired','lapsed')
                                NOT NULL DEFAULT 'draft',
  rejection_reason  TEXT,
  prepared_by       CHAR(36)     NOT NULL,
  approved_by       CHAR(36),
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 4. ATS: Duplicate detection log ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ats_duplicate_log (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id      CHAR(36)     NOT NULL,
  matched_with_id   CHAR(36)     NOT NULL,
  match_reason      VARCHAR(255) NOT NULL,
  match_score       TINYINT,
  resolved          TINYINT(1)   NOT NULL DEFAULT 0,
  resolution_note   TEXT,
  detected_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id)   REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (matched_with_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
);

-- ── 5. WFM: Roster swap / conflict ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wfm_roster_swap_request (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  requester_emp_id  CHAR(36)     NOT NULL,
  swap_with_emp_id  CHAR(36)     NOT NULL,
  swap_date         DATE         NOT NULL,
  reason            TEXT,
  status            ENUM('pending','approved','rejected','withdrawn')
                                NOT NULL DEFAULT 'pending',
  reviewed_by       CHAR(36),
  reviewed_at       DATETIME,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_swap_requester (requester_emp_id),
  INDEX idx_swap_date (swap_date),
  FOREIGN KEY (requester_emp_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (swap_with_emp_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wfm_roster_conflict_log (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id       CHAR(36)     NOT NULL,
  conflict_date     DATE         NOT NULL,
  conflict_type     VARCHAR(100) NOT NULL,
  description       TEXT,
  resolved          TINYINT(1)   NOT NULL DEFAULT 0,
  detected_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conflict_emp (employee_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- ── 6. WFM: Coverage / shrinkage / attrition snapshot ────────────────────────

CREATE TABLE IF NOT EXISTS wfm_coverage_snapshot (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  snapshot_date     DATE         NOT NULL,
  process_id        CHAR(36),
  branch_id         CHAR(36),
  planned_headcount INT          NOT NULL DEFAULT 0,
  actual_headcount  INT          NOT NULL DEFAULT 0,
  absent_count      INT          NOT NULL DEFAULT 0,
  leave_count       INT          NOT NULL DEFAULT 0,
  shrinkage_pct     DECIMAL(5,2) NOT NULL DEFAULT 0,
  coverage_pct      DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_coverage_date_proc (snapshot_date, process_id, branch_id),
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id)  REFERENCES branch_master(id)  ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS attrition_record (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id       CHAR(36)     NOT NULL,
  process_id        CHAR(36),
  branch_id         CHAR(36),
  exit_date         DATE         NOT NULL,
  exit_type         ENUM('voluntary','involuntary','absconding','contract_end','other') NOT NULL,
  tenure_days       INT,
  recorded_by       CHAR(36),
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_attr_process (process_id),
  INDEX idx_attr_date (exit_date),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (process_id)  REFERENCES process_master(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id)   REFERENCES branch_master(id)  ON DELETE SET NULL
);

-- Add exit_request_id and is_provisional to link attrition records to exit_request table.
-- is_provisional = 1 flags records not yet linked to an exit_request (provisional analytics only).
SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='attrition_record' AND COLUMN_NAME='exit_request_id') = 0,
  'ALTER TABLE attrition_record ADD COLUMN exit_request_id CHAR(36) NULL, ADD COLUMN is_provisional TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
