-- 1108_retire_alias_only_page_grants.sql
--
-- Retires the last 7 "alias" page grants — codes no route gates on — held by roles that do
-- NOT also hold the canonical code. 1107 cleared the 37 where the role held both (pure
-- duplicates); these are the remainder, and each needed deciding rather than sweeping.
--
-- The question for each was: grant the canonical code (restoring evident intent), or retire
-- the alias (recording that the access was never real)? 1105 is the reason that question is
-- asked at all — 1097 answered it by granting, without checking whether the page's APIs and
-- route accept the role, and had to be reverted. So each was checked against the thing that
-- actually decides access, and all seven came out the same way: retire.
--
--   interviewer -> ATS_INTERVIEW_QUEUE, ATS_INTERVIEW_SUBMIT   (canonical ATS_RECRUITER_QUEUE)
--     All six endpoints /ats/recruiter/my-candidates calls require
--     admin | hr | super_admin | recruiter. `interviewer` is on none, so granting the
--     canonical code hands 9 interviewers a page where every request 403s.
--
--   hr_admin -> PAYROLL_DEDUCTION_TYPES, PAYROLL_DEDUCTION_UPLOAD  (canonical PAYROLL_HO_QUEUES)
--     /payroll/ho-queues declares roles
--     ['super_admin','payroll_head','payroll','finance','hr','admin'] — hr_admin is absent.
--     Worth flagging: these two aliases are 2 of hr_admin's 3 active grants, so whatever
--     that role was meant to do is almost entirely dead. Granting HO queues is a payroll
--     access decision and is left for review rather than inferred.
--
--   payroll_admin -> PAYROLL_ATTENDANCE_OVERRIDES  (canonical PAYROLL_ATTENDANCE_CONTROL_TOWER)
--     /payroll/attendance-control-tower declares roles
--     ['super_admin','admin','payroll_head','payroll_branch','payroll','hr','wfm','branch_head']
--     — payroll_admin is absent.
--
--   branch_payroll, finance_head -> PAYROLL_DASHBOARD  (canonical PAYROLL)
--     PAYROLL_DASHBOARD's page_catalog row is active_status = 0, so these grants are dead
--     twice over: no route gates on the code, and the page is switched off. Both roles
--     already hold deep payroll access (finance_head has PAYROLL_SIGN_OFF, PAYROLL_DISBURSAL,
--     PAYROLL_COST_SUMMARY; branch_payroll has PAYROLL_BRANCH_READINESS, PAYROLL_INCENTIVES,
--     PAYROLL_LOANS), so granting the main PAYROLL page may well be right — but it is an
--     expansion on a charter-sensitive surface, so it is a decision to take deliberately.
--
-- Nobody loses reachable access: every grant retired here points at a code no route gates
-- on, so it conferred nothing before this ran.

UPDATE role_page_access
   SET active_status = 0
 WHERE active_status = 1
   AND can_view = 1
   AND (
        (role_key = 'interviewer'    AND page_code IN ('ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT'))
     OR (role_key = 'hr_admin'       AND page_code IN ('PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD'))
     OR (role_key = 'payroll_admin'  AND page_code = 'PAYROLL_ATTENDANCE_OVERRIDES')
     OR (role_key IN ('branch_payroll','finance_head') AND page_code = 'PAYROLL_DASHBOARD')
   );

-- ─── Verification (expect 0) ──────────────────────────────────────────────────
-- SELECT role_key, page_code FROM role_page_access
--  WHERE active_status = 1 AND can_view = 1
--    AND ((role_key='interviewer'   AND page_code IN ('ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT'))
--      OR (role_key='hr_admin'      AND page_code IN ('PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD'))
--      OR (role_key='payroll_admin' AND page_code='PAYROLL_ATTENDANCE_OVERRIDES')
--      OR (role_key IN ('branch_payroll','finance_head') AND page_code='PAYROLL_DASHBOARD'));

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- Restores the dead aliases; only sensible if the canonical grant is being reconsidered.
-- UPDATE role_page_access SET active_status = 1
--  WHERE can_view = 1
--    AND ((role_key='interviewer'   AND page_code IN ('ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT'))
--      OR (role_key='hr_admin'      AND page_code IN ('PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD'))
--      OR (role_key='payroll_admin' AND page_code='PAYROLL_ATTENDANCE_OVERRIDES')
--      OR (role_key IN ('branch_payroll','finance_head') AND page_code='PAYROLL_DASHBOARD'));
