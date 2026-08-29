-- 1632 — Salary Revision page catalog entry and role grants
--
-- NOT YET EXECUTED. Additive change against production RBAC data; needs the owner's
-- explicit approval before it runs (CLAUDE.md: no SQL on production without it).
--
-- WHAT THIS DOES
-- Registers SALARY_REVISION (route /salary-revision), the dual-role page where
-- employees submit revision requests and payroll/hr approves them, and includes:
--   src/pages/SalaryRevisionPage.tsx
--   src/config/routes/payroll.routes.tsx  (Gate pageCode="SALARY_REVISION")
--
-- The catalog row matters on its own: access.service.ts builds its permission map from
-- active page_catalog rows — a code absent from the catalogue can be held by nobody and
-- the gate denies the whole organisation, super_admin included.
--
-- ROLLBACK
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'SALARY_REVISION';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'SALARY_REVISION';

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'SALARY_REVISION',
  'Salary Revision',
  '/salary-revision',
  'PAYROLL',
  'Employee salary revision requests and payroll/HR approval workflow',
  1
)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), r.role_key, 'SALARY_REVISION', 1, 1, 1, 0, 0, 1, NOW()
  FROM (
    SELECT 'payroll_hr'   AS role_key UNION ALL
    SELECT 'payroll_head'             UNION ALL
    SELECT 'branch_head'              UNION ALL
    SELECT 'hr'                       UNION ALL
    SELECT 'hr_admin'                 UNION ALL
    SELECT 'admin'                    UNION ALL
    SELECT 'super_admin'              UNION ALL
    SELECT 'employee'
  ) r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access existing
    WHERE existing.role_key  = r.role_key
      AND existing.page_code = 'SALARY_REVISION'
 );

UPDATE role_page_access
   SET can_view = 1, active_status = 1
 WHERE page_code = 'SALARY_REVISION'
   AND role_key IN ('payroll_hr','payroll_head','branch_head','hr','hr_admin','admin','super_admin','employee');

SELECT 'Migration 1632 applied: SALARY_REVISION page catalog + role_page_access' AS migration_status;
