-- 1061_revoke_grants_for_unrouted_pages.sql
--
-- NOT EXECUTED. Prepared during release stabilisation 2026-08-03; requires review and a
-- controlled release window. Production runs SKIP_MIGRATIONS=true, so deploying does not
-- apply this — it must be applied deliberately.
--
-- Revokes role grants for sixteen page codes that have no page behind them.
--
-- Each was listed in a role's page array in rbacPageMatrix.ts while having no mounted route
-- anywhere in src/config/routes. A grant to a page that does not exist is not access; it is
-- dead RBAC surface. It inflates what a role appears to hold in every audit and access
-- review, it defeats the contract that verifies grants point at real pages, and — most
-- importantly — it is indistinguishable from a page whose route was deleted by accident.
-- That last case is exactly how WORKFORCE_COMMAND_CENTER sent eight roles to a 404 from
-- their own launcher without anyone noticing.
--
-- The matrix side is already removed in code. This closes the database side so the two
-- cannot disagree.
--
-- Deliberately NOT deleting the page_catalog rows. The catalog is a description of pages
-- the product knows about; several of these are incomplete features that are expected to
-- ship. Removing the grant withdraws access without destroying the definition, so restoring
-- a page later is a single INSERT into role_page_access alongside its route — not an
-- archaeology exercise.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — What this will revoke. Read before running.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0: grants to be revoked' AS report;
SELECT rpa.role_key,
       pc.page_code,
       pc.page_path,
       pc.active_status AS catalog_active
  FROM role_page_access rpa
  JOIN page_catalog pc ON pc.id = rpa.page_id
 WHERE pc.page_code IN (
         'ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
         'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','EMPLOYEE_JOINING_DOCUMENTS',
         'ENGAGEMENT_COMMAND_CENTER','HELPDESK_KB','ONBOARDING_REVIEW',
         'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
         'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT',
         'TEAM_ROSTER')
 ORDER BY pc.page_code, rpa.role_key;

-- Per-user overrides are separate from role grants and are reported too — revoking the
-- role grant while leaving a user override in place would leave one person holding access
-- that the matrix says nobody has.
SELECT 'Step 0b: per-user overrides on the same codes' AS report;
SELECT upa.user_id, pc.page_code
  FROM user_page_access upa
  JOIN page_catalog pc ON pc.id = upa.page_id
 WHERE pc.page_code IN (
         'ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
         'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','EMPLOYEE_JOINING_DOCUMENTS',
         'ENGAGEMENT_COMMAND_CENTER','HELPDESK_KB','ONBOARDING_REVIEW',
         'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
         'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT',
         'TEAM_ROSTER');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — Archive before revoking, so the grant set can be restored exactly.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_page_access_unrouted_archive_20260803 AS
  SELECT rpa.*, pc.page_code AS archived_page_code, NOW() AS archived_at
    FROM role_page_access rpa
    JOIN page_catalog pc ON pc.id = rpa.page_id
   WHERE pc.page_code IN (
           'ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
           'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','EMPLOYEE_JOINING_DOCUMENTS',
           'ENGAGEMENT_COMMAND_CENTER','HELPDESK_KB','ONBOARDING_REVIEW',
           'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
           'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT',
           'TEAM_ROSTER');

SELECT 'Step 1: archived' AS report,
       (SELECT COUNT(*) FROM role_page_access_unrouted_archive_20260803) AS rows_archived;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — Revoke. Keyed through the archive so only reviewed rows are touched.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE rpa
  FROM role_page_access rpa
  JOIN role_page_access_unrouted_archive_20260803 a
    ON a.id = rpa.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — Verify. Expect zero.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 3: grants remaining on unrouted pages (expect 0)' AS report;
SELECT COUNT(*) AS remaining
  FROM role_page_access rpa
  JOIN page_catalog pc ON pc.id = rpa.page_id
 WHERE pc.page_code IN (
         'ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
         'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','EMPLOYEE_JOINING_DOCUMENTS',
         'ENGAGEMENT_COMMAND_CENTER','HELPDESK_KB','ONBOARDING_REVIEW',
         'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
         'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT',
         'TEAM_ROSTER');

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback
-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT INTO role_page_access
--   SELECT <original column list> FROM role_page_access_unrouted_archive_20260803;
-- The archive carries every original column plus archived_page_code and archived_at, so
-- the restore is an explicit column projection — write it against the live DDL at the time
-- of rollback rather than assuming today's column order.
