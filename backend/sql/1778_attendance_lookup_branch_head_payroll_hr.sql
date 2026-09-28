-- Migration 1778: Grant ATTENDANCE_LOOKUP page access to branch_head and payroll_hr.
--
-- Owner-specified access list, 2026-09-16: "Attendance Lookup - branch WFM, Branch head,
-- Branch Payroll HR, Payroll head (All branch) and super admin (All branch)". Of these,
-- branch_wfm, payroll_head and super_admin already held the grant; only branch_head and
-- payroll_hr ("Branch Payroll HR" — the live, actually-used role; the legacy
-- "branch_payroll" role_key has zero active users in user_roles) were missing.
--
-- Row scoping to "their branch" vs "all branch" is not decided here: it already comes from
-- each user's own user_assignment_scope row via buildScopeWhereClause (employee.routes.ts
-- hr-hub endpoints) — branch_head/branch_wfm and most payroll_hr accounts hold
-- scope_type='branch', payroll_head and a few payroll_hr accounts hold scope_type='all'.
-- This migration only opens the page; matching code changes add branch_head/branch_wfm/
-- payroll_hr to the hr-hub routes' requireRole + buildScopeWhereClause allowedRoles, and to
-- AdminAttendanceView.tsx's ALLOWED_ROLES.
--
-- Safe to replay: WHERE NOT EXISTS guards, no unique key on this table.

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'ATTENDANCE_LOOKUP', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='ATTENDANCE_LOOKUP');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'payroll_hr', 'ATTENDANCE_LOOKUP', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='payroll_hr' AND page_code='ATTENDANCE_LOOKUP');
