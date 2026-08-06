-- 1084_job_requisition_interviewer_grant_removal.sql
--
-- Removes the JOB_REQUISITION page grant from `interviewer`.
--
-- Why: role_page_access granted JOB_REQUISITION to 11 roles, but /api/job-requisition
-- allows only a subset. Four roles could open the page and then had every list call
-- rejected — recruiter (16 users), manager (7), assistant_manager (2) and interviewer (9).
--
-- Three of those four are fixed in code by widening REQUISITION_READ_ROLES, because their
-- workflow clearly requires the data: assistant_manager could already POST / and PATCH /:id
-- (create a requisition, then not see it), and recruiter was already allowed on
-- /processes-for-branch and /open-for-branch with job_requisition.owner_recruiter_id
-- pointing at them.
--
-- `interviewer` is the exception. It appears in NO endpoint in job-requisition.routes.ts —
-- not one of the 27. The grant, not the guards, is the outlier. Interviewers assess
-- candidates; they have no need for an org-wide requisition list, which is unscoped
-- (listRequisitions applies no branch/process filter) and exposes salary_min/salary_max.
--
-- Nothing is lost by this: the page already 403s for every interviewer, so it is
-- non-functional for them today. This only stops the menu entry advertising a page that
-- cannot work. Reversible — see the rollback at the bottom.

UPDATE role_page_access
   SET active_status = 0
 WHERE page_code = 'JOB_REQUISITION'
   AND role_key = 'interviewer'
   AND active_status = 1;

-- ─── Verification (expect interviewer absent; 10 roles remaining) ─────────────
-- SELECT role_key, can_view, active_status
--   FROM role_page_access
--  WHERE page_code = 'JOB_REQUISITION' AND active_status = 1
--  ORDER BY role_key;

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- UPDATE role_page_access SET active_status = 1
--  WHERE page_code = 'JOB_REQUISITION' AND role_key = 'interviewer';
