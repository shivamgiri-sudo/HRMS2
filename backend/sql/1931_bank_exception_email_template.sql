-- 1931_bank_exception_email_template.sql
--
-- The bank_exception_invalid_assigned notification event (seeded in 1756) has
-- template_key = NULL, so every email lands as the raw fallback body with the text
-- "This notification has no template configured yet — please report it to HR Systems."
-- This migration:
--   1. Inserts a branded HTML template into communication_template.
--   2. Sets template_key on the event_config row so the deliverer resolves it.
--
-- Recipients: employee + reporting_manager + assigned payroll_hr (per 1756's recipient_spec).
-- Data fields available at send time (bank-exception-auto-assign.service.ts):
--   employee_code, employee_name, branch_name, process_name,
--   reporting_manager_name, readiness_class, reason, assigned_to
--
-- Additive + idempotent: INSERT ... FROM DUAL WHERE NOT EXISTS / UPDATE WHERE template_key IS NULL.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. communication_template
-- ---------------------------------------------------------------------------
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'BANK_EXCEPTION_INVALID_ASSIGNED',
  'Action needed: bank details missing for {{employee_name}} ({{employee_code}})',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#b91c1c,#991b1b);padding:16px 20px;border-radius:12px 12px 0 0">',
  '<span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span>',
  '<span style="float:right;color:#fecaca;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Payroll · Bank Exception</span>',
  '</div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="background:#fef2f2;border-radius:8px;padding:10px 14px;font-size:13px;color:#991b1b;margin:0 0 14px">',
  'A bank record issue has been flagged for <strong>{{employee_name}}</strong>. ',
  'The exception has been assigned to <strong>{{assigned_to}}</strong> for resolution before this employee can be included in salary processing.',
  '</p>',
  '<table style="border-collapse:collapse;width:100%;margin-bottom:16px">',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">Employee</td>',
  '<td style="padding:4px 0;font-size:13px"><strong>{{employee_name}}</strong> ({{employee_code}})</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Branch</td>',
  '<td style="padding:4px 0;font-size:13px"><strong>{{branch_name}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Process</td>',
  '<td style="padding:4px 0;font-size:13px">{{process_name}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Reporting Manager</td>',
  '<td style="padding:4px 0;font-size:13px">{{reporting_manager_name}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Exception Type</td>',
  '<td style="padding:4px 0;font-size:13px"><strong>{{readiness_class}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;vertical-align:top">Reason</td>',
  '<td style="padding:4px 0;font-size:13px">{{reason}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Assigned To</td>',
  '<td style="padding:4px 0;font-size:13px"><strong>{{assigned_to}}</strong></td></tr>',
  '</table>',
  '<p style="font-size:13px;color:#374151;margin:0 0 16px">',
  'Please collect the correct bank details from the employee and update them in HRMS under the employee profile → Bank Details tab. ',
  'The employee cannot receive salary via bank transfer until this is resolved.',
  '</p>',
  '<p style="font-size:11px;color:#9ca3af;margin:0;border-top:1px solid #f3f4f6;padding-top:10px">',
  'Confidential — MAS Callnet PeopleOS payroll exception. Do not forward outside the payroll team.',
  '</p>',
  '</div></div>'),
  'Action needed: bank details missing or invalid for {{employee_name}} ({{employee_code}}).\nBranch: {{branch_name}} | Process: {{process_name}} | Reporting Manager: {{reporting_manager_name}}\nException type: {{readiness_class}}\nReason: {{reason}}\nAssigned to: {{assigned_to}}\nPlease collect and update the bank details in HRMS. The employee cannot receive salary until this is resolved.',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM communication_template WHERE name = 'BANK_EXCEPTION_INVALID_ASSIGNED'
);

-- ---------------------------------------------------------------------------
-- 2. Wire the template_key into the event config
-- ---------------------------------------------------------------------------
UPDATE notification_event_config
   SET template_key = 'BANK_EXCEPTION_INVALID_ASSIGNED',
       updated_at   = NOW()
 WHERE event_code = 'bank_exception_invalid_assigned'
   AND (template_key IS NULL OR template_key = '');

-- Verification:
--   SELECT event_code, template_key FROM notification_event_config
--    WHERE event_code = 'bank_exception_invalid_assigned';
--   -- expect template_key = 'BANK_EXCEPTION_INVALID_ASSIGNED'
--
--   SELECT name, subject, is_active FROM communication_template
--    WHERE name = 'BANK_EXCEPTION_INVALID_ASSIGNED';
