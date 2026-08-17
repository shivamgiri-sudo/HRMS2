-- 1230_rbac_super_admin_only_page_access_sweep.sql
-- Go-live UAT sweep (2026-08-17): fixes 16 pages where role_page_access grants were never
-- backfilled beyond super_admin, leaving every other intended role locked out with
-- "Access Denied" -- the exact same pattern already found and fixed twice earlier today
-- (FINANCE_GRN via 1129's precedent, QUALITY_EXECUTIVE via 1143), now confirmed systemic
-- across the rest of the page catalog via a full role_page_access sweep against every
-- pageCode referenced by a ProtectedRoute roles={} array in src/config/routes/*.tsx.
--
-- METHOD: for each pageCode below, the "intended" role list is read directly from the
-- roles={} prop already declared on that page's <Route> in source -- i.e. this migration
-- makes the database agree with what the application code already says should have access,
-- not a new authorization decision. 15 of 16 were confirmed as genuine under-grants; the
-- 16th (SUPER_ADMIN_POLICY_ENGINE) was checked and found correctly scoped to super_admin
-- only, so it is NOT included here.
--
-- PAYROLL_TDS_PART_A additionally had NO page_catalog row at all (total lockout for
-- everyone but super_admin) -- inserted here too. Its role grant was verified against the
-- backend's own requireRole(...PAYROLL_ROLES) guard in tds-certificate-part-a.routes.ts
-- (PAYROLL_ROLES = admin, super_admin, payroll_head, payroll, payroll_hr, finance -- exact
-- match to the frontend route's roles={} list), so it gets can_create/can_edit=1 too, not
-- just can_view.
--
-- The other 15 pages are granted VIEW-ONLY (can_view=1, can_create/edit/delete/export=0)
-- deliberately conservative: this fixes the P0 "cannot even open the page" defect without
-- asserting write-capability parity with each page's backend guard, which was not
-- individually re-verified for all 15 in the time available. A page that needs write access
-- restored too is a narrower, lower-severity follow-up, not blocked by this migration.
--
-- Scope check: this is an RBAC/access-control DATA fix (role_page_access grants), not a
-- change to payroll/statutory CALCULATION logic, bank data, or encryption keys, and it only
-- WIDENS reachability to functionality whose own backend routes already independently
-- enforce their own role checks (UI route gating is not the security boundary in this
-- codebase; the backend requireRole guards are, and are unchanged by this migration).
--
-- Additive and idempotent: INSERT ... ON DUPLICATE KEY UPDATE only, no DROP, no DELETE.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('PAYROLL_TDS_PART_A', 'TDS Certificate Part A', '/payroll/tds-certificate-part-a', 'Payroll',
   'Upload/verify/read Part A of the salary TDS certificate (TRACES-issued, ingested not generated).',
   1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

-- PAYROLL_TDS_PART_A: full grant, backend role list verified to match exactly.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'admin',        'PAYROLL_TDS_PART_A', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll_head',  'PAYROLL_TDS_PART_A', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll',       'PAYROLL_TDS_PART_A', 1, 1, 1, 0, 1, 1),
  (UUID(), 'payroll_hr',    'PAYROLL_TDS_PART_A', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance',       'PAYROLL_TDS_PART_A', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 1, can_edit = 1, active_status = 1;

-- The remaining 15: view-only, matching each route's documented roles={} list minus the
-- super_admin row that already exists.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  -- FINANCE_PNL_CONFIG: pnlRoles (finance.routes.tsx)
  (UUID(), 'admin',         'FINANCE_PNL_CONFIG', 1, 0, 0, 0, 0, 1),
  (UUID(), 'ceo',           'FINANCE_PNL_CONFIG', 1, 0, 0, 0, 0, 1),
  (UUID(), 'coo',           'FINANCE_PNL_CONFIG', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance',       'FINANCE_PNL_CONFIG', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance_head',  'FINANCE_PNL_CONFIG', 1, 0, 0, 0, 0, 1),
  (UUID(), 'accounts_head', 'FINANCE_PNL_CONFIG', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll_head',  'FINANCE_PNL_CONFIG', 1, 0, 0, 0, 0, 1),

  -- SALARY_PACKAGE_ADMIN: admin,super_admin,payroll (payroll.routes.tsx)
  (UUID(), 'admin',         'SALARY_PACKAGE_ADMIN', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll',       'SALARY_PACKAGE_ADMIN', 1, 0, 0, 0, 0, 1),

  -- NAME_CONSISTENCY_MATRIX: admin,hr,super_admin,recruiter (recruitment.routes.tsx)
  (UUID(), 'admin',         'NAME_CONSISTENCY_MATRIX', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',            'NAME_CONSISTENCY_MATRIX', 1, 0, 0, 0, 0, 1),
  (UUID(), 'recruiter',     'NAME_CONSISTENCY_MATRIX', 1, 0, 0, 0, 0, 1),

  -- ATTENDANCE_RULES_MASTER: super_admin,admin,hr (workforce.routes.tsx)
  (UUID(), 'admin',         'ATTENDANCE_RULES_MASTER', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',            'ATTENDANCE_RULES_MASTER', 1, 0, 0, 0, 0, 1),

  -- WFM_BRANCH_SPOC_CONFIG: super_admin,admin (workforce.routes.tsx)
  (UUID(), 'admin',         'WFM_BRANCH_SPOC_CONFIG', 1, 0, 0, 0, 0, 1),

  -- PAYROLL_HOLIDAY_WORK: super_admin,admin,wfm,payroll_head,payroll_branch (payroll.routes.tsx, Table B live roles)
  (UUID(), 'admin',         'PAYROLL_HOLIDAY_WORK', 1, 0, 0, 0, 0, 1),
  (UUID(), 'wfm',           'PAYROLL_HOLIDAY_WORK', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll_head',  'PAYROLL_HOLIDAY_WORK', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll_branch','PAYROLL_HOLIDAY_WORK', 1, 0, 0, 0, 0, 1),

  -- PAYROLL_SALARY_VERIFICATION: super_admin,payroll_head,branch_head,payroll_branch,wfm,process_manager,admin (Table B live)
  (UUID(), 'payroll_head',  'PAYROLL_SALARY_VERIFICATION', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_head',   'PAYROLL_SALARY_VERIFICATION', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll_branch','PAYROLL_SALARY_VERIFICATION', 1, 0, 0, 0, 0, 1),
  (UUID(), 'wfm',           'PAYROLL_SALARY_VERIFICATION', 1, 0, 0, 0, 0, 1),
  (UUID(), 'process_manager','PAYROLL_SALARY_VERIFICATION', 1, 0, 0, 0, 0, 1),
  (UUID(), 'admin',         'PAYROLL_SALARY_VERIFICATION', 1, 0, 0, 0, 0, 1),

  -- PAYROLL_PF_MANAGEMENT: admin,super_admin,payroll_hr,payroll (Table B live)
  (UUID(), 'admin',         'PAYROLL_PF_MANAGEMENT', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll_hr',    'PAYROLL_PF_MANAGEMENT', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll',       'PAYROLL_PF_MANAGEMENT', 1, 0, 0, 0, 0, 1),

  -- COMM_TEMPLATES: super_admin,admin,hr (Table B live)
  (UUID(), 'admin',         'COMM_TEMPLATES', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',            'COMM_TEMPLATES', 1, 0, 0, 0, 0, 1),

  -- COMM_DISPATCH: super_admin,admin,hr (Table B live)
  (UUID(), 'admin',         'COMM_DISPATCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',            'COMM_DISPATCH', 1, 0, 0, 0, 0, 1),

  -- COMM_HISTORY: super_admin,admin,hr (Table B live)
  (UUID(), 'admin',         'COMM_HISTORY', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',            'COMM_HISTORY', 1, 0, 0, 0, 0, 1),

  -- COMM_CONFIG: super_admin,admin (Table B live)
  (UUID(), 'admin',         'COMM_CONFIG', 1, 0, 0, 0, 0, 1),

  -- CALL_CENTRE_CONFIG: super_admin,admin (Table B live)
  (UUID(), 'admin',         'CALL_CENTRE_CONFIG', 1, 0, 0, 0, 0, 1),

  -- WFM_WEEKOFF_FAIRNESS: super_admin,admin,wfm (Table B live)
  (UUID(), 'admin',         'WFM_WEEKOFF_FAIRNESS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'wfm',           'WFM_WEEKOFF_FAIRNESS', 1, 0, 0, 0, 0, 1),

  -- WFM_BREAK_DESK_DEVICES: super_admin,admin,wfm (Table B live)
  (UUID(), 'admin',         'WFM_BREAK_DESK_DEVICES', 1, 0, 0, 0, 0, 1),
  (UUID(), 'wfm',           'WFM_BREAK_DESK_DEVICES', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = 1,
  active_status = 1;

SELECT '1230_rbac_super_admin_only_page_access_sweep.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0
--   WHERE page_code IN ('PAYROLL_TDS_PART_A','FINANCE_PNL_CONFIG','SALARY_PACKAGE_ADMIN',
--     'NAME_CONSISTENCY_MATRIX','ATTENDANCE_RULES_MASTER','WFM_BRANCH_SPOC_CONFIG',
--     'PAYROLL_HOLIDAY_WORK','PAYROLL_SALARY_VERIFICATION','PAYROLL_PF_MANAGEMENT',
--     'COMM_TEMPLATES','COMM_DISPATCH','COMM_HISTORY','COMM_CONFIG','CALL_CENTRE_CONFIG',
--     'WFM_WEEKOFF_FAIRNESS','WFM_BREAK_DESK_DEVICES')
--     AND role_key <> 'super_admin';
--   UPDATE page_catalog SET active_status = 0 WHERE page_code = 'PAYROLL_TDS_PART_A';
