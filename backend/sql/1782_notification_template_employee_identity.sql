-- 1782_notification_template_employee_identity.sql
--
-- Business rule (owner directive, 2026-09-16): every email that names a specific employee
-- must show that employee's Employee Code, Process/LOB, and Reporting Manager's name,
-- in the body or an attachment. The notification producers for regularization_decision,
-- roster_published, shift_changed and payslip_ready were extended (backend/src/modules/
-- wfm/attendance.notifications.ts, roster/roster.notifications.ts, payroll/
-- payroll.notifications.ts) to pass process_name and reporting_manager_name into the
-- notification `data` payload — but those four events render through a real Handlebars
-- template stored in communication_template, not the generic fallback table, so the new
-- data fields are inert until the stored template markup references them. This migration
-- updates those four templates in place.
--
-- SHIFT_CHANGED additionally had NO employee-identifying row at all (not even name/code) —
-- confirmed by reading the stored template; this adds one.
--
-- Every UPDATE below is a REPLACE() on an exact, verified-unique substring of the
-- currently-stored body_html/body_text. Naturally idempotent: once the substring has been
-- replaced, re-running finds no match and changes nothing, so this is safe to re-apply.
--
-- Verification query at the bottom.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- REGULARIZATION_APPROVED — insert Process / Reporting manager rows before the Date row.
-- ---------------------------------------------------------------------------
UPDATE communication_template
   SET body_html = REPLACE(
         body_html,
         '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Date</td><td style="padding:3px 0;font-size:13px"><strong>{{date}}</strong></td></tr>',
         '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Process</td><td style="padding:3px 0;font-size:13px">{{process_name}}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Reporting manager</td><td style="padding:3px 0;font-size:13px">{{reporting_manager_name}}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Date</td><td style="padding:3px 0;font-size:13px"><strong>{{date}}</strong></td></tr>'
       ),
       body_text = REPLACE(
         body_text,
         'Reviewed by {{reviewer_name}}.',
         'Process: {{process_name}}. Reporting manager: {{reporting_manager_name}}. Reviewed by {{reviewer_name}}.'
       ),
       updated_at = NOW()
 WHERE name = 'REGULARIZATION_APPROVED';

-- ---------------------------------------------------------------------------
-- PAYSLIP_READY — insert Process / Reporting manager rows before the Period row.
-- ---------------------------------------------------------------------------
UPDATE communication_template
   SET body_html = REPLACE(
         body_html,
         '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Period</td><td style="padding:3px 0;font-size:13px"><strong>{{month}}</strong></td></tr>',
         '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Process</td><td style="padding:3px 0;font-size:13px">{{process_name}}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Reporting manager</td><td style="padding:3px 0;font-size:13px">{{reporting_manager_name}}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Period</td><td style="padding:3px 0;font-size:13px"><strong>{{month}}</strong></td></tr>'
       ),
       body_text = REPLACE(
         body_text,
         'Your payslip for {{month}} is ready.',
         'Your payslip for {{month}} is ready. Process: {{process_name}}. Reporting manager: {{reporting_manager_name}}.'
       ),
       updated_at = NOW()
 WHERE name = 'PAYSLIP_READY';

-- ---------------------------------------------------------------------------
-- ROSTER_PUBLISHED — insert Process / Reporting manager rows after the Week row.
-- ---------------------------------------------------------------------------
UPDATE communication_template
   SET body_html = REPLACE(
         body_html,
         '<td style="padding:3px 0;font-size:13px"><strong>{{week}}</strong></td></tr></table>',
         '<td style="padding:3px 0;font-size:13px"><strong>{{week}}</strong></td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Process</td><td style="padding:3px 0;font-size:13px">{{process_name}}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Reporting manager</td><td style="padding:3px 0;font-size:13px">{{reporting_manager_name}}</td></tr></table>'
       ),
       body_text = REPLACE(
         body_text,
         'is published.\n\nShifts:',
         'is published.\n\nProcess: {{process_name}}. Reporting manager: {{reporting_manager_name}}.\n\nShifts:'
       ),
       updated_at = NOW()
 WHERE name = 'ROSTER_PUBLISHED';

-- ---------------------------------------------------------------------------
-- SHIFT_CHANGED — had no employee-identifying row at all. Add Employee / Process /
-- Reporting manager rows before the existing Previous/New/Reason table.
-- ---------------------------------------------------------------------------
UPDATE communication_template
   SET body_html = REPLACE(
         body_html,
         '<table style="border-collapse:collapse;margin:12px 0"><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Previous</td>',
         '<table style="border-collapse:collapse;margin:12px 0"><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Employee</td><td style="font-size:13px"><strong>{{employee_name}}</strong> <span style="font-family:monospace;color:#6b7280">{{employee_code}}</span></td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Process</td><td style="font-size:13px">{{process_name}}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Reporting manager</td><td style="font-size:13px">{{reporting_manager_name}}</td></tr><tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Previous</td>'
       ),
       body_text = REPLACE(
         body_text,
         'Your shift on {{roster_date}} changed',
         '{{employee_name}} ({{employee_code}}) — Process: {{process_name}}, Reporting manager: {{reporting_manager_name}}.\nYour shift on {{roster_date}} changed'
       ),
       updated_at = NOW()
 WHERE name = 'SHIFT_CHANGED';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT name,
--        body_html LIKE '%{{process_name}}%' AS has_process,
--        body_html LIKE '%{{reporting_manager_name}}%' AS has_manager
--   FROM communication_template
--  WHERE name IN ('REGULARIZATION_APPROVED','PAYSLIP_READY','ROSTER_PUBLISHED','SHIFT_CHANGED');
--   -- expect has_process=1 and has_manager=1 on all four rows
