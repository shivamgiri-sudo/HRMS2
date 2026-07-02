-- Migration 272: Employee Reactivation Workflow
-- Adds reactivation request table, employee columns, and notification templates
-- Additive only — no existing tables or columns removed

-- New table: employee_reactivation_request
CREATE TABLE IF NOT EXISTS employee_reactivation_request (
  id                      CHAR(36)       NOT NULL PRIMARY KEY,
  employee_id             CHAR(36)       NOT NULL,
  initiated_by            CHAR(36)       NOT NULL,
  exit_request_id         CHAR(36)       NULL,
  old_employment_status   VARCHAR(50)    NOT NULL,
  proposed_joining_date   DATE           NOT NULL,
  new_branch_id           CHAR(36)       NULL,
  new_process_id          CHAR(36)       NULL,
  new_cost_centre_id      CHAR(36)       NULL,
  reinstatement_reason    TEXT           NOT NULL,
  gap_days                INT            NOT NULL DEFAULT 0,
  same_cost_centre        TINYINT(1)     NOT NULL DEFAULT 0,
  status                  ENUM('pending','branch_head_approved','approved','rejected','cancelled')
                                         NOT NULL DEFAULT 'pending',
  branch_head_user_id     CHAR(36)       NULL,
  branch_head_remarks     TEXT           NULL,
  branch_head_actioned_at DATETIME       NULL,
  payroll_notified_at     DATETIME       NULL,
  hr_final_actioned_by    CHAR(36)       NULL,
  hr_final_remarks        TEXT           NULL,
  hr_final_actioned_at    DATETIME       NULL,
  approval_request_id     CHAR(36)       NULL,
  ff_already_paid         TINYINT(1)     NOT NULL DEFAULT 0,
  created_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rerq_employee     FOREIGN KEY (employee_id)  REFERENCES employees(id),
  CONSTRAINT fk_rerq_initiated_by FOREIGN KEY (initiated_by) REFERENCES auth_user(id),
  INDEX idx_rerq_employee  (employee_id),
  INDEX idx_rerq_status    (status),
  INDEX idx_rerq_created   (created_at)
);

-- Add reactivation columns to employees table (idempotent via information_schema)
SET @db = DATABASE();

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'rehire_eligible') = 0,
  'ALTER TABLE employees ADD COLUMN rehire_eligible TINYINT(1) NULL DEFAULT NULL AFTER date_of_exit',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'previous_exit_date') = 0,
  'ALTER TABLE employees ADD COLUMN previous_exit_date DATE NULL DEFAULT NULL AFTER rehire_eligible',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employees' AND COLUMN_NAME = 'reactivation_count') = 0,
  'ALTER TABLE employees ADD COLUMN reactivation_count INT NOT NULL DEFAULT 0 AFTER previous_exit_date',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed notification templates (INSERT IGNORE avoids duplicate key on re-run)
INSERT IGNORE INTO notification_template
  (id, template_code, template_name, trigger_event, audience, channel, subject, body_template)
VALUES
  (UUID(), 'REACTIVATION_INITIATED', 'Reactivation Request Initiated', 'reactivation_initiated', 'branch_head', 'email',
    'Action Required: Employee Reactivation Request — {{employee_name}}',
    'Dear {{branch_head_name}},<br>A reactivation request has been raised for <b>{{employee_name}} ({{employee_code}})</b> who was {{exit_sub_type}} on {{date_of_exit}}.<br>Proposed rejoining date: <b>{{proposed_joining_date}}</b>.<br>Reason: {{reinstatement_reason}}<br><br>Please log in to review and approve/reject this request.<br><br>Regards,<br>MCN HR Team'),

  (UUID(), 'REACTIVATION_BRANCH_APPROVED', 'Reactivation Approved by Branch Head', 'reactivation_branch_approved', 'hr', 'email',
    'Reactivation Approved: {{employee_name}} — Pending HR Final Action',
    'Dear HR Team,<br>Branch Head has approved the reactivation of <b>{{employee_name}} ({{employee_code}})</b>.<br>Proposed joining date: <b>{{proposed_joining_date}}</b>.<br>Remarks: {{branch_head_remarks}}<br><br>Please take final action in the HRMS portal.<br><br>Regards,<br>MCN HR Team'),

  (UUID(), 'REACTIVATION_PAYROLL_NOTIFY', 'Reactivation Notification to Payroll', 'reactivation_payroll_notify', 'payroll_head', 'email',
    'FYI: Employee Reactivation — {{employee_name}}',
    'Dear Payroll Team,<br>For your information: <b>{{employee_name}} ({{employee_code}})</b> is being reactivated with proposed joining date <b>{{proposed_joining_date}}</b>.<br>Days since exit: <b>{{gap_days}} days</b>. Cost centre: <b>{{cost_centre_name}}</b>.<br><br>No action required from you at this stage. You will receive another notification once HR finalises the reactivation.<br><br>Regards,<br>MCN HR Team'),

  (UUID(), 'REACTIVATION_FINALISED', 'Employee Reactivated', 'reactivation_finalised', 'hr+payroll_head+employee', 'email',
    'Employee Reactivated: {{employee_name}} is now active',
    'Dear {{recipient_name}},<br><b>{{employee_name}} ({{employee_code}})</b> has been reactivated effective <b>{{proposed_joining_date}}</b>.<br>Branch: {{branch_name}} | Cost Centre: {{cost_centre_name}}<br>Reactivation count: {{reactivation_count}}<br><br>Regards,<br>MCN HR Team'),

  (UUID(), 'REACTIVATION_REJECTED', 'Reactivation Request Rejected', 'reactivation_rejected', 'hr+employee', 'email',
    'Reactivation Request Rejected — {{employee_name}}',
    'Dear {{recipient_name}},<br>The reactivation request for <b>{{employee_name}} ({{employee_code}})</b> has been rejected.<br>Rejected by: {{rejected_by_role}}<br>Remarks: {{rejection_remarks}}<br><br>Regards,<br>MCN HR Team');
