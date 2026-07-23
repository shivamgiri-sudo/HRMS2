-- ============================================================
-- Migration 560: Fix page_catalog module grouping & page_paths
-- Date: 2026-07-23
-- Purpose:
--   1. Normalise module column to consistent values so that
--      ModuleLauncher groups pages logically (was 35 fragments)
--   2. Fill NULL page_path for 20 active pages so navigation works
-- Safe: UPDATE only, no DROP/ALTER TABLE, fully idempotent.
-- ============================================================

USE mas_hrms;

-- ────────────────────────────────────────────────────────────
-- PART 1: Normalise module column values
-- ────────────────────────────────────────────────────────────

-- ATS: absorb lowercase 'ats' and 'recruitment'
UPDATE page_catalog SET module = 'ATS'
WHERE module IN ('ats', 'recruitment');

-- Payroll: unify three variants
UPDATE page_catalog SET module = 'Payroll'
WHERE module IN ('payroll', 'PAYROLL');

-- Compliance: fix lowercase
UPDATE page_catalog SET module = 'Compliance'
WHERE module = 'compliance';

-- Engagement: fix lowercase
UPDATE page_catalog SET module = 'Engagement'
WHERE module = 'engagement';

-- HR: consolidate exit flows, legacy employees, letters, self-service
UPDATE page_catalog SET module = 'HR'
WHERE module IN ('exit', 'employees', 'letters', 'Employee Self-Service', 'People');

-- Support: rename helpdesk
UPDATE page_catalog SET module = 'Support'
WHERE module = 'helpdesk';

-- Admin: absorb System and Reports
UPDATE page_catalog SET module = 'Admin'
WHERE module IN ('System', 'Reports');

-- Operations: absorb governance (TAT pages belong here)
UPDATE page_catalog SET module = 'Operations'
WHERE module = 'governance';

-- LMS: absorb 'Learning' (LMS_PROGRESS_DASHBOARD)
UPDATE page_catalog SET module = 'LMS'
WHERE module = 'Learning';

-- Dashboards: normalise casing
UPDATE page_catalog SET module = 'Dashboards'
WHERE module = 'dashboards';

-- Finance: absorb ERP
UPDATE page_catalog SET module = 'Finance'
WHERE module = 'ERP';

-- WFM: absorb Workforce (WORKFORCE_COMMAND_CENTER)
UPDATE page_catalog SET module = 'WFM'
WHERE module = 'Workforce';

-- ────────────────────────────────────────────────────────────
-- PART 2: Fill NULL page_path for active pages
-- ────────────────────────────────────────────────────────────

-- Admin pages
UPDATE page_catalog SET page_path = '/super-admin/module-access'   WHERE page_code = 'MODULE_ACCESS'          AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/security-center'             WHERE page_code = 'SECURITY_CENTER'        AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/super-admin/dashboard'       WHERE page_code = 'SUPER_ADMIN_DASHBOARD'  AND page_path IS NULL;

-- Compliance
UPDATE page_catalog SET page_path = '/compliance/audit-report'     WHERE page_code = 'COMPLIANCE_AUDIT_REPORT' AND page_path IS NULL;

-- Expenses
UPDATE page_catalog SET page_path = '/expenses'                    WHERE page_code = 'MY_EXPENSES'            AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/expenses/new'                WHERE page_code = 'EXPENSE_CREATE'         AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/expenses/approvals'          WHERE page_code = 'EXPENSE_APPROVALS'      AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/expenses/finance'            WHERE page_code = 'EXPENSE_FINANCE'        AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/expenses/reports'            WHERE page_code = 'EXPENSE_REPORTS'        AND page_path IS NULL;

-- LMS
UPDATE page_catalog SET page_path = '/lms/progress-dashboard'      WHERE page_code = 'LMS_PROGRESS_DASHBOARD' AND page_path IS NULL;

-- Overview / Dashboards
UPDATE page_catalog SET page_path = '/my-dashboard'                WHERE page_code = 'EMPLOYEE_DASHBOARD'     AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/management/dashboard'        WHERE page_code = 'MANAGER_DASHBOARD'      AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/payroll-hr/dashboard'        WHERE page_code = 'PAYROLL_DASHBOARD'      AND page_path IS NULL;

-- Payroll
UPDATE page_catalog SET page_path = '/payroll/disbursal'           WHERE page_code = 'PAYROLL_DISBURSAL'          AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/payroll/loans'               WHERE page_code = 'PAYROLL_LOANS'              AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/payroll/salary-certificates' WHERE page_code = 'SALARY_CERTIFICATE'         AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/payroll/pf-creation-queue'   WHERE page_code = 'PAYROLL_PF_CREATION_QUEUE'  AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/payroll/pf-batches'          WHERE page_code = 'PAYROLL_PF_BATCHES'         AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/payroll/masters'             WHERE page_code = 'PAYROLL_DEDUCTION_TYPES'    AND page_path IS NULL;
UPDATE page_catalog SET page_path = '/payroll/masters'             WHERE page_code = 'PAYROLL_DEDUCTION_UPLOAD'   AND page_path IS NULL;

-- ────────────────────────────────────────────────────────────
-- PART 3: Verify result
-- ────────────────────────────────────────────────────────────
-- Run these manually to confirm:
--
-- SELECT module, COUNT(*) as pages
-- FROM page_catalog WHERE active_status = 1
-- GROUP BY module ORDER BY module;
--
-- SELECT page_code, page_name, module, page_path
-- FROM page_catalog WHERE page_path IS NULL AND active_status = 1;
-- ────────────────────────────────────────────────────────────
