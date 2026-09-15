-- 1703_noc_cases_page_access.sql
--
-- Makes /payroll/noc-cases — the NOC Certificate clearance workspace — reachable by the people who
-- actually have to sign a NOC.
--
-- WHY THIS IS NEEDED
--
-- payroll.routes.tsx guards that route with <Gate pageCode="PAYROLL_NOC_CASES">, and no
-- PAYROLL_NOC_CASES row existed in either page_catalog or role_page_access. Gate has a super_admin
-- bypass, so the page opened for exactly one role and 403'd for the other nineteen the route's own
-- ProtectedRoute admits. The route file says so in its own comment rather than hiding it; this is
-- the grant it asks for.
--
-- The eight signatories are Team Leader, Process Manager, HR, Branch Manager, IT, Admin, Accounts
-- and Finance. NONE of them is a payroll role, which is the whole reason the existing PAYROLL_NOC
-- grants do not cover this page — that page code is the older single-document upload flow, granted
-- to payroll roles only.
--
-- PERMISSIONS ARE INTENTIONALLY FLAT AND READ+EDIT ONLY
--
-- can_view + can_edit for everyone, can_create only for the roles that can raise a case, and
-- can_delete for nobody. A NOC is an audit record: nothing in the API deletes one, so granting
-- delete would advertise a capability that does not exist. The real authority — which stage a user
-- may sign, and whether they are scoped to that branch — is enforced per request in
-- noc-case.routes.ts against noc_signatory.role_key, and cannot be expressed here. This grant only
-- decides who may open the screen; it confers no signing rights.
--
-- Role list mirrors READ_ROLES in noc-case.routes.ts exactly. If the two drift, a user is admitted
-- to a page where every action 403s — the "admitted then refused" failure this codebase has hit
-- before (see the contract test on readiness scope/role alignment).
--
-- Additive and idempotent: INSERT IGNORE on both tables, no row updated or deleted.
--
-- Depends on: 538_route_page_access_backfill.sql (page_catalog / role_page_access shape).

INSERT IGNORE INTO page_catalog
  (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'PAYROLL_NOC_CASES', 'NOC Clearance Workspace', '/payroll/noc-cases', 'Payroll',
   'NOC Certificate exit-clearance chain: 8 signatories, asset return and settlement route', 1, NOW());

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  -- Administration and payroll: can raise a case as well as read and act.
  (UUID(), 'super_admin',     'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll',         'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_hr',      'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),

  -- HR: owns the Last Working Day, record-on-behalf, and resolving a declined case.
  (UUID(), 'hr',              'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'branch_hr',       'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),

  -- The operations chain — signatories 1, 2 and 4. Can also initiate.
  (UUID(), 'tl',              'PAYROLL_NOC_CASES', 1,1,1,0,0, 1, NOW()),
  (UUID(), 'team_leader',     'PAYROLL_NOC_CASES', 1,1,1,0,0, 1, NOW()),
  (UUID(), 'process_manager', 'PAYROLL_NOC_CASES', 1,1,1,0,0, 1, NOW()),
  (UUID(), 'manager',         'PAYROLL_NOC_CASES', 1,1,1,0,0, 1, NOW()),
  (UUID(), 'branch_head',     'PAYROLL_NOC_CASES', 1,1,1,0,1, 1, NOW()),

  -- IT and Admin — signatories 5 and 6, and the only roles that may waive an asset.
  (UUID(), 'branch_it',       'PAYROLL_NOC_CASES', 1,1,1,0,0, 1, NOW()),
  (UUID(), 'it',              'PAYROLL_NOC_CASES', 1,0,1,0,0, 1, NOW()),
  (UUID(), 'it_head',         'PAYROLL_NOC_CASES', 1,0,1,0,0, 1, NOW()),
  (UUID(), 'branch_admin',    'PAYROLL_NOC_CASES', 1,1,1,0,0, 1, NOW()),

  -- Accounts and Finance — signatories 7 and 8. Finance also sets the settlement route.
  -- 'accounts' is seeded by 1696; it existed nowhere in the catalogue before that.
  (UUID(), 'accounts',        'PAYROLL_NOC_CASES', 1,0,1,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_NOC_CASES', 1,0,1,0,1, 1, NOW()),
  (UUID(), 'finance_head',    'PAYROLL_NOC_CASES', 1,0,1,0,1, 1, NOW());

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT page_code, route_path FROM page_catalog WHERE page_code = 'PAYROLL_NOC_CASES';
-- SELECT role_key, can_view, can_create, can_edit FROM role_page_access
--  WHERE page_code = 'PAYROLL_NOC_CASES' ORDER BY role_key;   -- expect 20 rows
