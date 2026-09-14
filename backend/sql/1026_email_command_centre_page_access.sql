-- 1026_email_command_centre_page_access.sql
--
-- Registers the Email Command Centre page and grants access.
--
-- Follows the pattern of 520_missing_page_codes_seed.sql: INSERT IGNORE only, no drops,
-- no alters, safe to re-run.
--
-- Access is intentionally narrow. The page can reveal who receives payroll and escalation
-- mail, and its Recipients tab resolves real people against real events. `hr` is granted
-- view+export but NOT the ability to flip an event live — that stays with admin and
-- super_admin, because switching an event from shadow to live starts sending to real
-- inboxes immediately.
--
-- Route gating is cosmetic; the real guard is requireRole("admin","super_admin") in
-- notification-admin.routes.ts (CLAUDE.md rule 6).
--
-- NOT EXECUTED against production (CLAUDE.md rule 4).

INSERT IGNORE INTO page_catalog
  (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'EMAIL_COMMAND_CENTRE', 'Email Command Centre', '/communication/email-centre',
   'Communication',
   'Notification catalogue, recipient resolution, dispatch activity and scheduled reports',
   1, NOW());

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin', 'EMAIL_COMMAND_CENTRE', 1, 1, 1, 1, 1, 1, NOW()),
  (UUID(), 'admin',       'EMAIL_COMMAND_CENTRE', 1, 1, 1, 0, 1, 1, NOW()),
  -- view + export only: HR needs to see who would receive what, and to chase the
  -- undeliverable-recipient data gaps, but must not switch events live.
  (UUID(), 'hr',          'EMAIL_COMMAND_CENTRE', 1, 0, 0, 0, 1, 1, NOW());

-- Verification
-- SELECT page_code, page_path, active_status FROM page_catalog WHERE page_code='EMAIL_COMMAND_CENTRE';
-- SELECT role_key, can_view, can_edit FROM role_page_access WHERE page_code='EMAIL_COMMAND_CENTRE';
--   -- expect super_admin/admin can_edit=1, hr can_edit=0
