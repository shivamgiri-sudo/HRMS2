-- 067_employee_task_system.sql
-- Multi-Department Task Orchestration System for Employee Onboarding
-- Creates automated workflow for IT, Admin, Biometric, Payroll, and other departments

USE mas_hrms;

-- ============================================================================
-- 1. TASK MASTER - Reusable task definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  task_code       VARCHAR(100) NOT NULL UNIQUE,
  task_name       VARCHAR(255) NOT NULL,
  task_description TEXT,
  category        ENUM('onboarding','exit','transfer','promotion','lifecycle','adhoc') NOT NULL,
  department      ENUM('it','admin','hr','payroll','wfm','asset','biometric','security','facility','training','qa') NOT NULL,
  default_assignee_role VARCHAR(50) COMMENT 'Role that typically handles this task',
  estimated_hours INT          DEFAULT 2,
  sla_hours       INT          NOT NULL DEFAULT 24,
  requires_attachment BOOLEAN  DEFAULT FALSE,
  requires_approval   BOOLEAN  DEFAULT FALSE,
  task_instructions   TEXT     COMMENT 'Step-by-step instructions for completing task',
  checklist_items     JSON     COMMENT 'Array of checklist items',
  active_status   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_task_category (category),
  INDEX idx_task_dept (department),
  INDEX idx_task_active (active_status)
) COMMENT='Reusable task definitions for workflows';

-- ============================================================================
-- 2. TASK TEMPLATE - Groups of tasks for different scenarios
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_template (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_code   VARCHAR(100) NOT NULL UNIQUE,
  template_name   VARCHAR(255) NOT NULL,
  template_type   ENUM('onboarding','exit','transfer','promotion','confirmation') NOT NULL,
  description     TEXT,
  applies_to      JSON         COMMENT 'Conditions: emp_type, designation, process, etc.',
  active_status   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by      CHAR(36),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_template_type (template_type),
  INDEX idx_template_active (active_status)
) COMMENT='Task templates for different employee lifecycle events';

-- ============================================================================
-- 3. TASK TEMPLATE ITEMS - Tasks within a template with dependencies
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_template_item (
  id                  CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_id         CHAR(36)  NOT NULL,
  task_id             CHAR(36)  NOT NULL,
  sequence_order      INT       NOT NULL,
  dependency_task_ids JSON      COMMENT 'Array of task_ids that must complete first',
  parallel_group      INT       COMMENT 'Tasks in same group run in parallel',
  mandatory           BOOLEAN   NOT NULL DEFAULT TRUE,
  sla_override_hours  INT       COMMENT 'Override default task SLA',
  FOREIGN KEY (template_id) REFERENCES task_template(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES task_master(id) ON DELETE CASCADE,
  INDEX idx_template_item_template (template_id),
  INDEX idx_template_item_order (sequence_order)
) COMMENT='Tasks within templates with dependency configuration';

-- ============================================================================
-- 4. EMPLOYEE TASK - Actual task instances assigned to employees
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_task (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  task_code           VARCHAR(100) NOT NULL,
  employee_id         CHAR(36)     NOT NULL,
  task_name           VARCHAR(255) NOT NULL,
  task_description    TEXT,
  department          VARCHAR(50)  NOT NULL,
  assigned_to_user_id CHAR(36)     COMMENT 'Specific user assigned',
  assigned_to_role    VARCHAR(50)  COMMENT 'Role-based assignment',
  status              ENUM('pending','in_progress','waiting_approval','completed','cancelled','overdue')
                                   NOT NULL DEFAULT 'pending',
  priority            ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  due_date            DATETIME     NOT NULL,
  started_at          DATETIME,
  completed_at        DATETIME,
  completed_by        CHAR(36),
  completion_notes    TEXT,
  attachment_url      VARCHAR(500),
  dependency_task_ids JSON         COMMENT 'IDs of tasks that must complete first',
  trigger_event       VARCHAR(100) COMMENT 'What triggered this task creation',
  reminder_sent       BOOLEAN      NOT NULL DEFAULT FALSE,
  reminder_sent_at    DATETIME,
  escalation_sent     BOOLEAN      NOT NULL DEFAULT FALSE,
  escalation_sent_at  DATETIME,
  template_id         CHAR(36)     COMMENT 'Source template if created from template',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to_user_id) REFERENCES auth_user(id) ON DELETE SET NULL,
  FOREIGN KEY (completed_by) REFERENCES auth_user(id) ON DELETE SET NULL,
  FOREIGN KEY (template_id) REFERENCES task_template(id) ON DELETE SET NULL,
  INDEX idx_emp_task_emp (employee_id),
  INDEX idx_emp_task_assigned_user (assigned_to_user_id),
  INDEX idx_emp_task_assigned_role (assigned_to_role),
  INDEX idx_emp_task_status (status),
  INDEX idx_emp_task_dept (department),
  INDEX idx_emp_task_due (due_date),
  INDEX idx_emp_task_priority (priority),
  INDEX idx_emp_task_overdue (status, due_date)
) COMMENT='Actual task instances for employees';

-- ============================================================================
-- 5. EMPLOYEE TASK COMMENT - Comments and updates on tasks
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_task_comment (
  id                  CHAR(36)  NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  task_id             CHAR(36)  NOT NULL,
  user_id             CHAR(36)  NOT NULL,
  comment_text        TEXT      NOT NULL,
  is_system_generated BOOLEAN   NOT NULL DEFAULT FALSE,
  attachment_url      VARCHAR(500),
  created_at          DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES employee_task(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE,
  INDEX idx_task_comment (task_id),
  INDEX idx_task_comment_created (created_at)
) COMMENT='Comments and updates on tasks';

-- ============================================================================
-- 6. EMPLOYEE TASK CHECKLIST - Sub-items within a task
-- ============================================================================

CREATE TABLE IF NOT EXISTS employee_task_checklist (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  task_id         CHAR(36)     NOT NULL,
  item_text       VARCHAR(500) NOT NULL,
  is_completed    BOOLEAN      NOT NULL DEFAULT FALSE,
  completed_by    CHAR(36),
  completed_at    DATETIME,
  sequence_order  INT          NOT NULL,
  FOREIGN KEY (task_id) REFERENCES employee_task(id) ON DELETE CASCADE,
  FOREIGN KEY (completed_by) REFERENCES auth_user(id) ON DELETE SET NULL,
  INDEX idx_task_checklist (task_id),
  INDEX idx_task_checklist_order (sequence_order)
) COMMENT='Checklist items within tasks';

-- ============================================================================
-- 7. SEED DATA - Common onboarding tasks
-- ============================================================================

INSERT INTO task_master (task_code, task_name, task_description, category, department, default_assignee_role, estimated_hours, sla_hours, task_instructions, checklist_items) VALUES

-- HR Tasks
('HR_GEN_EMP_CODE', 'Generate Employee Code', 'Create unique employee code in system', 'onboarding', 'hr', 'hr_admin', 1, 4,
 'Login to HRMS → Navigate to Employees → Click Add Employee → System will auto-generate code',
 '["Verify employee doesn''t already exist", "Generate code with correct prefix", "Save employee record"]'),

('HR_ASSIGN_MANAGER', 'Assign Reporting Manager', 'Assign reporting manager based on department/process', 'onboarding', 'hr', 'hr_admin', 1, 4,
 'Employee profile → Organizational tab → Select reporting manager from dropdown → Save',
 '["Verify manager has capacity", "Update reporting chain", "Notify manager"]'),

('HR_INDUCTION_SCHEDULE', 'Schedule Induction', 'Schedule employee for HR induction session', 'onboarding', 'hr', 'hr_admin', 2, 24,
 'Check induction calendar → Book slot → Send calendar invite → Add to induction batch',
 '["Find available slot", "Add to calendar", "Send invite", "Update induction tracker"]'),

-- IT Tasks
('IT_CREATE_USER', 'Create User Account', 'Create system user account with appropriate access', 'onboarding', 'it', 'it_admin', 2, 4,
 'Login to Admin Panel → Users → Add User → Set username as employee_code → Generate temporary password → Assign role based on designation',
 '["Create username", "Generate password", "Set must_change_password flag", "Assign role", "Send credentials via secure channel"]'),

('IT_CREATE_EMAIL', 'Create Corporate Email', 'Setup corporate email account', 'onboarding', 'it', 'it_admin', 2, 4,
 'Login to Email Admin → Create new account → Format: firstname.lastname@domain.com → Set temp password → Configure mailbox size',
 '["Create email account", "Set quota (5GB default)", "Add to appropriate distribution lists", "Send credentials"]'),

('IT_ASSIGN_LAPTOP', 'Assign Laptop/Desktop', 'Assign and configure laptop or desktop for employee', 'onboarding', 'it', 'it_asset_manager', 4, 12,
 'Check available inventory → Select device → Install standard software → Configure domain join → Update asset management system',
 '["Check inventory", "Install OS and software", "Domain join", "Test login", "Update asset register", "Get employee acknowledgment"]'),

('IT_SETUP_VPN', 'Setup VPN Access', 'Configure VPN access for remote work', 'onboarding', 'it', 'it_admin', 1, 8,
 'VPN Portal → Add user → Generate VPN config → Send credentials → Test connection',
 '["Add user to VPN", "Generate config file", "Send credentials", "Document access granted"]'),

('IT_DIALER_ACCESS', 'Create Dialer Account', 'Setup dialer/phone system access', 'onboarding', 'it', 'dialer_admin', 2, 8,
 'Login to ViciDial Admin → Add Agent → Set extension → Configure campaign access → Test login',
 '["Create agent account", "Assign extension", "Add to campaigns", "Set permissions", "Test login"]'),

-- Admin Tasks
('ADMIN_BIOMETRIC', 'Setup Biometric Access', 'Enroll employee fingerprints for attendance system', 'onboarding', 'admin', 'biometric_admin', 1, 8,
 'Bring employee to biometric device → Enroll 2 thumbs → Verify enrollment → Sync with attendance system',
 '["Scan right thumb (2 times)", "Scan left thumb (2 times)", "Test recognition", "Sync to system", "Verify in attendance app"]'),

('ADMIN_ID_CARD', 'Issue Employee ID Card', 'Create and issue physical ID card', 'onboarding', 'admin', 'admin_staff', 4, 24,
 'Capture photo → Design card → Print → Laminate → Get employee signature → Update register',
 '["Take photo", "Design card with emp code", "Print and laminate", "Get signature", "Log in ID card register"]'),

('ADMIN_LOCKER', 'Assign Locker', 'Assign personal locker to employee', 'onboarding', 'admin', 'facility_manager', 2, 12,
 'Check locker availability → Assign locker number → Issue key/combination → Update locker register',
 '["Check available lockers", "Assign locker number", "Issue key", "Document assignment", "Get acknowledgment"]'),

('ADMIN_WORKSTATION', 'Assign Workstation/Seat', 'Assign permanent workstation/seat', 'onboarding', 'admin', 'facility_manager', 2, 12,
 'Check seating chart → Assign seat based on process/team → Update floor plan → Inform team lead',
 '["Check seat availability", "Assign seat number", "Update floor plan", "Add name plate", "Inform team"]'),

('ADMIN_SECURITY_PASS', 'Issue Security Pass', 'Create and issue building/floor access pass', 'onboarding', 'security', 'security_admin', 2, 8,
 'Register in security system → Configure access zones → Issue RFID card → Test access',
 '["Register in system", "Set access zones", "Issue RFID card", "Test entry/exit", "Document issuance"]'),

-- Payroll Tasks
('PAYROLL_SETUP', 'Setup Payroll Account', 'Create employee record in payroll system', 'onboarding', 'payroll', 'payroll_admin', 3, 24,
 'Open Payroll module → Add employee → Enter salary structure → Set effective date → Configure tax settings',
 '["Add to payroll system", "Enter CTC breakup", "Set payment mode", "Configure PF/ESIC", "Verify calculations"]'),

('PAYROLL_BANK_ACCOUNT', 'Setup Bank Salary Account', 'Verify and configure bank account for salary transfer', 'onboarding', 'payroll', 'payroll_admin', 2, 48,
 'Collect bank details → Verify with cancelled cheque → Add to salary transfer list → Test with Re. 1',
 '["Collect bank details", "Verify cancelled cheque", "Add to bank file", "Validate account", "Update payroll"]'),

('PAYROLL_PF_ESIC', 'Register for PF/ESIC', 'Register employee with PF and ESIC', 'onboarding', 'payroll', 'payroll_admin', 4, 72,
 'Collect Aadhar/UAN → Upload to PF portal → Generate UAN if new → Add to ESIC → Get acknowledgment',
 '["Collect UAN (if exists)", "Register on PF portal", "Add to ESIC (if salary < 21k)", "Download acknowledgment", "Update HRMS"]'),

-- WFM Tasks
('WFM_ADD_ROSTER', 'Add to WFM Roster', 'Add employee to roster planning system', 'onboarding', 'wfm', 'wfm_admin', 2, 12,
 'Login to WFM → Add employee → Set shift pattern → Assign to process → Set attendance rules',
 '["Add to WFM system", "Set default shift", "Assign to process roster", "Configure attendance rules", "Test roster generation"]'),

('WFM_SHIFT_ASSIGN', 'Assign Shift Schedule', 'Assign initial shift schedule', 'onboarding', 'wfm', 'wfm_admin', 1, 8,
 'Check process requirements → Assign shift → Communicate shift timings to employee → Update roster',
 '["Determine shift based on process", "Assign in roster", "Send shift details to employee", "Configure biometric timing"]'),

-- Training Tasks
('TRAINING_INDUCTION', 'Conduct HR Induction', 'Complete HR induction training', 'onboarding', 'training', 'trainer', 8, 48,
 'Schedule induction session → Cover policies → Explain benefits → Tour facility → Get acknowledgment',
 '["Company overview", "HR policies", "Leave policy", "Code of conduct", "Safety training", "Q&A", "Get acknowledgment signature"]'),

('TRAINING_PROCESS', 'Conduct Process Training', 'Complete process-specific training', 'onboarding', 'training', 'trainer', 40, 120,
 'Schedule training batch → Assign trainer → Complete training modules → Conduct assessment → Certify',
 '["Product knowledge", "Process training", "System training", "Mock calls", "Assessment", "Certification"]'),

-- Asset Tasks
('ASSET_ASSIGN', 'Assign IT Assets', 'Assign laptop, mouse, keyboard, headset, etc.', 'onboarding', 'asset', 'it_asset_manager', 3, 12,
 'Check asset inventory → Assign assets → Update asset register → Get employee acknowledgment → Configure insurance',
 '["Check available inventory", "Assign laptop/desktop", "Assign peripherals", "Get signed acknowledgment", "Update asset management"]')

ON DUPLICATE KEY UPDATE
  task_name = VALUES(task_name),
  task_description = VALUES(task_description),
  task_instructions = VALUES(task_instructions),
  checklist_items = VALUES(checklist_items);

-- ============================================================================
-- 8. SEED DATA - Onboarding templates
-- ============================================================================

INSERT INTO task_template (template_code, template_name, template_type, description, applies_to) VALUES
('GENERAL_ONBOARDING', 'General Employee Onboarding', 'onboarding',
 'Standard onboarding workflow for all employees',
 '{"emp_type": "any", "designation": "any"}'),

('TECH_EMPLOYEE_ONBOARDING', 'Tech Employee Onboarding', 'onboarding',
 'Onboarding for technical roles with additional IT setup',
 '{"emp_type": "OnRoll", "designation": ["Software Engineer", "Tech Lead", "DevOps Engineer"]}'),

('PROCESS_EMPLOYEE_ONBOARDING', 'Process/BPO Employee Onboarding', 'onboarding',
 'Onboarding for process employees with dialer and training focus',
 '{"emp_type": "OnRoll", "process_id": "exists"}')

ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  description = VALUES(description);

-- ============================================================================
-- 9. SEED DATA - General onboarding template items
-- ============================================================================

-- Get template and task IDs for insertion
SET @template_general = (SELECT id FROM task_template WHERE template_code = 'GENERAL_ONBOARDING' LIMIT 1);
SET @task_gen_code = (SELECT id FROM task_master WHERE task_code = 'HR_GEN_EMP_CODE' LIMIT 1);
SET @task_user = (SELECT id FROM task_master WHERE task_code = 'IT_CREATE_USER' LIMIT 1);
SET @task_email = (SELECT id FROM task_master WHERE task_code = 'IT_CREATE_EMAIL' LIMIT 1);
SET @task_biometric = (SELECT id FROM task_master WHERE task_code = 'ADMIN_BIOMETRIC' LIMIT 1);
SET @task_id_card = (SELECT id FROM task_master WHERE task_code = 'ADMIN_ID_CARD' LIMIT 1);
SET @task_locker = (SELECT id FROM task_master WHERE task_code = 'ADMIN_LOCKER' LIMIT 1);
SET @task_laptop = (SELECT id FROM task_master WHERE task_code = 'IT_ASSIGN_LAPTOP' LIMIT 1);
SET @task_payroll = (SELECT id FROM task_master WHERE task_code = 'PAYROLL_SETUP' LIMIT 1);
SET @task_bank = (SELECT id FROM task_master WHERE task_code = 'PAYROLL_BANK_ACCOUNT' LIMIT 1);
SET @task_wfm = (SELECT id FROM task_master WHERE task_code = 'WFM_ADD_ROSTER' LIMIT 1);
SET @task_induction = (SELECT id FROM task_master WHERE task_code = 'TRAINING_INDUCTION' LIMIT 1);
SET @task_manager = (SELECT id FROM task_master WHERE task_code = 'HR_ASSIGN_MANAGER' LIMIT 1);

-- Insert template items with dependencies
INSERT INTO task_template_item (template_id, task_id, sequence_order, dependency_task_ids, parallel_group, mandatory) VALUES
(@template_general, @task_gen_code, 1, NULL, 1, TRUE),
(@template_general, @task_user, 2, JSON_ARRAY(@task_gen_code), 2, TRUE),
(@template_general, @task_biometric, 3, JSON_ARRAY(@task_gen_code), 2, TRUE),
(@template_general, @task_manager, 4, JSON_ARRAY(@task_gen_code), 2, TRUE),
(@template_general, @task_email, 5, JSON_ARRAY(@task_user), 3, TRUE),
(@template_general, @task_id_card, 6, JSON_ARRAY(@task_gen_code, @task_biometric), 3, TRUE),
(@template_general, @task_locker, 7, JSON_ARRAY(@task_biometric), 3, FALSE),
(@template_general, @task_laptop, 8, JSON_ARRAY(@task_user), 3, TRUE),
(@template_general, @task_payroll, 9, JSON_ARRAY(@task_gen_code), 4, TRUE),
(@template_general, @task_bank, 10, JSON_ARRAY(@task_payroll), 5, TRUE),
(@template_general, @task_wfm, 11, JSON_ARRAY(@task_gen_code), 4, TRUE),
(@template_general, @task_induction, 12, JSON_ARRAY(@task_id_card), 6, TRUE)
ON DUPLICATE KEY UPDATE sequence_order = VALUES(sequence_order);

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

SELECT 'Employee Task System tables created successfully' AS status,
       (SELECT COUNT(*) FROM task_master) AS tasks_created,
       (SELECT COUNT(*) FROM task_template) AS templates_created;
