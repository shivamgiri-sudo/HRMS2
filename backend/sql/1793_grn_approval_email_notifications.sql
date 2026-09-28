-- 1793_grn_approval_email_notifications.sql
--
-- Owner directive (2026-09-17): GRN approvals have no email at all today — confirmed live,
-- grn.service.ts/grn-smart.service.ts/grn-validation-control.service.ts only ever raise an
-- in-app bell (grn-notify.ts's notifyGrnStage/resolveGrnNotifications). This adds the email
-- leg for the two handoffs the owner named explicitly: Branch Head is told when a GRN is
-- raised, and Accounts Head is told once the Branch Head approves. A reminder fires if
-- either of those two stages sits unactioned for 24h. The third handoff (Accounts Head ->
-- Finance Head) is deliberately NOT wired here — not asked for, and left as a clean follow-on
-- once these two are proven live. See backend/src/modules/finance/grn.notifications.ts for
-- the producers and backend/src/workers/grn-approval-reminder.worker.ts for the reminder.
--
-- Three events:
--   grn_submitted            — To: branch_head (branch-scoped selector, context carries branch_id)
--   grn_accounts_head_pending — To: role_scope(accounts_head), scope 'all' (only 2 holders,
--                                centralized, not per-branch — confirmed live)
--   grn_approval_overdue      — recipient resolved dynamically per stage via specOverride in
--                                the producer (branch_head or accounts_head, whichever is
--                                actually pending) — recipient_spec below is a structurally
--                                required placeholder never actually used at send time.
--
-- Templates use the same branded shape as PAYSLIP_READY/REGULARIZATION_APPROVED (migration
-- 1034/1027): gradient header, key/value table with every field the owner asked for (Branch,
-- Amount, Head/Sub-head, Date, Remarks), one CTA button.
--
-- sensitivity='conf' (not 'fin'): these are addressed to a ROLE (branch_head/accounts_head),
-- not to a specific employee about their own compensation — same reasoning already applied
-- to payroll_run_approved and bank_exception_invalid_assigned in this catalogue.
--
-- Backlog note (see grn-approval-reminder.worker.ts's own header for the full reasoning):
-- 21 GRNs are already sitting at 'submitted' and 141 at 'branch_head_approved' today. Blasting
-- reminders about all 162 the moment this ships would land on exactly 2 Accounts Head inboxes
-- and could read as a system malfunction. The reminder worker's own ROLLOUT_AT constant is
-- what actually excludes that backlog (a code-level "backfill floor", the same shape
-- provisioning_overdue's DB column achieves) — grn_submitted/grn_accounts_head_pending
-- themselves have no such floor and fire immediately for every NEW submission/approval from
-- today onward, which is the actual ask.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. notification_event_config
-- ---------------------------------------------------------------------------
INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'grn_submitted', 'finance', 'GRN submitted for approval',
  'A GRN has been raised and needs Branch Head approval.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'branch_head'))),
  100, 1000, 1440, 'GRN_SUBMITTED'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'grn_submitted');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'grn_accounts_head_pending', 'finance', 'GRN approved by Branch Head',
  'Branch Head has approved a GRN; it now needs Accounts Head review.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'role_scope', 'roleKeys', JSON_ARRAY('accounts_head'), 'scope', JSON_OBJECT('type', 'all'), 'limit', 10))),
  100, 1000, 1440, 'GRN_ACCOUNTS_HEAD_PENDING'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'grn_accounts_head_pending');

INSERT INTO notification_event_config
  (id, event_code, module, display_name, description, enabled, dispatch_mode, channels,
   is_critical, sensitivity, recipient_spec, max_per_run, max_per_day, cooldown_minutes, template_key)
SELECT UUID(), 'grn_approval_overdue', 'finance', 'GRN approval reminder',
  'A GRN has sat unactioned at its current approval stage for 24+ hours. Recipient (Branch Head or Accounts Head) is resolved dynamically per stage at send time.',
  1, 'live', 'email', 1, 'conf',
  JSON_OBJECT('to', JSON_ARRAY(JSON_OBJECT('kind', 'branch_head'))),
  100, 1000, 1440, 'GRN_APPROVAL_OVERDUE'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notification_event_config WHERE event_code = 'grn_approval_overdue');

-- ---------------------------------------------------------------------------
-- 2. communication_template — three branded HTML templates
-- ---------------------------------------------------------------------------
INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'GRN_SUBMITTED',
  'New GRN awaiting your approval — {{branch_name}} ({{grn_reference}})',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#1B6AB5,#0d4d87);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#cfe3f7;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Finance · GRN</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="font-size:16px;font-weight:700;margin:0 0 14px">A new GRN needs your approval.</p>',
  '<table style="border-collapse:collapse;width:100%;margin-bottom:16px">',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">GRN Reference</td><td style="padding:4px 0;font-size:13px"><strong>{{grn_reference}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Branch</td><td style="padding:4px 0;font-size:13px"><strong>{{branch_name}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Amount</td><td style="padding:4px 0;font-size:13px"><strong>{{amount}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Head</td><td style="padding:4px 0;font-size:13px">{{head}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Sub-head</td><td style="padding:4px 0;font-size:13px">{{sub_head}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Bill Date</td><td style="padding:4px 0;font-size:13px">{{bill_date}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Vendor</td><td style="padding:4px 0;font-size:13px">{{vendor_name}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Raised by</td><td style="padding:4px 0;font-size:13px">{{raised_by}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;vertical-align:top">Remarks</td><td style="padding:4px 0;font-size:13px">{{remarks}}</td></tr>',
  '</table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Review &amp; Approve in HRMS</a>',
  '<p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">You are receiving this as the Branch Head for {{branch_name}}. Confidential — internal finance approval workflow.</p>',
  '</div></div>'),
  'A new GRN needs your approval.\nReference: {{grn_reference}} | Branch: {{branch_name}} | Amount: {{amount}} | Head: {{head}} | Sub-head: {{sub_head}} | Bill Date: {{bill_date}} | Vendor: {{vendor_name}} | Raised by: {{raised_by}}\nRemarks: {{remarks}}\nReview & approve: {{action_url}}',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'GRN_SUBMITTED');

INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'GRN_ACCOUNTS_HEAD_PENDING',
  'GRN approved by Branch Head — awaiting Accounts Head review — {{branch_name}} ({{grn_reference}})',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#0f766e,#0d5c53);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#bff0e8;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Finance · GRN</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="font-size:16px;font-weight:700;margin:0 0 14px">Branch Head has approved this GRN. It now needs your review.</p>',
  '<table style="border-collapse:collapse;width:100%;margin-bottom:16px">',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">GRN Reference</td><td style="padding:4px 0;font-size:13px"><strong>{{grn_reference}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Branch</td><td style="padding:4px 0;font-size:13px"><strong>{{branch_name}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Amount</td><td style="padding:4px 0;font-size:13px"><strong>{{amount}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Head</td><td style="padding:4px 0;font-size:13px">{{head}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Sub-head</td><td style="padding:4px 0;font-size:13px">{{sub_head}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Bill Date</td><td style="padding:4px 0;font-size:13px">{{bill_date}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Vendor</td><td style="padding:4px 0;font-size:13px">{{vendor_name}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;vertical-align:top">Remarks</td><td style="padding:4px 0;font-size:13px">{{remarks}}</td></tr>',
  '</table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Review &amp; Approve in HRMS</a>',
  '<p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">You are receiving this as Accounts Head. Confidential — internal finance approval workflow.</p>',
  '</div></div>'),
  'Branch Head has approved this GRN. It now needs your review.\nReference: {{grn_reference}} | Branch: {{branch_name}} | Amount: {{amount}} | Head: {{head}} | Sub-head: {{sub_head}} | Bill Date: {{bill_date}} | Vendor: {{vendor_name}}\nRemarks: {{remarks}}\nReview & approve: {{action_url}}',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'GRN_ACCOUNTS_HEAD_PENDING');

INSERT INTO communication_template
  (id, name, subject, body_html, body_text, category, channel, is_active, is_critical)
SELECT UUID(), 'GRN_APPROVAL_OVERDUE',
  'Reminder: GRN {{grn_reference}} awaiting your {{pending_stage}} approval',
  CONCAT(
  '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:580px;color:#111827">',
  '<div style="background:linear-gradient(135deg,#b45309,#92400e);padding:16px 20px;border-radius:12px 12px 0 0"><span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span><span style="float:right;color:#fde3c0;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Finance · GRN Reminder</span></div>',
  '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
  '<p style="background:#fff7ed;border-radius:8px;padding:10px 14px;font-size:13px;color:#9a3412;margin:0 0 14px">This GRN has been awaiting your <strong>{{pending_stage}}</strong> approval for over 24 hours.</p>',
  '<table style="border-collapse:collapse;width:100%;margin-bottom:16px">',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">GRN Reference</td><td style="padding:4px 0;font-size:13px"><strong>{{grn_reference}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Branch</td><td style="padding:4px 0;font-size:13px"><strong>{{branch_name}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Amount</td><td style="padding:4px 0;font-size:13px"><strong>{{amount}}</strong></td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Head</td><td style="padding:4px 0;font-size:13px">{{head}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Sub-head</td><td style="padding:4px 0;font-size:13px">{{sub_head}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Bill Date</td><td style="padding:4px 0;font-size:13px">{{bill_date}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px">Vendor</td><td style="padding:4px 0;font-size:13px">{{vendor_name}}</td></tr>',
  '<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;vertical-align:top">Remarks</td><td style="padding:4px 0;font-size:13px">{{remarks}}</td></tr>',
  '</table>',
  '<a href="{{action_url}}" style="display:inline-block;background:#b45309;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Review &amp; Approve Now</a>',
  '<p style="font-size:11px;color:#9ca3af;margin:16px 0 0;border-top:1px solid #f3f4f6;padding-top:10px">Automated reminder — this GRN cannot proceed until its current stage is actioned.</p>',
  '</div></div>'),
  'REMINDER: This GRN has been awaiting your {{pending_stage}} approval for over 24 hours.\nReference: {{grn_reference}} | Branch: {{branch_name}} | Amount: {{amount}} | Head: {{head}} | Sub-head: {{sub_head}} | Bill Date: {{bill_date}} | Vendor: {{vendor_name}}\nRemarks: {{remarks}}\nReview & approve: {{action_url}}',
  'alerts', 'email', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'GRN_APPROVAL_OVERDUE');

-- ---------------------------------------------------------------------------
-- 3. grn_request — reminder tracking columns (guarded PREPARE/EXECUTE: this MySQL 8
--    rejects "ADD COLUMN IF NOT EXISTS" as MariaDB-only syntax with ER_PARSE_ERROR —
--    see 1760_exit_absconding_since.sql's own note on the exact same trap)
-- ---------------------------------------------------------------------------
SET @has_reminder_count = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND COLUMN_NAME = 'reminder_count'
);
SET @sql = IF(@has_reminder_count = 0,
  "ALTER TABLE grn_request ADD COLUMN reminder_count INT NOT NULL DEFAULT 0 COMMENT 'How many overdue-approval reminders have been sent for the GRN''s current stage'",
  "SELECT 'grn_request.reminder_count already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_last_reminder_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'grn_request' AND COLUMN_NAME = 'last_reminder_at'
);
SET @sql = IF(@has_last_reminder_at = 0,
  "ALTER TABLE grn_request ADD COLUMN last_reminder_at DATETIME NULL COMMENT 'When the last overdue-approval reminder was sent for the current stage'",
  "SELECT 'grn_request.last_reminder_at already exists' AS note"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 4. worker_config — grn-approval-reminder
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO worker_config (worker_name, enabled, description)
VALUES (
  'grn-approval-reminder',
  1,
  'Reminds whoever currently holds a GRN (Branch Head at submitted, Accounts Head at branch_head_approved) after 24h with no decision. Its own ROLLOUT_AT constant (see the worker source) excludes GRNs already in the backlog when this shipped (21 at submitted, 141 at branch_head_approved on 2026-09-17) so turning this on does not blast two Accounts Head inboxes with 141 reminders at once — only GRNs entering a pending stage after rollout are ever reminded. Set enabled=0 to stop reminders.'
);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT event_code, enabled, dispatch_mode FROM notification_event_config WHERE event_code LIKE 'grn_%';
--   -- expect 3 rows, all enabled=1, dispatch_mode='live'
-- SELECT name FROM communication_template WHERE name LIKE 'GRN_%';
--   -- expect 3 rows
-- SHOW COLUMNS FROM grn_request LIKE 'reminder_count';
-- SHOW COLUMNS FROM grn_request LIKE 'last_reminder_at';
-- SELECT worker_name, enabled FROM worker_config WHERE worker_name = 'grn-approval-reminder';
