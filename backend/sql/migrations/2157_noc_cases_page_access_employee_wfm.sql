-- 2157_noc_cases_page_access_employee_wfm.sql
--
-- The NOC Clearance Chain page (/payroll/noc-cases, page code PAYROLL_NOC_CASES) must be visible to
-- employees (their own clearance status), WFM and branch WFM. 1763 granted the 20 roles that sign or
-- administer a NOC; these three were not in it.
--
-- VIEW ONLY. can_create / can_edit / can_delete / can_export are 0: this decides who may open the screen,
-- nothing more. What each person sees is enforced per request in noc-case.routes.ts: an employee with no
-- other NOC read role sees only their own case; WFM / branch WFM are branch / assignment scoped like every
-- other staff reader. Signing and every write route keep their own role gate.
--
-- Additive and idempotent: INSERT IGNORE, no row updated or deleted. Depends on 1763 (page_catalog row).

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), r.role_key, 'PAYROLL_NOC_CASES', 1, 0, 0, 0, 0, 1, NOW()
FROM (SELECT 'employee' AS role_key UNION ALL SELECT 'wfm' UNION ALL SELECT 'branch_wfm') r
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access x WHERE x.role_key = r.role_key AND x.page_code = 'PAYROLL_NOC_CASES'
);

-- Verification:
-- SELECT role_key, can_view, can_edit FROM role_page_access WHERE page_code = 'PAYROLL_NOC_CASES' ORDER BY role_key;  -- expect 23 rows
