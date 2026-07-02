-- Migration 270: Fix Shivam page access and align HRMS2 lifecycle page codes.
-- Additive only: creates/updates grants, does not revoke or delete access.

INSERT INTO workforce_role_catalog (role_key, role_name, description, active_status) VALUES
('super_admin', 'Super Administrator', 'Unrestricted system administration access', 1),
('admin', 'System Administrator', 'System administrator access', 1),
('hr', 'HR Manager', 'HR lifecycle access', 1),
('payroll_hr', 'Payroll HR', 'Payroll HR validation access', 1),
('branch_head', 'Branch Head', 'Branch head approval access', 1),
('recruiter', 'Recruiter', 'ATS recruiter access', 1),
('wfm', 'WFM Analyst', 'Workforce management access', 1),
('it', 'IT Provisioning', 'IT provisioning access', 1),
('branch_admin', 'Branch Admin', 'Branch administration access', 1)
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  description = COALESCE(VALUES(description), description),
  active_status = 1;

SET @missing_recruiter_employee_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ats_recruiter_roster'
    AND COLUMN_NAME = 'employee_id'
);
SET @ddl := IF(
  @missing_recruiter_employee_id = 0,
  'ALTER TABLE ats_recruiter_roster ADD COLUMN employee_id CHAR(36) NULL AFTER branch_head_email',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @missing_recruiter_employee_idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ats_recruiter_roster'
    AND INDEX_NAME = 'idx_ats_recruiter_employee'
);
SET @ddl := IF(
  @missing_recruiter_employee_idx = 0,
  'CREATE INDEX idx_ats_recruiter_employee ON ats_recruiter_roster (employee_id)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS ats_interview_submission (
  id                       CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id             CHAR(36)       NOT NULL,
  q_token                  VARCHAR(100)   NOT NULL,
  recruiter_user_id        CHAR(36),
  recruiter_code           VARCHAR(50),
  interviewed_for_process  VARCHAR(255),
  walkin_end_stage         VARCHAR(100),
  final_decision           VARCHAR(100),
  round1_result            VARCHAR(100),
  round1_voc               VARCHAR(255),
  round1_remarks           TEXT,
  skilltest_typing         DECIMAL(5,2),
  skilltest_ai             DECIMAL(5,2),
  skilltest_result         VARCHAR(100),
  skilltest_voc            VARCHAR(255),
  skilltest_remarks        TEXT,
  round2_result            VARCHAR(100),
  round2_voc               VARCHAR(255),
  round2_remarks           TEXT,
  round3_result            VARCHAR(100),
  round3_voc               VARCHAR(255),
  round3_remarks           TEXT,
  offer_salary             DECIMAL(12,2),
  offer_doj                DATE,
  reporting_timing         VARCHAR(100),
  ot_details               VARCHAR(255),
  performance_incentives   VARCHAR(255),
  previous_submitted_time  DATETIME       NULL,
  last_walkin_end_stage    VARCHAR(100)   NULL,
  last_final_decision      VARCHAR(100)   NULL,
  submitted_at             DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_submission (candidate_id, q_token),
  INDEX idx_submission_recruiter (recruiter_code),
  INDEX idx_submission_stage (walkin_end_stage),
  INDEX idx_submission_decision (final_decision),
  CONSTRAINT fk_ats_interview_submission_candidate
    FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ats_interview_submission_audit (
  id             CHAR(36)                  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  submission_id  CHAR(36)                  NOT NULL,
  action         ENUM('INSERT','UPDATE')   NOT NULL,
  actor_user_id  CHAR(36),
  submitted_by_user_id CHAR(36) NULL,
  is_proxy_submission TINYINT(1) DEFAULT 0,
  snapshot       JSON,
  created_at     DATETIME                  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sub_audit_submission (submission_id),
  INDEX idx_sub_audit_action (action),
  INDEX idx_submitted_by (submitted_by_user_id),
  CONSTRAINT fk_ats_interview_submission_audit_submission
    FOREIGN KEY (submission_id) REFERENCES ats_interview_submission(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status) VALUES
('ATS_PAYROLL_HR', 'ATS Payroll HR', 'ATS', '/ats/payroll-hr', 'Payroll HR salary validation queue', 1),
('ATS_OFFER_APPROVALS', 'ATS Offer Approvals', 'ATS', '/ats/offer-approvals', 'Offer and salary approval queue', 1),
('ATS_BRANCH_HEAD_APPROVAL', 'ATS Branch Head Approval', 'ATS', '/ats/offer-approvals', 'Legacy branch head approval page code', 1),
('ATS_RECRUITER_WORKSPACE', 'ATS Recruiter Workspace', 'ATS', '/ats/recruiter/workspace', 'Recruiter assigned candidate workspace', 1),
('PROVISIONING_WFM_ALIGNMENT', 'WFM Alignment', 'Provisioning', '/provisioning/wfm-alignment', 'WFM process and roster alignment tasks', 1),
('PROVISIONING_IT', 'IT Provisioning', 'Provisioning', '/provisioning/it', 'IT email, domain, and asset provisioning tasks', 1),
('PROVISIONING_ADMIN', 'Admin Provisioning', 'Provisioning', '/provisioning/admin', 'Admin biometric and ID card provisioning tasks', 1),
('PROVISIONING_APPOINTMENT', 'Appointment Letter Provisioning', 'Provisioning', '/provisioning/appointment-letter', 'Appointment letter e-sign tracking', 1),
('PROVISIONING_APPOINTMENT_LETTER', 'Appointment Letter Provisioning', 'Provisioning', '/provisioning/appointment-letter', 'Appointment letter e-sign tracking', 1),
('ATS_BGV', 'ATS BGV Verification', 'ATS', '/ats/bgv', 'Background verification center', 1),
('ATS_BGV_REPORT', 'ATS BGV Report', 'ATS', '/ats/bgv-report', 'Background verification report', 1),
('ATS_ONBOARDING_BRIDGE', 'ATS Onboarding Bridge', 'ATS', '/ats/onboarding-bridge', 'Candidate to employee onboarding bridge', 1),
('ATS_WALKIN_QUEUE', 'ATS Walk-in Queue', 'ATS', '/ats/walkin-queue', 'Walk-in candidate queue', 1),
('ATS_WAITING_QUEUE', 'ATS Waiting Queue', 'ATS', '/ats/waiting-queue', 'Waiting candidate queue', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description),
  active_status = 1;

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
('admin', 'ATS_PAYROLL_HR', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_PAYROLL_HR', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_PAYROLL_HR', 1, 1, 1, 0, 1, 1),
('payroll_hr', 'ATS_PAYROLL_HR', 1, 1, 1, 0, 1, 1),

('admin', 'ATS_OFFER_APPROVALS', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_OFFER_APPROVALS', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_OFFER_APPROVALS', 1, 1, 1, 0, 1, 1),
('branch_head', 'ATS_OFFER_APPROVALS', 1, 0, 1, 0, 1, 1),

('admin', 'ATS_BRANCH_HEAD_APPROVAL', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_BRANCH_HEAD_APPROVAL', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_BRANCH_HEAD_APPROVAL', 1, 1, 1, 0, 1, 1),
('branch_head', 'ATS_BRANCH_HEAD_APPROVAL', 1, 0, 1, 0, 1, 1),

('admin', 'ATS_RECRUITER_WORKSPACE', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_RECRUITER_WORKSPACE', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_RECRUITER_WORKSPACE', 1, 1, 1, 0, 1, 1),
('recruiter', 'ATS_RECRUITER_WORKSPACE', 1, 1, 1, 0, 1, 1),

('admin', 'PROVISIONING_WFM_ALIGNMENT', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_WFM_ALIGNMENT', 1, 1, 1, 1, 1, 1),
('wfm', 'PROVISIONING_WFM_ALIGNMENT', 1, 1, 1, 0, 1, 1),

('admin', 'PROVISIONING_IT', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_IT', 1, 1, 1, 1, 1, 1),
('it', 'PROVISIONING_IT', 1, 1, 1, 0, 1, 1),

('admin', 'PROVISIONING_ADMIN', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_ADMIN', 1, 1, 1, 1, 1, 1),
('hr', 'PROVISIONING_ADMIN', 1, 1, 1, 0, 1, 1),
('branch_admin', 'PROVISIONING_ADMIN', 1, 1, 1, 0, 1, 1),

('admin', 'PROVISIONING_APPOINTMENT', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_APPOINTMENT', 1, 1, 1, 1, 1, 1),
('hr', 'PROVISIONING_APPOINTMENT', 1, 1, 1, 0, 1, 1),

('admin', 'PROVISIONING_APPOINTMENT_LETTER', 1, 1, 1, 1, 1, 1),
('super_admin', 'PROVISIONING_APPOINTMENT_LETTER', 1, 1, 1, 1, 1, 1),
('hr', 'PROVISIONING_APPOINTMENT_LETTER', 1, 1, 1, 0, 1, 1),

('admin', 'ATS_BGV', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_BGV', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_BGV', 1, 1, 1, 0, 1, 1),
('recruiter', 'ATS_BGV', 1, 1, 1, 0, 1, 1),

('admin', 'ATS_BGV_REPORT', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_BGV_REPORT', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_BGV_REPORT', 1, 1, 1, 0, 1, 1),
('recruiter', 'ATS_BGV_REPORT', 1, 0, 0, 0, 1, 1),

('admin', 'ATS_ONBOARDING_BRIDGE', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_ONBOARDING_BRIDGE', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_ONBOARDING_BRIDGE', 1, 1, 1, 0, 1, 1),
('recruiter', 'ATS_ONBOARDING_BRIDGE', 1, 1, 1, 0, 1, 1),

('admin', 'ATS_WALKIN_QUEUE', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_WALKIN_QUEUE', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_WALKIN_QUEUE', 1, 1, 1, 0, 1, 1),
('recruiter', 'ATS_WALKIN_QUEUE', 1, 1, 1, 0, 1, 1),

('admin', 'ATS_WAITING_QUEUE', 1, 1, 1, 1, 1, 1),
('super_admin', 'ATS_WAITING_QUEUE', 1, 1, 1, 1, 1, 1),
('hr', 'ATS_WAITING_QUEUE', 1, 1, 1, 0, 1, 1),
('recruiter', 'ATS_WAITING_QUEUE', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1;

INSERT INTO user_page_access
  (id, user_id, page_code, can_view, can_create, can_edit, can_delete, can_export, assigned_by, active_status, notes)
SELECT UUID(), u.id, pages.page_code, 1, 1, 1, 0, 1, u.id, 1, 'HRMS2 lifecycle page access repair - migration 270'
FROM auth_user u
JOIN (
  SELECT 'ATS_PAYROLL_HR' AS page_code UNION ALL
  SELECT 'ATS_OFFER_APPROVALS' UNION ALL
  SELECT 'ATS_BRANCH_HEAD_APPROVAL' UNION ALL
  SELECT 'ATS_RECRUITER_WORKSPACE' UNION ALL
  SELECT 'PROVISIONING_WFM_ALIGNMENT' UNION ALL
  SELECT 'PROVISIONING_IT' UNION ALL
  SELECT 'PROVISIONING_ADMIN' UNION ALL
  SELECT 'PROVISIONING_APPOINTMENT' UNION ALL
  SELECT 'PROVISIONING_APPOINTMENT_LETTER' UNION ALL
  SELECT 'ATS_BGV' UNION ALL
  SELECT 'ATS_BGV_REPORT' UNION ALL
  SELECT 'ATS_ONBOARDING_BRIDGE' UNION ALL
  SELECT 'ATS_WALKIN_QUEUE' UNION ALL
  SELECT 'ATS_WAITING_QUEUE'
) pages
WHERE LOWER(u.email) = LOWER('shivam.giri@teammas.in')
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_export = VALUES(can_export),
  active_status = 1,
  notes = VALUES(notes);
