-- 1034_missing_notification_templates.sql
--
-- Writes the six templates that events NAME but that do not exist.
--
-- THE PROBLEM
-- notification_event_config.template_key is a free-text column with no foreign key, so an
-- event can name a template that was never written. Six do:
--     attendance_absent        -> ABSENT_ALERT
--     attendance_late          -> LATE_ARRIVAL
--     payslip_ready            -> PAYSLIP_READY             [fin]
--     regularization_decision  -> REGULARIZATION_APPROVED
--     salary_credited          -> SALARY_CREDITED           [fin]
--     weekoff_waitlisted       -> WEEKOFF_WAITLISTED
--
-- Nothing is broken TODAY because all six are enabled=0. But notification.deliverer.ts:88
-- falls back to a generated key/value dump when a named template is missing, and only warns
-- to console. So the failure mode is: someone flips the event live, mail goes out, and it is
-- an unbranded table of raw field names — including for the two financial events. The
-- fallback is correct behaviour (a missing template must not suppress an escalation) but it
-- is not something to send to 1,152 people.
--
-- IDEMPOTENCY — read before editing
-- communication_template has NO unique key on `name` (production already holds TWO rows
-- called 'E2E Test Template', which is also why renderTemplate's pick between duplicates is
-- arbitrary). So `ON DUPLICATE KEY UPDATE` would be dead code here, exactly as it was in the
-- LMS snapshot tables (see 1030). Each INSERT is therefore guarded by NOT EXISTS, which is
-- what actually makes re-running this file safe.
--
-- Body follows NOTIFICATION_CATALOGUE.md section 6: brand bar, headline, fact block,
-- analytics strip, single action, "why you got this", footer. Sections are omitted, never
-- reordered. Styles are inline because email clients discard <style> blocks.
--
-- payslip_ready deliberately carries NO attachment and links into HRMS instead. The payslip
-- generator is browser-only jsPDF (src/lib/masCallnetPayslipGeneratorV2.ts) with no
-- server-side port, and a link avoids emailing salary figures outright.
--
-- ADDITIVE. Rollback is the DELETE at the foot of this file.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. ABSENT_ALERT — attendance_absent [int]
-- ---------------------------------------------------------------------------
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical, created_at, updated_at)
SELECT UUID(), 'ABSENT_ALERT',
  'You are marked absent on {{date}}',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#B45309,#92400e);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#fde68a;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Attendance</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="font-size:16px;font-weight:700;margin:0 0 14px">You are marked absent on {{date}}.</p>',
  '<table style="border-collapse:collapse;margin-bottom:16px">',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Employee</td><td style="padding:3px 0;font-size:13px"><strong>{{employee_name}}</strong> <span style="font-family:monospace;color:#6b7280">{{employee_code}}</span></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Date</td><td style="padding:3px 0;font-size:13px"><strong>{{date}}</strong></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Shift</td><td style="padding:3px 0;font-size:13px">{{shift_name}}</td></tr></table>',
  '<table style="border-collapse:separate;border-spacing:8px 0;margin-bottom:18px"><tr>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{unmarked_days_mtd}}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Unmarked this month</div></td>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{attendance_pct_mtd}}%</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Attendance MTD</div></td>',
  '<td style="background:#fef3c7;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{lop_days_mtd}}</div><div style="font-size:10px;color:#92400e;text-transform:uppercase;letter-spacing:.1em">LOP days so far</div></td>',
  '</tr></table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Raise a regularisation</a>',
  '<p style="font-size:12px;color:#6b7280;margin:16px 0 0">If you were present, raise a regularisation before {{regularization_deadline}} so this does not become loss of pay.</p>',
  '<p style="font-size:11px;color:#9ca3af;margin:14px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">You are receiving this because you are marked absent on this date. Confidential — intended only for the named employee.</p>',
  '</div></div>'),
  'You are marked absent on {{date}} ({{shift_name}}). Unmarked this month: {{unmarked_days_mtd}}. Attendance MTD: {{attendance_pct_mtd}}%. LOP so far: {{lop_days_mtd}}. Raise a regularisation before {{regularization_deadline}}: {{action_url}}',
  'attendance', 'email', 1, 0, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'ABSENT_ALERT');

-- ---------------------------------------------------------------------------
-- 2. LATE_ARRIVAL — attendance_late [int]
-- ---------------------------------------------------------------------------
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical, created_at, updated_at)
SELECT UUID(), 'LATE_ARRIVAL',
  'Late arrival recorded on {{date}}',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#B45309,#92400e);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#fde68a;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Attendance</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="font-size:16px;font-weight:700;margin:0 0 14px">A late arrival was recorded on {{date}}.</p>',
  '<table style="border-collapse:collapse;margin-bottom:16px">',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Employee</td><td style="padding:3px 0;font-size:13px"><strong>{{employee_name}}</strong> <span style="font-family:monospace;color:#6b7280">{{employee_code}}</span></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Shift start</td><td style="padding:3px 0;font-size:13px">{{shift_start}}</td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Punched in</td><td style="padding:3px 0;font-size:13px"><strong>{{punch_in}}</strong></td></tr></table>',
  '<table style="border-collapse:separate;border-spacing:8px 0;margin-bottom:18px"><tr>',
  '<td style="background:#fef3c7;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{late_minutes}}</div><div style="font-size:10px;color:#92400e;text-transform:uppercase;letter-spacing:.1em">Minutes late</div></td>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{late_count_mtd}}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Late this month</div></td>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{avg_late_minutes_mtd}}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Avg delay (min)</div></td>',
  '</tr></table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">View attendance</a>',
  '<p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">You are receiving this because a late punch was recorded against your attendance. Confidential — intended only for the named employee.</p>',
  '</div></div>'),
  'Late arrival on {{date}}. Shift start {{shift_start}}, punched in {{punch_in}} ({{late_minutes}} min late). Late this month: {{late_count_mtd}}, average delay {{avg_late_minutes_mtd}} min. {{action_url}}',
  'attendance', 'email', 1, 0, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'LATE_ARRIVAL');

-- ---------------------------------------------------------------------------
-- 3. REGULARIZATION_APPROVED — regularization_decision [int]
--    Covers both outcomes; {{decision}} carries approved/rejected. The template key is
--    historically named ..._APPROVED, which is why the copy never assumes approval.
-- ---------------------------------------------------------------------------
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical, created_at, updated_at)
SELECT UUID(), 'REGULARIZATION_APPROVED',
  'Your regularisation for {{date}} was {{decision}}',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#1B6AB5,#0d4d87);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#cfe3f7;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Attendance</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="font-size:16px;font-weight:700;margin:0 0 14px">Your regularisation for {{date}} was <strong>{{decision}}</strong>.</p>',
  '<table style="border-collapse:collapse;margin-bottom:16px">',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Employee</td><td style="padding:3px 0;font-size:13px"><strong>{{employee_name}}</strong> <span style="font-family:monospace;color:#6b7280">{{employee_code}}</span></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Date</td><td style="padding:3px 0;font-size:13px"><strong>{{date}}</strong></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Reviewed by</td><td style="padding:3px 0;font-size:13px">{{reviewer_name}}</td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Remarks</td><td style="padding:3px 0;font-size:13px">{{remarks}}</td></tr></table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">View attendance</a>',
  '<p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">You are receiving this because you raised this regularisation. Confidential — intended only for the named employee.</p>',
  '</div></div>'),
  'Your regularisation for {{date}} was {{decision}}. Reviewed by {{reviewer_name}}. Remarks: {{remarks}}. {{action_url}}',
  'attendance', 'email', 1, 0, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'REGULARIZATION_APPROVED');

-- ---------------------------------------------------------------------------
-- 4. WEEKOFF_WAITLISTED — weekoff_waitlisted [int]
-- ---------------------------------------------------------------------------
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical, created_at, updated_at)
SELECT UUID(), 'WEEKOFF_WAITLISTED',
  'Your week-off request for {{requested_date}} is waitlisted',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#1B6AB5,#0d4d87);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#cfe3f7;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Roster</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="font-size:16px;font-weight:700;margin:0 0 14px">Your week-off request for {{requested_date}} is waitlisted.</p>',
  '<p style="font-size:13px;color:#374151;margin:0 0 14px">The day has reached its week-off cap for {{branch_name}}. You will be told automatically if a slot frees up.</p>',
  '<table style="border-collapse:separate;border-spacing:8px 0;margin-bottom:18px"><tr>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{queue_position}}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Your position</div></td>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{slots_available}}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Slots that day</div></td>',
  '</tr></table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">View your roster</a>',
  '<p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">You are receiving this because you requested this week-off. Confidential — intended only for the named employee.</p>',
  '</div></div>'),
  'Your week-off request for {{requested_date}} is waitlisted ({{branch_name}}). Position {{queue_position}}, {{slots_available}} slots that day. {{action_url}}',
  'attendance', 'email', 1, 0, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'WEEKOFF_WAITLISTED');

-- ---------------------------------------------------------------------------
-- 5. PAYSLIP_READY — payslip_ready [fin]
--    NO attachment: links into HRMS instead. NEVER CC'd — the resolver throws FIN_HAS_CC
--    if a spec tries, so the copy can safely address the employee directly.
-- ---------------------------------------------------------------------------
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical, created_at, updated_at)
SELECT UUID(), 'PAYSLIP_READY',
  'Your payslip for {{month}} is ready',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#065F46,#047857);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#a7f3d0;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Payroll</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="font-size:16px;font-weight:700;margin:0 0 14px">Your payslip for {{month}} is ready.</p>',
  '<table style="border-collapse:collapse;margin-bottom:16px">',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Employee</td><td style="padding:3px 0;font-size:13px"><strong>{{employee_name}}</strong> <span style="font-family:monospace;color:#6b7280">{{employee_code}}</span></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Period</td><td style="padding:3px 0;font-size:13px"><strong>{{month}}</strong></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Paid days</td><td style="padding:3px 0;font-size:13px">{{paid_days}}</td></tr></table>',
  '<table style="border-collapse:separate;border-spacing:8px 0;margin-bottom:18px"><tr>',
  '<td style="background:#ecfdf5;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800;font-family:monospace">{{net_pay}}</div><div style="font-size:10px;color:#065f46;text-transform:uppercase;letter-spacing:.1em">Net pay</div></td>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800">{{lop_days}}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">LOP days</div></td>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800;font-family:monospace">{{ytd_gross}}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">YTD gross</div></td>',
  '</tr></table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">View and download payslip</a>',
  '<p style="font-size:12px;color:#6b7280;margin:16px 0 0">The payslip is not attached to this email. Sign in to HRMS to view or download it.</p>',
  '<p style="font-size:11px;color:#9ca3af;margin:14px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">Sent to your official address only, and copied to no one. This message contains salary information — intended solely for the named employee. If you received it in error, delete it and tell HR.</p>',
  '</div></div>'),
  'Your payslip for {{month}} is ready. Net pay {{net_pay}}, LOP {{lop_days}} day(s), paid days {{paid_days}}, YTD gross {{ytd_gross}}. The payslip is not attached — view it in HRMS: {{action_url}}',
  'payroll', 'email', 1, 1, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'PAYSLIP_READY');

-- ---------------------------------------------------------------------------
-- 6. SALARY_CREDITED — salary_credited [fin]
--    Bank account is shown masked to last 4 only. Never the full number.
-- ---------------------------------------------------------------------------
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical, created_at, updated_at)
SELECT UUID(), 'SALARY_CREDITED',
  'Salary for {{month}} has been credited',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#065F46,#047857);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#a7f3d0;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Payroll</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="font-size:16px;font-weight:700;margin:0 0 14px">Your salary for {{month}} has been credited.</p>',
  '<table style="border-collapse:collapse;margin-bottom:16px">',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Employee</td><td style="padding:3px 0;font-size:13px"><strong>{{employee_name}}</strong> <span style="font-family:monospace;color:#6b7280">{{employee_code}}</span></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Credited on</td><td style="padding:3px 0;font-size:13px"><strong>{{credited_on}}</strong></td></tr>',
  '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Account</td><td style="padding:3px 0;font-size:13px;font-family:monospace">****{{account_last4}}</td></tr></table>',
  '<table style="border-collapse:separate;border-spacing:8px 0;margin-bottom:18px"><tr>',
  '<td style="background:#ecfdf5;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800;font-family:monospace">{{net_pay}}</div><div style="font-size:10px;color:#065f46;text-transform:uppercase;letter-spacing:.1em">Amount credited</div></td>',
  '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center"><div style="font-size:19px;font-weight:800;font-family:monospace">{{ytd_net}}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">YTD net</div></td>',
  '</tr></table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">View payslip</a>',
  '<p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">Sent to your official address only, and copied to no one. This message contains salary information — intended solely for the named employee. If the amount looks wrong, contact Payroll before raising a dispute.</p>',
  '</div></div>'),
  'Salary for {{month}} credited on {{credited_on}} to account ****{{account_last4}}. Amount {{net_pay}}. YTD net {{ytd_net}}. {{action_url}}',
  'payroll', 'email', 1, 1, NOW(), NOW()
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'SALARY_CREDITED');

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Every event that names a template must now find one. Expect ZERO rows:
--   SELECT c.event_code, c.template_key
--     FROM notification_event_config c
--    WHERE c.template_key IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM communication_template t WHERE t.name = c.template_key);
--
-- And no accidental duplicates from a re-run (expect 1 each):
--   SELECT name, COUNT(*) FROM communication_template
--    WHERE name IN ('ABSENT_ALERT','LATE_ARRIVAL','REGULARIZATION_APPROVED',
--                   'WEEKOFF_WAITLISTED','PAYSLIP_READY','SALARY_CREDITED')
--    GROUP BY name;
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- DELETE FROM communication_template
--  WHERE name IN ('ABSENT_ALERT','LATE_ARRIVAL','REGULARIZATION_APPROVED',
--                 'WEEKOFF_WAITLISTED','PAYSLIP_READY','SALARY_CREDITED');
