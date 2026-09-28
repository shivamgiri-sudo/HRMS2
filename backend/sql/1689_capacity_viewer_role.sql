-- capacity_viewer: a role that exists to carry ONE read-only page grant.
--
-- WHY A NEW ROLE AT ALL. The Capacity Dashboard's intended audience is defined by DESIGNATION
-- ("everyone in Operations, HR and Training & Quality except Operations EXECUTIVEs"), but this
-- system grants access by ROLE. Those two do not line up. Measured live 2026-09-08: of the 106
-- people in that audience, only 36 are reachable by any existing role grant. The remaining 70
-- are 32 Team Leaders, 14 Quality Auditors, 7 Data Analysts, 4 RTMs, 2 Trainers and a Dy.
-- Manager who hold the plain 'employee' role or no role at all — the SAME role carried by the
-- 913 Operations EXECUTIVEs the rule excludes. No grant on an existing role can admit one group
-- without admitting the other, which is why a dedicated role is the only honest way to express
-- the rule.
--
-- Deliberately minimal. One page, can_view only. It confers nothing else, so assigning it to a
-- Team Leader cannot quietly widen anything beyond this dashboard — unlike reusing an existing
-- role, several of which in this database carry grants far beyond their name (branch_admin also
-- holds admin and finance_head). A role whose entire definition is one read-only page is a role
-- whose blast radius can be read off its definition.
--
-- The API side (workforce.mandate.routes.ts, /capacity-summary) accepts capacity_viewer in the
-- same change. Page grant and API role list are kept identical on purpose: a role granted the
-- page but refused by the API produces a dashboard that loads and then errors, which reads as a
-- broken product rather than a denied permission.
--
-- This migration only DEFINES the role's permission. It assigns the role to nobody — that is
-- scripts/grant-capacity-viewer.mts, which derives its list from department + designation and
-- cross-checks db_bill (masjclrentry.Status = '1') so a role is never handed to someone the
-- finance system does not consider active. Separating definition from assignment keeps the
-- migration replayable and the people-list re-runnable as staff join and change designation.
--
-- TWO INSERTS, IN THIS ORDER. user_roles.role_key is a FOREIGN KEY into
-- workforce_role_catalog, so the role must EXIST in the catalog before anyone can be given it.
-- Granting the page permission alone is not enough - the first assignment fails with
-- "Cannot add or update a child row: a foreign key constraint fails". Found the hard way: the
-- grant script rolled back on exactly that, which is the constraint doing its job.
--
-- INSERT IGNORE on both (UNIQUE on role_key, and on (role_key, page_code)), so a replay
-- changes nothing.


-- 1. The role itself. Must precede any user_roles row that references it.
INSERT IGNORE INTO workforce_role_catalog (id, role_key, role_name, description, active_status)
VALUES (
  UUID(), 'capacity_viewer', 'Capacity Dashboard Viewer',
  'Read-only access to the WFM Capacity Dashboard. Carries this one page and nothing else. Exists because the dashboard audience is defined by designation (Operations, HR and T&Q excluding Operations Executives) while access is granted by role, and the two do not line up.',
  1
);

-- 2. Its single permission.
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'capacity_viewer', 'WFM_CAPACITY_DASHBOARD', 1, 0, 0, 0, 0, 1);
