-- 132_email_sms_notification_system.sql
USE mas_hrms;

-- Email/SMS template catalog
CREATE TABLE IF NOT EXISTS notification_template (
  id                 CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_code      VARCHAR(50)    NOT NULL UNIQUE,
  template_name      VARCHAR(255)   NOT NULL,
  trigger_event      VARCHAR(100)   NOT NULL,
  audience           VARCHAR(100)   NOT NULL COMMENT 'Candidate, Recruiter, HR, Recruiter+HR',
  channel            VARCHAR(50)    NOT NULL DEFAULT 'email' COMMENT 'email, sms, both',
  subject            VARCHAR(500),
  body_template      TEXT           NOT NULL,
  sms_template       VARCHAR(160)   COMMENT 'SMS template (max 160 chars)',
  active_status      TINYINT        NOT NULL DEFAULT 1,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_template_code (template_code),
  INDEX idx_trigger_event (trigger_event),
  INDEX idx_active (active_status)
);

-- Notification log (delivery tracking)
CREATE TABLE IF NOT EXISTS notification_log (
  id                 CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_code      VARCHAR(50)    NOT NULL,
  recipient_type     VARCHAR(50)    NOT NULL COMMENT 'candidate, recruiter, hr',
  recipient_id       CHAR(36)       COMMENT 'employee_id or candidate_id',
  recipient_email    VARCHAR(255),
  recipient_mobile   VARCHAR(20),
  channel            VARCHAR(50)    NOT NULL COMMENT 'email, sms',
  subject            VARCHAR(500),
  body               TEXT,
  status             VARCHAR(50)    NOT NULL DEFAULT 'pending' COMMENT 'pending, sent, failed, bounced',
  error_message      TEXT,
  sent_at            DATETIME,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_template (template_code),
  INDEX idx_recipient (recipient_id),
  INDEX idx_status (status),
  INDEX idx_created (created_at)
);

-- Seed email templates
INSERT INTO notification_template (id, template_code, template_name, trigger_event, audience, channel, subject, body_template, sms_template, active_status)
VALUES
-- REG_CANDIDATE: Candidate registration confirmation
(UUID(), 'REG_CANDIDATE', 'Registration Confirmation', 'candidate_registration', 'Candidate', 'both',
'Registration completed | {{Org_Name}}',
'Dear {{CandidateName}},

Thank you for registering with {{Org_Name}} for the role of {{RoleApplied}} at {{Branch}}.

Your queue token is {{QToken}}.
Assigned recruiter: {{RecruiterName}} ({{RecruiterMobile}}).
Expected assistance time: within 30 minutes.

Please keep your documents ready.

Regards,
{{Org_Name}} Recruitment Team',
'Thank you for registering with {{Org_Name}}. Queue token: {{QToken}}. Recruiter: {{RecruiterName}}. Expected wait: 30 mins.',
1),

-- REG_RECRUITER: New candidate assigned notification
(UUID(), 'REG_RECRUITER', 'New Candidate Assigned', 'candidate_assignment', 'Recruiter+HR', 'email',
'New candidate arrived | {{QToken}} | {{CandidateName}}',
'Candidate has completed registration.

Candidate: {{CandidateName}}
Mobile: {{Mobile}}
Email: {{Email}}
Branch: {{Branch}}
Role: {{RoleApplied}}
Queue Token: {{QToken}}

Update interview status using your mobile app or recruiter workspace.

Regards,
ATS Auto Mailer',
NULL,
1),

-- STAGE_SELECTED: Round cleared notification
(UUID(), 'STAGE_SELECTED', 'Interview Round Cleared', 'stage_selected', 'Candidate', 'both',
'Congratulations! You have cleared {{StageName}}',
'Dear {{CandidateName}},

Congratulations! You have successfully cleared {{StageName}} for the role of {{RoleApplied}} at {{Org_Name}}.

Our team will contact you for the next step shortly.

Regards,
{{Org_Name}} Recruitment Team',
'Congratulations {{CandidateName}}! You cleared {{StageName}} at {{Org_Name}}. Next steps coming soon.',
1),

-- STAGE_REJECTED: Round rejection notification
(UUID(), 'STAGE_REJECTED', 'Application Update', 'stage_rejected', 'Candidate', 'email',
'Update on your application',
'Dear {{CandidateName}},

Thank you for taking the time to participate in our hiring process for {{RoleApplied}}.
After careful review, we will not be moving ahead with your application at this stage.

This decision is specific to the current requirement and we encourage you to apply again for future openings.

We appreciate your interest in {{Org_Name}} and wish you the very best.

Regards,
{{Org_Name}} Recruitment Team',
NULL,
1),

-- FINAL_SELECTED: Final selection with joining details
(UUID(), 'FINAL_SELECTED', 'Congratulations - You are Selected!', 'final_selected', 'Candidate', 'email',
'Congratulations! Next steps for your joining',
'Dear {{CandidateName}},

Congratulations! We are pleased to inform you that you have been selected for the role of {{RoleApplied}} at {{Org_Name}}.

Joining Details:
Date of Joining: {{OfferDOJ}}
Reporting Timing: {{OfferShift}}
Salary Structure: Rs. {{OfferSalary}} per month
Additional perks: Over Time & Performance Incentive

Please complete the following forms before joining:
1. Candidate Confirmation Form: {{CandidateConfirmLink}}
2. BGV Form: https://docs.google.com/forms/d/e/1FAIpQLSfc_laoNsePsSfNit__Bk4EmFOu7Zi4LQ7AwuoqCgTSZjDcGA/viewform
3. Day-1 Document Submission Form: {{Day1DocFormLink}}

Documents to carry on Day-1:
{{Day1Docs}}

Regards,
{{Org_Name}} Recruitment Team',
NULL,
1),

-- SLA_BREACH: Waiting time alert for recruiters
(UUID(), 'SLA_BREACH', 'SLA Alert - Candidate Waiting', 'sla_breach', 'Recruiter+HR', 'both',
'SLA alert | Candidate waiting beyond SLA | {{QToken}}',
'Candidate {{CandidateName}} ({{QToken}}) has been waiting for more than {{SLAMinutes}} minutes.

Recruiter: {{RecruiterName}}
Branch: {{Branch}}
Role: {{RoleApplied}}

Please take action immediately.

Regards,
ATS Auto Alert',
'URGENT: Candidate {{CandidateName}} ({{QToken}}) waiting {{SLAMinutes}} mins. Please attend immediately.',
1)
ON DUPLICATE KEY UPDATE
  template_name = VALUES(template_name),
  trigger_event = VALUES(trigger_event),
  subject = VALUES(subject),
  body_template = VALUES(body_template),
  sms_template = VALUES(sms_template),
  updated_at = CURRENT_TIMESTAMP;

-- SMTP configuration table (for dynamic SMTP settings)
CREATE TABLE IF NOT EXISTS smtp_config (
  id                 INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  config_key         VARCHAR(50)    NOT NULL UNIQUE,
  smtp_host          VARCHAR(255)   NOT NULL,
  smtp_port          INT            NOT NULL DEFAULT 587,
  smtp_secure        TINYINT        NOT NULL DEFAULT 0 COMMENT '0=TLS, 1=SSL',
  smtp_user          VARCHAR(255)   NOT NULL,
  smtp_pass          VARCHAR(500)   NOT NULL,
  from_email         VARCHAR(255)   NOT NULL,
  from_name          VARCHAR(255)   NOT NULL DEFAULT 'MAS Callnet HRMS',
  active_status      TINYINT        NOT NULL DEFAULT 1,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Twilio SMS configuration table
CREATE TABLE IF NOT EXISTS sms_config (
  id                 INT            NOT NULL AUTO_INCREMENT PRIMARY KEY,
  config_key         VARCHAR(50)    NOT NULL UNIQUE,
  provider           VARCHAR(50)    NOT NULL DEFAULT 'twilio' COMMENT 'twilio, msg91, etc',
  account_sid        VARCHAR(255),
  auth_token         VARCHAR(500),
  from_number        VARCHAR(20),
  api_key            VARCHAR(500)   COMMENT 'For MSG91 or other providers',
  active_status      TINYINT        NOT NULL DEFAULT 1,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
