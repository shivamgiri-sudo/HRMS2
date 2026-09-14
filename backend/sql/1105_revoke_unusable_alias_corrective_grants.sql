-- 1105_revoke_unusable_alias_corrective_grants.sql
--
-- Reverts 3 of the 5 corrective grants made by 1097. Self-correction.
--
-- 1097 resolved "alias" page codes — grants pointing at codes no route gates on — by
-- granting the real code the alias's page_path resolved to. That reasoning was sound for
-- two of them and wrong for three: it checked that the page would OPEN, but not that the
-- APIs behind the page would ANSWER. Three roles were therefore handed a page on which
-- every request 403s, which is precisely the page-gate-vs-API drift 1097 set out to fix.
--
-- Verified against the routers on 2026-08-08:
--
--   interviewer -> ATS_RECRUITER_QUEUE  (/ats/recruiter/my-candidates)
--     Every endpoint the page calls — /recruiter/my-candidates, /submission-history,
--     /daily-stats, /my-performance, /other-pending, /recruiter-roster/active — requires
--     admin | hr | super_admin | recruiter. `interviewer` is on none of them. Reverting
--     rather than adding interviewer to seven recruiter endpoints: that page is the
--     recruiter workspace, and widening it is a real access decision, not a data-hygiene
--     fix inferred from an alias's page_path.
--
--   finance_head  -> ATS_JOINING_CONTROL_ROOM
--   accounts_head -> ATS_JOINING_CONTROL_ROOM
--     joining-control-room.routes.ts guards the whole router with
--     ["super_admin","admin","hr","payroll_hr","branch_head","finance","operations_manager","it"].
--     Note `finance` is present but `finance_head` and `accounts_head` are distinct role
--     keys and are not. Their aliases (SALARY_REGISTER, SALARY_PROPOSAL_APPROVALS) pointed
--     at ?tab= views of that page, so there may well be a real intent to include them —
--     but that means editing the router's role list, which is an access decision for a
--     human, not something to infer.
--
-- KEPT from 1097, both confirmed working end to end:
--   branch_head -> ATS_DASHBOARD  — atsFullParityRouter's /web-data, /queue and /journey
--                                   all list branch_head.
--   payroll_hr  -> PAYROLL_EPF_COMPLIANCE — employeeJoiningDocumentsRouter applies only
--                                   requireAuth, so the page's calls succeed.
--
-- Nobody loses working access: before 1097 all three roles held only a dead alias, so
-- their effective access was nil. This restores that state rather than leaving a page that
-- opens and then fails.

UPDATE role_page_access
   SET active_status = 0
 WHERE active_status = 1
   AND (
        (role_key = 'interviewer'   AND page_code = 'ATS_RECRUITER_QUEUE')
     OR (role_key = 'finance_head'  AND page_code = 'ATS_JOINING_CONTROL_ROOM')
     OR (role_key = 'accounts_head' AND page_code = 'ATS_JOINING_CONTROL_ROOM')
   );

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Expect 0 rows:
-- SELECT role_key, page_code FROM role_page_access
--  WHERE active_status = 1
--    AND ((role_key='interviewer'   AND page_code='ATS_RECRUITER_QUEUE')
--      OR (role_key IN ('finance_head','accounts_head') AND page_code='ATS_JOINING_CONTROL_ROOM'));
-- Expect 2 rows (the grants 1097 got right):
-- SELECT role_key, page_code FROM role_page_access
--  WHERE active_status = 1
--    AND ((role_key='branch_head' AND page_code='ATS_DASHBOARD')
--      OR (role_key='payroll_hr'  AND page_code='PAYROLL_EPF_COMPLIANCE'));

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- Only sensible alongside adding these roles to the corresponding router guards.
-- UPDATE role_page_access SET active_status = 1
--  WHERE (role_key='interviewer'   AND page_code='ATS_RECRUITER_QUEUE')
--     OR (role_key IN ('finance_head','accounts_head') AND page_code='ATS_JOINING_CONTROL_ROOM');
