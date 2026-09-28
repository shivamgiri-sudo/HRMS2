-- Migration 1777: Grant branch_head read access across the core WFM/roster/attendance
-- pages. Branch heads previously had page grants for only a handful of individual WFM
-- sub-pages (WFM_LIVE_TRACKER, WFM_ATTENDANCE_EXCEPTIONS, RTA_BOARD) despite owning
-- everything happening in their branch's WFM operations.
--
-- Deliberately excludes: TEAM_ATTENDANCE (deactivated org-wide, not a branch_head-specific
-- gap), WFM_ROSTER_MANAGER_QUEUE (page code has no mounted frontend route — granting it
-- reaches nothing), ATTENDANCE_LOOKUP (its backing API surfaces payslip/payroll
-- running-summary data alongside attendance — a payroll-adjacent exposure needing its own
-- explicit decision, not a blanket WFM grant), and the HQ/admin-only config pages
-- (WFM_ROSTER_BUILDER, WFM_BRANCH_SPOC_CONFIG, WFM_BREAK_DESK_DEVICES, WFM_EXTENSIONS) and
-- payroll/finance/provisioning pages (ATTENDANCE_BILLING_CONFIG, HR_ATTENDANCE_LOOKUP,
-- PAYROLL_ATTENDANCE_OVERRIDES, PAYROLL_ATTENDANCE_TOWER, ATTENDANCE_RULES_MASTER,
-- ATTENDANCE_MISMATCH_QUEUE, PROVISIONING_WFM_ALIGNMENT) that even branch_wfm does not hold.
--
-- Safe to replay: WHERE NOT EXISTS guards on the inserts, and the UPDATE only flips
-- existing inactive rows to active (idempotent).

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'WFM_DASHBOARD', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='WFM_DASHBOARD');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'WFM_ATTENDANCE_DASHBOARD', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='WFM_ATTENDANCE_DASHBOARD');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'WFM_ROSTER', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='WFM_ROSTER');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'WFM_PLANNING_RULES', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='WFM_PLANNING_RULES');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'WFM_SLOT_REQUIREMENTS', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='WFM_SLOT_REQUIREMENTS');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'WFM_WEEKOFF_DAY_RULES', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='WFM_WEEKOFF_DAY_RULES');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'WFM_WEEKOFF_FAIRNESS', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='WFM_WEEKOFF_FAIRNESS');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'ATTENDANCE_DISPUTES', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='ATTENDANCE_DISPUTES');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'ATTENDANCE_REGULARIZATION', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='ATTENDANCE_REGULARIZATION');

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'branch_head', 'ROSTER_MASTER', 1, 0, 0, 0, 0, 1
WHERE NOT EXISTS (SELECT 1 FROM role_page_access WHERE role_key='branch_head' AND page_code='ROSTER_MASTER');

-- Reactivate previously-granted-then-disabled rows rather than inserting duplicates.
UPDATE role_page_access SET active_status = 1
 WHERE role_key = 'branch_head' AND page_code = 'WFM_AUTO_ROSTER' AND active_status = 0;
