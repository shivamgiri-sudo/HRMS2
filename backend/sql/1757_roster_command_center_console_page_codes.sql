-- 1757_roster_command_center_console_page_codes.sql
--
-- Registers 8 new page codes for the merged Roster Command Center console
-- (/wfm/roster-command-center?tab=<key>), which replaces 7 previously separate pages:
-- Roster Command Center, Roster Analytics, Roster Analytics Panel (orphaned), Roster
-- Interventions, Roster Compliance, Shift Effectiveness, and Roster Audit Trail.
--
-- Why per-tab page codes instead of reusing the old shared WFM_ROSTER code: the 7 source
-- pages' backends enforce 7 different role sets (e.g. Live Monitoring's backend is
-- super_admin/admin/hr/wfm only, while Shift Effectiveness's also grants
-- branch_head/operations_manager/ceo/coo, and Interventions additionally grants a plain
-- `manager`). One page code can't express that union without over- or under-granting, so
-- each tab in the new console gets its own code, gated per-tab in the frontend shell
-- (see AttendanceIntegrityConsole.tsx for the established pattern this reuses).
--
-- Grants below are exact parity with each source endpoint's own existing backend
-- requireRole() list — no new role is invented, and this migration changes nothing about
-- who can call the underlying APIs, only who can see the corresponding tab.
--
-- Read-only page codes: can_view + can_export only, except WFM_ROSTER_AUDIT_TRAIL and
-- WFM_ROSTER_INTERVENTIONS which also carry can_edit (Audit Trail's "Record Amendment"
-- POST, Interventions' "Mark Action Taken" PATCH are real mutations gated the same way
-- their source pages already gated them). No UPDATE or DELETE anywhere in this file; it
-- is purely additive and safe to re-run.
--
-- ⚠ ORDER MATTERS. This migration MUST be applied BEFORE the frontend change that turns
-- /wfm/roster-command-center into the tabbed console and removes the 6 other routes,
-- otherwise every role loses every tab until it is run.

-- ─── Step 1: register the 8 page codes ─────────────────────────────────────────
INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
VALUES
  (UUID(), 'WFM_ROSTER_LIVE_MONITORING',      'Roster Console — Live Monitoring',        '/wfm/roster-command-center', 'WFM', 'Real-time unplanned-absence alerts and manager-effectiveness scores for today.', 1),
  (UUID(), 'WFM_ROSTER_TEAM_ROSTER',          'Roster Console — Team Roster',            '/wfm/roster-command-center', 'WFM', 'Color-coded per-process team roster (on time / late / absent / on leave) for a selected date.', 1),
  (UUID(), 'WFM_ROSTER_ANALYTICS',            'Roster Console — Analytics',              '/wfm/roster-command-center', 'WFM', 'Weekly shrinkage intelligence, quality correlation, cost impact and forecasting.', 1),
  (UUID(), 'WFM_ROSTER_TRENDS',               'Roster Console — Trends & Publish',       '/wfm/roster-command-center', 'WFM', 'Shrinkage trend, roster publish/acknowledge pipeline, attrition and lateness sections.', 1),
  (UUID(), 'WFM_ROSTER_COMPLIANCE',           'Roster Console — Compliance',             '/wfm/roster-command-center', 'WFM', 'WFM rule-violation monitor: minimum rest, consecutive days, week-off fairness, max hours, night-shift limit.', 1),
  (UUID(), 'WFM_ROSTER_SHIFT_EFFECTIVENESS',  'Roster Console — Shift Effectiveness',    '/wfm/roster-command-center', 'WFM', 'Per-shift adherence, quality, break compliance and shift-change recommendations.', 1),
  (UUID(), 'WFM_ROSTER_INTERVENTIONS',        'Roster Console — Interventions',          '/wfm/roster-command-center', 'WFM', 'Retention-risk intervention tracking and outcome recording.', 1),
  (UUID(), 'WFM_ROSTER_AUDIT_TRAIL',          'Roster Console — Audit Trail',            '/wfm/roster-command-center', 'WFM', 'Roster decision/change audit log, generation runs, and manual amendment recording.', 1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = 1;

-- ─── Step 2: grant per-tab, exact parity with each source endpoint's requireRole() ─────

-- Live Monitoring — roster-intelligence.routes.ts ADMIN_ROLES
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('super_admin', 'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 1, 1),
  ('admin',       'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 1, 1),
  ('hr',          'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 1, 1),
  ('wfm',         'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_export = 1, active_status = 1;

-- Team Roster — roster-intelligence.routes.ts MANAGER_ROLES
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('super_admin',        'WFM_ROSTER_TEAM_ROSTER', 1, 0, 0, 0, 1, 1),
  ('admin',              'WFM_ROSTER_TEAM_ROSTER', 1, 0, 0, 0, 1, 1),
  ('hr',                 'WFM_ROSTER_TEAM_ROSTER', 1, 0, 0, 0, 1, 1),
  ('wfm',                'WFM_ROSTER_TEAM_ROSTER', 1, 0, 0, 0, 1, 1),
  ('branch_head',        'WFM_ROSTER_TEAM_ROSTER', 1, 0, 0, 0, 1, 1),
  ('manager',            'WFM_ROSTER_TEAM_ROSTER', 1, 0, 0, 0, 1, 1),
  ('operations_manager', 'WFM_ROSTER_TEAM_ROSTER', 1, 0, 0, 0, 1, 1),
  ('process_manager',    'WFM_ROSTER_TEAM_ROSTER', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_export = 1, active_status = 1;

-- Analytics — roster-analytics.routes.ts ANALYTICS_ROLES
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('super_admin',        'WFM_ROSTER_ANALYTICS', 1, 0, 0, 0, 1, 1),
  ('admin',              'WFM_ROSTER_ANALYTICS', 1, 0, 0, 0, 1, 1),
  ('hr',                 'WFM_ROSTER_ANALYTICS', 1, 0, 0, 0, 1, 1),
  ('wfm',                'WFM_ROSTER_ANALYTICS', 1, 0, 0, 0, 1, 1),
  ('branch_head',        'WFM_ROSTER_ANALYTICS', 1, 0, 0, 0, 1, 1),
  ('operations_manager', 'WFM_ROSTER_ANALYTICS', 1, 0, 0, 0, 1, 1),
  ('ceo',                'WFM_ROSTER_ANALYTICS', 1, 0, 0, 0, 1, 1),
  ('coo',                'WFM_ROSTER_ANALYTICS', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_export = 1, active_status = 1;

-- Trends & Publish — union of rta.routes.ts + roster-import.routes.ts WFM_VIEW_ROLES
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('super_admin',        'WFM_ROSTER_TRENDS', 1, 0, 0, 0, 1, 1),
  ('admin',              'WFM_ROSTER_TRENDS', 1, 0, 0, 0, 1, 1),
  ('hr',                 'WFM_ROSTER_TRENDS', 1, 0, 0, 0, 1, 1),
  ('wfm',                'WFM_ROSTER_TRENDS', 1, 0, 0, 0, 1, 1),
  ('process_manager',    'WFM_ROSTER_TRENDS', 1, 0, 0, 0, 1, 1),
  ('manager',            'WFM_ROSTER_TRENDS', 1, 0, 0, 0, 1, 1),
  ('team_leader',        'WFM_ROSTER_TRENDS', 1, 0, 0, 0, 1, 1),
  ('assistant_manager',  'WFM_ROSTER_TRENDS', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_export = 1, active_status = 1;

-- Compliance — union of wfm-compliance-analytics.routes.ts /summary, /violations, /trend
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('hr',                 'WFM_ROSTER_COMPLIANCE', 1, 0, 0, 0, 1, 1),
  ('wfm',                'WFM_ROSTER_COMPLIANCE', 1, 0, 0, 0, 1, 1),
  ('admin',              'WFM_ROSTER_COMPLIANCE', 1, 0, 0, 0, 1, 1),
  ('super_admin',        'WFM_ROSTER_COMPLIANCE', 1, 0, 0, 0, 1, 1),
  ('operations_manager', 'WFM_ROSTER_COMPLIANCE', 1, 0, 0, 0, 1, 1),
  ('ceo',                'WFM_ROSTER_COMPLIANCE', 1, 0, 0, 0, 1, 1),
  ('manager',            'WFM_ROSTER_COMPLIANCE', 1, 0, 0, 0, 1, 1),
  ('branch_head',        'WFM_ROSTER_COMPLIANCE', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_export = 1, active_status = 1;

-- Shift Effectiveness — roster-analytics.routes.ts ANALYTICS_ROLES (same set as Analytics)
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('super_admin',        'WFM_ROSTER_SHIFT_EFFECTIVENESS', 1, 0, 0, 0, 1, 1),
  ('admin',              'WFM_ROSTER_SHIFT_EFFECTIVENESS', 1, 0, 0, 0, 1, 1),
  ('hr',                 'WFM_ROSTER_SHIFT_EFFECTIVENESS', 1, 0, 0, 0, 1, 1),
  ('wfm',                'WFM_ROSTER_SHIFT_EFFECTIVENESS', 1, 0, 0, 0, 1, 1),
  ('branch_head',        'WFM_ROSTER_SHIFT_EFFECTIVENESS', 1, 0, 0, 0, 1, 1),
  ('operations_manager', 'WFM_ROSTER_SHIFT_EFFECTIVENESS', 1, 0, 0, 0, 1, 1),
  ('ceo',                'WFM_ROSTER_SHIFT_EFFECTIVENESS', 1, 0, 0, 0, 1, 1),
  ('coo',                'WFM_ROSTER_SHIFT_EFFECTIVENESS', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_export = 1, active_status = 1;

-- Interventions — intervention-recommendation.routes.ts (also carries can_edit for the
-- real "Mark Action Taken" PATCH the source page already gated the same way)
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('hr',          'WFM_ROSTER_INTERVENTIONS', 1, 0, 1, 0, 1, 1),
  ('admin',       'WFM_ROSTER_INTERVENTIONS', 1, 0, 1, 0, 1, 1),
  ('super_admin', 'WFM_ROSTER_INTERVENTIONS', 1, 0, 1, 0, 1, 1),
  ('manager',     'WFM_ROSTER_INTERVENTIONS', 1, 0, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_edit = 1, can_export = 1, active_status = 1;

-- Audit Trail — roster-audit.routes.ts /trails (broadest of its 3 endpoints); also
-- carries can_edit for the real "Record Amendment" POST the source page already gated
-- to hr/wfm/admin/super_admin/operations_manager via /api/roster-gov.
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('hr',                 'WFM_ROSTER_AUDIT_TRAIL', 1, 0, 1, 0, 1, 1),
  ('wfm',                'WFM_ROSTER_AUDIT_TRAIL', 1, 0, 1, 0, 1, 1),
  ('admin',              'WFM_ROSTER_AUDIT_TRAIL', 1, 0, 1, 0, 1, 1),
  ('super_admin',        'WFM_ROSTER_AUDIT_TRAIL', 1, 0, 1, 0, 1, 1),
  ('operations_manager', 'WFM_ROSTER_AUDIT_TRAIL', 1, 0, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_edit = 1, can_export = 1, active_status = 1;

-- ─── Verification (run after applying) ─────────────────────────────────────────
-- SELECT page_code, page_path, active_status FROM page_catalog
--  WHERE page_code LIKE 'WFM_ROSTER_%' ORDER BY page_code;
-- SELECT page_code, role_key, can_view, can_edit, can_export, active_status
--   FROM role_page_access
--  WHERE page_code LIKE 'WFM_ROSTER_%' AND active_status = 1
--  ORDER BY page_code, role_key;
