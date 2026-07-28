-- ============================================================================
-- 570_ijp_module.sql
-- Internal Job Posting (IJP) Module Tables
-- ============================================================================

-- ijp_posting: Internal job postings with eligibility criteria
CREATE TABLE IF NOT EXISTS ijp_posting (
  id CHAR(36) PRIMARY KEY,
  posting_code VARCHAR(50) NOT NULL,
  job_title VARCHAR(200) NOT NULL,
  description TEXT,

  -- Target position details
  department_id CHAR(36) NULL COMMENT 'Target department (NULL = any)',
  process_id CHAR(36) NULL COMMENT 'Target process (NULL = any)',
  designation_id CHAR(36) NULL COMMENT 'Target designation level',
  branch_id CHAR(36) NULL COMMENT 'Target branch (NULL = any)',
  vacancies INT UNSIGNED NOT NULL DEFAULT 1,

  -- Eligibility criteria
  min_tenure_months INT UNSIGNED NOT NULL DEFAULT 12 COMMENT 'Minimum months since date_of_joining',
  eligible_employment_status JSON COMMENT 'Array of allowed employment statuses',
  eligible_department_ids JSON DEFAULT NULL COMMENT 'NULL = all departments eligible',
  eligible_process_ids JSON DEFAULT NULL COMMENT 'NULL = all processes eligible',
  excluded_process_ids JSON DEFAULT NULL COMMENT 'Specific processes blocked from applying',
  eligible_designation_ids JSON DEFAULT NULL COMMENT 'NULL = all designations eligible',
  eligible_branch_ids JSON DEFAULT NULL COMMENT 'NULL = all branches eligible',
  min_performance_rating DECIMAL(3,2) NULL COMMENT 'Optional minimum performance rating',
  require_manager_approval TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Require reporting manager approval before HR review',

  -- Posting lifecycle
  status ENUM('draft','open','closed','filled','cancelled') NOT NULL DEFAULT 'draft',
  posted_by CHAR(36) NOT NULL COMMENT 'Employee who created the posting',
  posted_at DATETIME NULL COMMENT 'When status changed to open',
  closes_at DATETIME NULL COMMENT 'Application deadline',
  closed_at DATETIME NULL COMMENT 'When posting was closed/filled',
  close_reason VARCHAR(200) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_posting_code (posting_code),
  KEY idx_status (status),
  KEY idx_posted_at (posted_at),
  KEY idx_closes_at (closes_at),
  KEY idx_department (department_id),
  KEY idx_process (process_id),
  KEY idx_branch (branch_id),

  CONSTRAINT fk_ijp_posting_department FOREIGN KEY (department_id) REFERENCES department_master(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_posting_process FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_posting_designation FOREIGN KEY (designation_id) REFERENCES designation_master(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_posting_branch FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_posting_posted_by FOREIGN KEY (posted_by) REFERENCES employees(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ijp_application: Employee applications to internal postings
CREATE TABLE IF NOT EXISTS ijp_application (
  id CHAR(36) PRIMARY KEY,
  posting_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  application_note TEXT COMMENT 'Employee motivation/cover letter',

  -- Snapshot of employee position at application time
  current_department_id CHAR(36) NULL,
  current_process_id CHAR(36) NULL,
  current_designation_id CHAR(36) NULL,
  current_branch_id CHAR(36) NULL,
  tenure_months INT UNSIGNED NULL COMMENT 'Tenure at time of application',

  -- Application workflow
  status ENUM('submitted','pending_manager','manager_approved','manager_rejected','under_review','shortlisted','interview_scheduled','selected','rejected','withdrawn','offer_extended','offer_accepted','offer_declined') NOT NULL DEFAULT 'submitted',

  -- Manager approval (if required)
  manager_id CHAR(36) NULL COMMENT 'Reporting manager who reviews',
  manager_action_at DATETIME NULL,
  manager_remarks TEXT,

  -- HR review
  reviewed_by CHAR(36) NULL COMMENT 'HR reviewer',
  reviewed_at DATETIME NULL,
  review_remarks TEXT,

  -- Interview tracking
  interview_scheduled_at DATETIME NULL,
  interview_remarks TEXT,

  -- Selection
  selected_at DATETIME NULL,
  selection_remarks TEXT,
  offer_details JSON NULL COMMENT 'Salary, designation, joining date etc.',

  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_posting_employee (posting_id, employee_id),
  KEY idx_employee (employee_id),
  KEY idx_status (status),
  KEY idx_applied_at (applied_at),
  KEY idx_manager (manager_id),
  KEY idx_reviewed_by (reviewed_by),

  CONSTRAINT fk_ijp_app_posting FOREIGN KEY (posting_id) REFERENCES ijp_posting(id) ON DELETE CASCADE,
  CONSTRAINT fk_ijp_app_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_ijp_app_manager FOREIGN KEY (manager_id) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_app_reviewer FOREIGN KEY (reviewed_by) REFERENCES employees(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_app_cur_dept FOREIGN KEY (current_department_id) REFERENCES department_master(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_app_cur_proc FOREIGN KEY (current_process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_app_cur_desg FOREIGN KEY (current_designation_id) REFERENCES designation_master(id) ON DELETE SET NULL,
  CONSTRAINT fk_ijp_app_cur_branch FOREIGN KEY (current_branch_id) REFERENCES branch_master(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ijp_audit_log: Audit trail for all IJP actions
CREATE TABLE IF NOT EXISTS ijp_audit_log (
  id CHAR(36) PRIMARY KEY,
  posting_id CHAR(36) NULL,
  application_id CHAR(36) NULL,
  action VARCHAR(50) NOT NULL COMMENT 'e.g. posting_created, application_submitted, status_changed',
  actor_id CHAR(36) NOT NULL COMMENT 'Employee who performed the action',
  actor_role VARCHAR(50) NULL COMMENT 'Role at time of action',
  old_value JSON NULL,
  new_value JSON NULL,
  details JSON NULL COMMENT 'Additional context',
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_posting (posting_id),
  KEY idx_application (application_id),
  KEY idx_actor (actor_id),
  KEY idx_action (action),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ijp_notification_queue: Track notifications to be sent
CREATE TABLE IF NOT EXISTS ijp_notification_queue (
  id CHAR(36) PRIMARY KEY,
  posting_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  notification_type ENUM('new_posting','application_received','status_update','deadline_reminder') NOT NULL,
  status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  scheduled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_status (status),
  KEY idx_scheduled (scheduled_at),
  KEY idx_posting (posting_id),
  KEY idx_employee (employee_id),

  CONSTRAINT fk_ijp_notif_posting FOREIGN KEY (posting_id) REFERENCES ijp_posting(id) ON DELETE CASCADE,
  CONSTRAINT fk_ijp_notif_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add IJP pages to page catalog
INSERT INTO page_master (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'ijp_admin', 'IJP Administration', '/ijp/admin', 'recruitment', 'Create and manage internal job postings', 1, NOW()),
  (UUID(), 'ijp_my_applications', 'My IJP Applications', '/ijp/my-applications', 'people', 'View and manage my internal job applications', 1, NOW()),
  (UUID(), 'ijp_opportunities', 'Internal Opportunities', '/ijp/opportunities', 'people', 'Browse and apply to internal job postings', 1, NOW())
ON DUPLICATE KEY UPDATE page_name = VALUES(page_name), description = VALUES(description);

-- Grant IJP admin access to HR roles
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, created_at)
SELECT UUID(), role_key, 'ijp_admin', 1, 1, 1, 1, NOW()
FROM (SELECT 'super_admin' AS role_key UNION SELECT 'hr' UNION SELECT 'hr_admin' UNION SELECT 'recruitment_hr') r
ON DUPLICATE KEY UPDATE can_view = 1, can_create = 1, can_edit = 1;

-- Grant IJP view access to managers (view applications for their reports)
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, created_at)
SELECT UUID(), role_key, 'ijp_admin', 1, 0, 0, 0, NOW()
FROM (SELECT 'branch_head' AS role_key UNION SELECT 'process_manager' UNION SELECT 'operations_manager') r
ON DUPLICATE KEY UPDATE can_view = 1;

-- Grant employee IJP pages access to all roles
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, created_at)
SELECT UUID(), role_key, page_code, 1, 1, 0, 0, NOW()
FROM (SELECT 'employee' AS role_key UNION SELECT 'team_leader' UNION SELECT 'tl' UNION SELECT 'trainer' UNION SELECT 'qa') r
CROSS JOIN (SELECT 'ijp_my_applications' AS page_code UNION SELECT 'ijp_opportunities') p
ON DUPLICATE KEY UPDATE can_view = 1, can_create = 1;
