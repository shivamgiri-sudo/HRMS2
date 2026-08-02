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
-- Deliberately NOT deleting the page_catalog rows. The catalog describes pages the product
-- knows about; several of these are incomplete features expected to ship. Removing the grant
-- withdraws access without destroying the definition, so restoring a page later is a single
-- INSERT alongside its route — not an archaeology exercise.
--
-- SCHEMA NOTE. An earlier draft of this file joined page_catalog on rpa.page_id. There is no
-- such column. role_page_access and user_page_access both key on page_code VARCHAR(100);
-- page_catalog has no inbound foreign key from either. Verified against
-- 003_access_control.sql, 100_user_page_access.sql, and every live query in
-- src/modules/access. The draft would have failed on the first statement — which is the
-- argument for Step 0 existing at all.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — What this will revoke. Read the output before running anything below.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0: role grants to be revoked' AS report;
SELECT rpa.role_key,
       rpa.page_code,
       rpa.can_view,
       rpa.active_status,
       (SELECT COUNT(*) FROM page_catalog pc WHERE pc.page_code = rpa.page_code) AS has_catalog_row
  FROM role_page_access rpa
 WHERE rpa.page_code IN (
         'ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
         'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','EMPLOYEE_JOINING_DOCUMENTS',
         'ENGAGEMENT_COMMAND_CENTER','HELPDESK_KB','ONBOARDING_REVIEW',
         'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
         'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT',
         'TEAM_ROSTER')
 ORDER BY rpa.page_code, rpa.role_key;

-- Per-user overrides live in a separate table and are reported too. Revoking the role grant
-- while leaving an override in place would leave one person holding access the matrix says
-- nobody has — the exact inconsistency this migration exists to remove.
SELECT 'Step 0b: per-user overrides on the same codes' AS report;
SELECT upa.user_id, upa.page_code, upa.active_status
  FROM user_page_access upa
 WHERE upa.page_code IN (
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
  SELECT rpa.*, NOW() AS archived_at
    FROM role_page_access rpa
   WHERE rpa.page_code IN (
           'ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
           'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','EMPLOYEE_JOINING_DOCUMENTS',
           'ENGAGEMENT_COMMAND_CENTER','HELPDESK_KB','ONBOARDING_REVIEW',
           'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
           'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT',
           'TEAM_ROSTER');

SELECT 'Step 1: archived' AS report,
       (SELECT COUNT(*) FROM role_page_access_unrouted_archive_20260803) AS rows_archived;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — Revoke. Keyed through the archive by id, so only the rows shown in Step 0 are
-- touched even if the table changes between running Step 1 and Step 2.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE rpa
  FROM role_page_access rpa
  JOIN role_page_access_unrouted_archive_20260803 a
    ON a.id = rpa.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — Verify. Expect zero.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 3: role grants remaining on unrouted pages (expect 0)' AS report;
SELECT COUNT(*) AS remaining
  FROM role_page_access
 WHERE page_code IN (
         'ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
         'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','EMPLOYEE_JOINING_DOCUMENTS',
         'ENGAGEMENT_COMMAND_CENTER','HELPDESK_KB','ONBOARDING_REVIEW',
         'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
         'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT',
         'TEAM_ROSTER');

-- Per-user overrides are reported, NOT deleted. Revoking a role grant is a policy change;
-- removing one person's explicit override is a decision about that person and belongs to
-- whoever granted it. If Step 0b returned rows, resolve them by hand.
SELECT 'Step 3b: per-user overrides still present (resolve by hand)' AS report;
SELECT COUNT(*) AS remaining_user_overrides
  FROM user_page_access
 WHERE page_code IN (
         'ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
         'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','EMPLOYEE_JOINING_DOCUMENTS',
         'ENGAGEMENT_COMMAND_CENTER','HELPDESK_KB','ONBOARDING_REVIEW',
         'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
         'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT',
         'TEAM_ROSTER');

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback
-- ─────────────────────────────────────────────────────────────────────────────
-- The archive carries every original column plus archived_at, so the restore is an explicit
-- column projection. Write it against the live DDL at the time of rollback rather than
-- assuming today's column order:
--
--   INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit,
--                                 can_delete, can_export, active_status, created_at)
--   SELECT id, role_key, page_code, can_view, can_create, can_edit,
--          can_delete, can_export, active_status, created_at
--     FROM role_page_access_unrouted_archive_20260803;
