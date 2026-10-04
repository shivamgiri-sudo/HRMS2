-- Rejoin v3 notifications, reminders and escalation (plan 3b). Additive and re-runnable.

-- 1. Reminder bookkeeping on the request (employee_reactivation_requests is not a hot table).
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'employee_reactivation_requests' AND COLUMN_NAME = 'reminder_count') = 0,
  'ALTER TABLE employee_reactivation_requests ADD COLUMN reminder_count INT NOT NULL DEFAULT 0, ADD COLUMN last_reminder_at DATETIME NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. Once-only escalation claim: INSERT IGNORE then check affectedRows = 1.
CREATE TABLE IF NOT EXISTS rejoin_request_escalation (
  request_id   CHAR(36) NOT NULL,
  escalated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Worker switch (isWorkerEnabled fails OPEN on a missing row, so seed it explicitly).
INSERT IGNORE INTO worker_config (worker_name, enabled, description)
VALUES ('rejoin-pending-reminder', 1,
  'Nudges the branch head at 48h and 96h on a pending rejoin request and escalates to HR after 5 days. Set enabled=0 to stop.');

-- 4. Notification events. Idempotent: insert only when the event_code is missing.
INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_requested', 'employees', 'Rejoin request raised',
  'HR or a reporting manager asked to bring a former employee back; the branch head must decide.',
  1, 'live', 'email', 0, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'branch_head'))),
  100, 500, 0, 'REJOIN_REQUESTED'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_requested');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_decided', 'employees', 'Rejoin request decided',
  'The branch head approved or rejected a rejoin request. Recipients are set by the producer: the requester, with HR and branch payroll in cc.',
  1, 'live', 'email', 0, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('hr'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 500, 0, 'REJOIN_DECIDED'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_decided');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_pending_reminder', 'employees', 'Rejoin request waiting for the branch head',
  'Reminder to the branch head at 48h and 96h while a rejoin request is still pending.',
  1, 'live', 'email', 0, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'branch_head'))),
  100, 500, 0, 'REJOIN_PENDING_REMINDER'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_pending_reminder');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_pending_escalation', 'employees', 'Rejoin request stuck for 5 days',
  'A rejoin request has waited 5 days for the branch head. Escalated once to HR.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('hr'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 500, 0, 'REJOIN_PENDING_ESCALATION'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_pending_escalation');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_followup_attention', 'employees', 'Rejoin approved, a follow-up step needs attention',
  'The employee is active again but a follow-up (login, LMS, IT provisioning) failed or needs HR.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('hr'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 500, 0, 'REJOIN_FOLLOWUP_ATTENTION'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_followup_attention');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'rejoin_blocked_at_joining', 'employees', 'A former employee was stopped at ATS joining',
  'An ATS candidate matched a former employee by PAN or Aadhaar. The conversion was stopped; HR must raise a rejoin request or decline.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('hr'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 500, 0, 'REJOIN_BLOCKED_AT_JOINING'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'rejoin_blocked_at_joining');

-- 5. Email templates. {{placeholders}} are filled from the producer's `data`.
INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_REQUESTED',
  'Rejoin request for {{employee_name}} ({{employee_code}}) needs your decision',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>{{requester_name}} ({{requester_role}}) has asked to bring back <b>{{employee_name}}</b> ({{employee_code}}), {{branch_name}}.</p>',
    '<p>Proposed rejoin date: <b>{{proposed_joining_date}}</b> (gap {{gap_days}} days). Eligibility: <b>{{eligibility_status}}</b>.</p>',
    '<p>{{review_reasons}}</p><p>Reason given: {{reason}}</p>',
    '<p>Open the request to see the full history of this employee and approve or reject.</p></div>'),
  'Rejoin request for {{employee_name}} ({{employee_code}}), {{branch_name}}. Requested by {{requester_name}} ({{requester_role}}). Proposed date {{proposed_joining_date}}, gap {{gap_days}} days. Eligibility: {{eligibility_status}}. {{review_reasons}} Reason: {{reason}}',
  'alerts', 'email', 1, 0
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_REQUESTED');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_DECIDED',
  'Rejoin {{decision}}: {{employee_name}} ({{employee_code}})',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>The rejoin request for <b>{{employee_name}}</b> ({{employee_code}}), {{branch_name}}, was <b>{{decision}}</b> by the branch head.</p>',
    '<p>Proposed rejoin date: {{proposed_joining_date}}.</p><p>Remarks: {{remarks}}</p></div>'),
  'Rejoin {{decision}} for {{employee_name}} ({{employee_code}}), {{branch_name}}. Proposed date {{proposed_joining_date}}. Remarks: {{remarks}}',
  'alerts', 'email', 1, 0
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_DECIDED');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_PENDING_REMINDER',
  'Reminder {{reminder_no}}: rejoin request for {{employee_name}} is waiting for you',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>The rejoin request for <b>{{employee_name}}</b> ({{employee_code}}), {{branch_name}}, has been waiting {{days_waiting}} days.</p>',
    '<p>Proposed rejoin date: {{proposed_joining_date}}. Please open it and approve or reject.</p></div>'),
  'Reminder {{reminder_no}}: the rejoin request for {{employee_name}} ({{employee_code}}), {{branch_name}}, has waited {{days_waiting}} days. Proposed date {{proposed_joining_date}}.',
  'alerts', 'email', 1, 0
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_PENDING_REMINDER');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_PENDING_ESCALATION',
  'Escalation: rejoin request for {{employee_name}} stuck for {{days_waiting}} days',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>The rejoin request for <b>{{employee_name}}</b> ({{employee_code}}), {{branch_name}}, raised by {{requester_name}}, has had no decision from the branch head for {{days_waiting}} days.</p>',
    '<p>Please follow up with the branch head.</p></div>'),
  'Escalation: the rejoin request for {{employee_name}} ({{employee_code}}), {{branch_name}}, raised by {{requester_name}}, has had no branch head decision for {{days_waiting}} days.',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_PENDING_ESCALATION');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_FOLLOWUP_ATTENTION',
  'Rejoin approved for {{employee_name}} ({{employee_code}}): action needed on {{failed_count}} step(s)',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p><b>{{employee_name}}</b> ({{employee_code}}) is active again, but these follow-up steps need attention:</p>',
    '<p>{{failed_steps}}</p></div>'),
  '{{employee_name}} ({{employee_code}}) is active again, but these follow-up steps need attention: {{failed_steps}}',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_FOLLOWUP_ATTENTION');

INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'REJOIN_BLOCKED_AT_JOINING',
  'ATS joining stopped: {{candidate_name}} is a former employee ({{employee_code}})',
  CONCAT('<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937">',
    '<p>Candidate <b>{{candidate_name}}</b> matched former employee <b>{{employee_name}}</b> ({{employee_code}}, {{employment_status}}) by PAN or Aadhaar. The joining was stopped.</p>',
    '<p>{{outcome_message}}</p></div>'),
  'Candidate {{candidate_name}} matched former employee {{employee_name}} ({{employee_code}}, {{employment_status}}). The joining was stopped. {{outcome_message}}',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REJOIN_BLOCKED_AT_JOINING');
