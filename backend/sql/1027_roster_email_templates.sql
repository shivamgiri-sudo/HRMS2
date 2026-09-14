-- 1027_roster_email_templates.sql
--
-- Harvests the roster email templates into `communication_template`, the store the
-- notification gateway reads.
--
-- WHY THIS EXISTS
-- sql/224_wfm_notification_templates.sql seeded 12 roster templates into
-- `notification_template` — the LEGACY store, read only by the old
-- services/notification.service.ts path. They have never been dispatched by anything. The
-- notification build standardised on `communication_template` + dispatch.service.ts, so
-- until now `notification_event_config.template_key = 'ROSTER_PUBLISHED'` resolved to
-- nothing and the deliverer fell back to its deliberately-plain body.
--
-- The legacy rows are LEFT IN PLACE and untouched (CLAUDE.md rule 3). This copies the
-- content across and adds the body anatomy from NOTIFICATION_CATALOGUE.md section 3:
-- brand bar, headline, fact block, analytics strip, one action, why-you-got-this, footer.
--
-- Only the 7 templates with real email content are harvested. The other 5 legacy rows are
-- channel='in_app' with no subject and no email body — copying them would create templates
-- that render blank.
--
-- Additive and idempotent (INSERT ... WHERE NOT EXISTS on `name`). Re-running changes
-- nothing and will not overwrite an edit made through the admin UI.
--
-- NOT EXECUTED against production (CLAUDE.md rule 4).
--
-- NOTE ON VARIABLES: these use the names the wiring actually supplies
-- (modules/roster/roster.notifications.ts). `nights` is deliberately allowed to be null —
-- it is omitted rather than shown as 0 when a shift template could not be resolved, so the
-- analytics strip never reports a figure it cannot stand behind.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- ROSTER_PUBLISHED — the one wired to roster.governance.service.ts publish
-- ---------------------------------------------------------------------------
INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_critical, is_active)
SELECT UUID(), 'ROSTER_PUBLISHED',
  'Your roster for the week of {{week_start}} is now available',
  CONCAT(
   '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#111827">',
     '<div style="background:linear-gradient(135deg,#1B6AB5,#0d4d87);padding:16px 20px;border-radius:12px 12px 0 0">',
       '<span style="color:#fff;font-weight:800;letter-spacing:.04em">MAS Callnet</span>',
       '<span style="float:right;color:#cfe3f7;font-size:11px;text-transform:uppercase;letter-spacing:.18em">Roster</span>',
     '</div>',
     '<div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px">',
       '<p style="font-size:16px;font-weight:700;margin:0 0 14px">Your roster for {{week_start}} to {{week_end}} is published.</p>',
       '<table style="border-collapse:collapse;margin-bottom:16px">',
         '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Employee</td>',
             '<td style="padding:3px 0;font-size:13px"><strong>{{employee_name}}</strong> ',
             '<span style="font-family:monospace;color:#6b7280">{{employee_code}}</span></td></tr>',
         '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Week</td>',
             '<td style="padding:3px 0;font-size:13px"><strong>{{week}}</strong></td></tr>',
       '</table>',
       -- analytics strip: every figure computed at send time from roster_daily_assignment
       '<table style="border-collapse:separate;border-spacing:8px 0;margin-bottom:18px">',
         '<tr>',
           '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center">',
             '<div style="font-size:19px;font-weight:800">{{shifts}}</div>',
             '<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Shifts</div></td>',
           '<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center">',
             '<div style="font-size:19px;font-weight:800">{{week_offs}}</div>',
             '<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Week-offs</div></td>',
           '{{#if nights}}<td style="background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center">',
             '<div style="font-size:19px;font-weight:800">{{nights}}</div>',
             '<div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.1em">Nights</div></td>{{/if}}',
           '{{#if ack_deadline}}<td style="background:#fff7ed;border-radius:8px;padding:10px 14px;text-align:center">',
             '<div style="font-size:13px;font-weight:800;color:#9a3412">{{ack_deadline}}</div>',
             '<div style="font-size:10px;color:#9a3412;text-transform:uppercase;letter-spacing:.1em">Acknowledge by</div></td>{{/if}}',
         '</tr>',
       '</table>',
       '<a href="{{portal_url}}/my-roster" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;',
          'padding:10px 20px;border-radius:8px;font-weight:700;font-size:14px">View and acknowledge your roster</a>',
       '<p style="font-size:12px;color:#6b7280;margin:18px 0 0">You are receiving this as the employee rostered for this week.</p>',
     '</div>',
     '<p style="font-size:11px;color:#9ca3af;margin:10px 4px 0">Confidential. Internal use only. ',
       'Manage your notification preferences in the HRMS portal.</p>',
   '</div>'),
  CONCAT('Hi {{employee_name}},\n\nYour roster for the week of {{week_start}} to {{week_end}} is published.\n\n',
         'Shifts: {{shifts}}   Week-offs: {{week_offs}}\n',
         'Please acknowledge by {{ack_deadline}}.\n\nMAS Callnet WFM'),
  'attendance', 'email', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM communication_template WHERE name = 'ROSTER_PUBLISHED');

-- ---------------------------------------------------------------------------
-- The remaining six, harvested with the same shell.
-- Bodies are the legacy copy, reflowed to HTML; subjects are unchanged.
-- ---------------------------------------------------------------------------
INSERT INTO communication_template (id, name, subject, body_html, body_text, category, channel, is_critical, is_active)
SELECT * FROM (
  SELECT UUID() AS id, 'ROSTER_ACK_REMINDER' AS name,
    'Action Required: Acknowledge your roster by {{ack_deadline}}' AS subject,
    CONCAT('<div style="font-family:system-ui,sans-serif;max-width:560px;color:#111827">',
      '<p style="font-size:16px;font-weight:700">Your roster is still awaiting acknowledgement.</p>',
      '<p style="font-size:14px">Hi {{employee_name}}, your roster for the week of {{week_start}} has not been acknowledged yet.</p>',
      '<p style="background:#fff7ed;border-radius:8px;padding:12px;font-size:14px;color:#9a3412">',
        'Please acknowledge before <strong>{{ack_deadline}}</strong>.</p>',
      '<a href="{{portal_url}}/my-roster" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">Acknowledge now</a>',
      '<p style="font-size:12px;color:#6b7280;margin-top:18px">You are receiving this as the employee rostered for this week.</p></div>') AS body_html,
    'Hi {{employee_name}},\n\nYour roster for the week of {{week_start}} is still pending acknowledgement. Please acknowledge before {{ack_deadline}}.' AS body_text,
    'attendance' AS category, 'email' AS channel, 1 AS is_critical, 1 AS is_active
  UNION ALL SELECT UUID(), 'SHIFT_CHANGED',
    'Your shift on {{roster_date}} has been updated',
    CONCAT('<div style="font-family:system-ui,sans-serif;max-width:560px;color:#111827">',
      '<p style="font-size:16px;font-weight:700">Your shift on {{roster_date}} has changed.</p>',
      '<table style="border-collapse:collapse;margin:12px 0">',
      '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Previous</td><td style="font-size:13px">{{from_shift}}</td></tr>',
      '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">New</td><td style="font-size:13px"><strong>{{to_shift}}</strong></td></tr>',
      '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Reason</td><td style="font-size:13px">{{reason}}</td></tr>',
      '<tr><td style="padding:3px 14px 3px 0;color:#6b7280;font-size:13px">Notice given</td><td style="font-size:13px">{{notice_hours}} hours</td></tr>',
      '</table>',
      '<a href="{{portal_url}}/my-roster" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">View roster</a>',
      '<p style="font-size:12px;color:#6b7280;margin-top:18px">You are receiving this as the employee whose shift changed.</p></div>'),
    'Hi {{employee_name}},\n\nYour shift on {{roster_date}} changed from {{from_shift}} to {{to_shift}}.\nReason: {{reason}}\nNotice given: {{notice_hours}} hours.',
    'attendance', 'email', 1, 1
  UNION ALL SELECT UUID(), 'WEEKOFF_APPROVED',
    'Your week-off preference for {{preferred_day_name}} has been approved',
    CONCAT('<div style="font-family:system-ui,sans-serif;max-width:560px;color:#111827">',
      '<p style="font-size:16px;font-weight:700">Your week-off preference is approved.</p>',
      '<p style="font-size:14px">Hi {{employee_name}}, your preference for <strong>{{preferred_day_name}}</strong> has been approved and will appear in your upcoming roster.</p>',
      '<a href="{{portal_url}}/week-off-preferences" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">View preferences</a></div>'),
    'Hi {{employee_name}},\n\nYour week-off preference for {{preferred_day_name}} has been approved.',
    'attendance', 'email', 0, 1
  UNION ALL SELECT UUID(), 'WEEKOFF_DENIED',
    'Your week-off preference for {{preferred_day_name}} could not be accommodated',
    CONCAT('<div style="font-family:system-ui,sans-serif;max-width:560px;color:#111827">',
      '<p style="font-size:16px;font-weight:700">Your week-off preference could not be accommodated.</p>',
      '<p style="font-size:14px">Hi {{employee_name}}, your preference for <strong>{{preferred_day_name}}</strong> could not be approved because of process capacity for that week.</p>',
      '{{#if alternate_day_name}}<p style="background:#f1f5f9;border-radius:8px;padding:12px;font-size:14px">Alternate day assigned: <strong>{{alternate_day_name}}</strong></p>{{/if}}',
      '<a href="{{portal_url}}/week-off-preferences" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">View preferences</a></div>'),
    'Hi {{employee_name}},\n\nYour week-off preference for {{preferred_day_name}} could not be approved due to capacity.',
    'attendance', 'email', 0, 1
  UNION ALL SELECT UUID(), 'ROSTER_DISPUTE_RAISED',
    'Roster dispute raised by {{employee_name}} for {{roster_date}}',
    CONCAT('<div style="font-family:system-ui,sans-serif;max-width:560px;color:#111827">',
      '<p style="font-size:16px;font-weight:700">A roster dispute needs review.</p>',
      '<p style="font-size:14px">{{employee_name}} (<span style="font-family:monospace">{{employee_code}}</span>) disputed their assignment on <strong>{{roster_date}}</strong>.</p>',
      '<p style="background:#fef2f2;border-radius:8px;padding:12px;font-size:14px">{{dispute_reason}}</p>',
      '<a href="{{portal_url}}/wfm/roster" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">Review dispute</a>',
      '<p style="font-size:12px;color:#6b7280;margin-top:18px">You are receiving this as the WFM contact for this branch.</p></div>'),
    '{{employee_name}} ({{employee_code}}) raised a roster dispute for {{roster_date}}.\nReason: {{dispute_reason}}',
    'attendance', 'email', 0, 1
  UNION ALL SELECT UUID(), 'ROSTER_DISPUTE_RESOLVED',
    'Your roster dispute for {{roster_date}} has been resolved',
    CONCAT('<div style="font-family:system-ui,sans-serif;max-width:560px;color:#111827">',
      '<p style="font-size:16px;font-weight:700">Your roster dispute has been resolved.</p>',
      '<p style="font-size:14px">Hi {{employee_name}}, your dispute for <strong>{{roster_date}}</strong> has been reviewed.</p>',
      '<p style="background:#f0fdf4;border-radius:8px;padding:12px;font-size:14px">{{dispute_resolution}}</p>',
      '<a href="{{portal_url}}/my-roster" style="display:inline-block;background:#1B6AB5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:700">View roster</a></div>'),
    'Hi {{employee_name}},\n\nYour roster dispute for {{roster_date}} has been resolved.\nResolution: {{dispute_resolution}}',
    'attendance', 'email', 0, 1
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM communication_template ct WHERE ct.name = seed.name);

-- No UPDATE to notification_event_config is needed: the harvested `name` values are
-- exactly the `template_key` values seeded by migration 1022, and templateService looks a
-- template up by name. The second verification query below is what proves that holds.

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT name, category, channel, is_critical, CHAR_LENGTH(body_html) html_len
--   FROM communication_template WHERE name IN
--   ('ROSTER_PUBLISHED','ROSTER_ACK_REMINDER','SHIFT_CHANGED','WEEKOFF_APPROVED',
--    'WEEKOFF_DENIED','ROSTER_DISPUTE_RAISED','ROSTER_DISPUTE_RESOLVED')
--  ORDER BY name;
--   -- expect 7 rows, every html_len > 400
--
-- Every wfm event whose template_key now resolves:
-- SELECT nec.event_code, nec.template_key, ct.id IS NOT NULL AS template_found
--   FROM notification_event_config nec
--   LEFT JOIN communication_template ct ON ct.name = nec.template_key
--  WHERE nec.module = 'wfm' AND nec.template_key IS NOT NULL;
--   -- template_found MUST be 1 for every row; a 0 means the deliverer falls back to the
--   -- plain body for that event.
--
-- The legacy rows are untouched:
-- SELECT COUNT(*) FROM notification_template WHERE template_code REGEXP 'ROSTER|WEEKOFF|SHIFT';
--   -- still 12
