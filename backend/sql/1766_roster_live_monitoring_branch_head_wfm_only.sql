-- 1766_roster_live_monitoring_branch_head_wfm_only.sql
--
-- Owner's decision, 2026-09-14: the Roster Console's Live Monitoring tab
-- (/wfm/roster-command-center?tab=live, page_code WFM_ROSTER_LIVE_MONITORING)
-- is Branch Head + WFM team only.
--
-- DISCOVERY WHILE WRITING THIS (live-checked immediately before writing it): none of the
-- 8 page codes migration 1757_roster_command_center_console_page_codes.sql documents were
-- actually present on production — not in page_catalog, not in role_page_access. 1757's own
-- header warns this ordering matters ("MUST be applied BEFORE the frontend change... otherwise
-- every role loses every tab until it is run"), and the frontend change shipped in commit
-- 9f2e7423 (deployed 2026-09-12 per hrms2-roster-console-merge-deployed-and-live-tested), so
-- this looks like 1757 was written and reviewed but its own apply step never actually ran here.
-- That is a real, separate gap covering the other 7 tabs too (Team Roster, Analytics, Trends,
-- Compliance, Shift Effectiveness, Interventions, Audit Trail) — out of scope for this change,
-- flagged to the owner rather than silently fixed here, since the ask was Live Monitoring only.
-- This migration is therefore self-contained rather than assuming 1757 already ran: it
-- registers WFM_ROSTER_LIVE_MONITORING in page_catalog itself (idempotent — if 1757 runs
-- later or already has by the time this does, the ON DUPLICATE KEY UPDATE is a no-op).
--
-- WHY BOTH ENDS (same reasoning as 1661_restrict_audit_security_access_control_to_super_admin.sql,
-- the precedent this migration follows). role_page_access decides whether the tab renders in the
-- console and whether it appears in the tab list; the backend LIVE_MONITORING_ROLES constant in
-- roster-intelligence.routes.ts decides whether its 5 endpoints (/manager-digests,
-- /branch-dashboards, /unplanned-absences, POST /send-manager-digests, POST /send-unplanned-alerts)
-- answer the request. Narrowing only one half leaves the tab visible with every call 403ing, or the
-- tab hidden while the endpoints still answer a direct call from a role with no UI grant. Both are
-- changed in this same commit — see roster-intelligence.routes.ts's LIVE_MONITORING_ROLES (split
-- out from the pre-existing ADMIN_ROLES constant, which stays admin/hr/wfm/super_admin and is left
-- untouched: it also gates the unrelated /manager-digest self-service "view someone else's digest"
-- check, not the Live Monitoring tab).
--
-- WHAT IS REVOKED: admin and hr's would-be grant per 1757's own text (never actually applied live,
-- per the discovery above — this UPDATE is a defensive no-op today, kept so the migration reaches
-- the same end state whether or not 1757 has run by the time this does).
--
-- wfm and branch_head are the only roles that end up granted. super_admin needs no row: this repo's
-- access.service.ts elevates it to every active page_catalog code regardless of role_page_access,
-- and requireRole() unconditionally allows super_admin regardless of the allowed-roles list passed
-- to it.
--
-- SOFT REVOKE, NOT DELETE. active_status = 0 leaves any admin/hr row and its history in place
-- rather than removing it, so the decision is reversible by flipping one column.
--
-- Rollback:
--   UPDATE role_page_access SET active_status = 1
--    WHERE page_code = 'WFM_ROSTER_LIVE_MONITORING' AND role_key IN ('admin','hr');
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code = 'WFM_ROSTER_LIVE_MONITORING' AND role_key IN ('branch_head','wfm');

USE mas_hrms;

-- Step 1: register the page code (see DISCOVERY note above — 1757 never applied this live).
INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
VALUES
  (UUID(), 'WFM_ROSTER_LIVE_MONITORING', 'Roster Console — Live Monitoring', '/wfm/roster-command-center', 'WFM', 'Real-time unplanned-absence alerts and manager-effectiveness scores for today.', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name), page_path = VALUES(page_path), module = VALUES(module),
  description = VALUES(description), active_status = 1;

-- Step 2: revoke admin and hr's grant if present (defensive — see note above).
UPDATE role_page_access
   SET active_status = 0
 WHERE page_code = 'WFM_ROSTER_LIVE_MONITORING'
   AND role_key IN ('admin', 'hr')
   AND active_status = 1;

-- Step 3: grant branch_head and wfm.
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('branch_head', 'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 1, 1),
  ('wfm',         'WFM_ROSTER_LIVE_MONITORING', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_export = 1, active_status = 1;

-- Verification (expect wfm, branch_head only):
-- SELECT page_code, role_key, can_view, can_export, active_status
--   FROM role_page_access
--  WHERE page_code = 'WFM_ROSTER_LIVE_MONITORING' AND active_status = 1
--  ORDER BY role_key;
