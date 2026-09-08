-- The Capacity Dashboard has no page code of its own, so it cannot be granted independently.
--
-- /wfm/capacity-dashboard is gated on WFM_ROSTER, a code it SHARES with ten other routes:
-- /wfm/roster, roster-workspace, roster-import, roster-builder (gated WFM_ROSTER_BUILDER),
-- roster-requests, roster-insights, roster-view, roster-analytics, roster-analytics-panel,
-- mobile-attendance, mobile-roster and notification-hub. Three of those are WRITE surfaces —
-- roster-import bulk-loads a whole branch's roster, roster-workspace and roster-builder author
-- one. Granting somebody the capacity dashboard today therefore also hands them the ability to
-- rewrite rosters, which is not a trade anyone would knowingly make to show a manager a
-- headcount chart.
--
-- This gives the dashboard its own code so its audience can be widened without widening the
-- roster suite. Read-only by construction: the page issues one GET
-- (/api/workforce-mandate/capacity-summary) and writes nothing, so can_view is the only
-- permission that means anything here — can_create/edit/delete/export stay 0.
--
-- GRANTS mirror the roles the API itself will accept after the accompanying route change
-- (workforce.mandate.routes.ts widens requireRole on /capacity-summary to the same list).
-- Granting a page whose API refuses the caller produces a page that loads and then shows an
-- error, which is worse than no access at all, so the two lists are kept identical on purpose.
--
-- WHAT THIS DOES NOT DO. It does not reach the ~50 Operations staff — 31 Team Leaders, 7
-- Data Analysts, 4 RTMs and several unassigned Dy./Assistant Managers — who hold only the
-- 'employee' role or no role at all. They carry the SAME role as the 913 Operations EXECUTIVEs
-- who must be excluded, so no role grant can separate them. Reaching that group needs either a
-- new role assigned per person or per-user user_page_access rows, which is a separate,
-- owner-decided step and deliberately not guessed at here.
--
-- DEPLOY ORDER MATTERS. This migration must run BEFORE the frontend change that points
-- /wfm/capacity-dashboard at the new code. If the frontend ships first, the Gate looks up a
-- page code that has no catalog row and no grants, and the page locks out everyone except
-- super_admin (canViewPage short-circuits on isSuperAdmin). Same failure mode 1682 called out.
--
-- INSERT IGNORE on both tables (UNIQUE on page_code, and on (role_key, page_code)), so a
-- replay changes nothing and an existing grant is never overwritten. Purely additive.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'WFM_CAPACITY_DASHBOARD', 'Capacity Dashboard', '/wfm/capacity-dashboard', 'WFM', 1);

-- Roles that already reach it today through WFM_ROSTER, kept so nobody loses access:
--   super_admin, wfm, manager, process_manager, team_leader, branch_wfm, tl
-- Roles added so the dashboard reaches its intended audience — branch and process leadership,
-- HR, and Training & Quality — each of which the widened API will accept:
--   hr, admin, ceo, branch_head, assistant_manager, tq_head, trainer, qa
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',       'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'admin',             'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'ceo',               'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',                'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'wfm',               'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_wfm',        'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_head',       'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'process_manager',   'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'manager',           'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'assistant_manager', 'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'team_leader',       'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'tl',                'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'tq_head',           'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'trainer',           'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1),
  (UUID(), 'qa',                'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1);
