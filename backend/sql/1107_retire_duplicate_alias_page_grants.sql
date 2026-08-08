-- 1107_retire_duplicate_alias_page_grants.sql
--
-- Retires 37 page grants that point at "alias" codes no route gates on, in the one case
-- where doing so is provably a no-op: the role ALREADY holds the canonical code for the
-- very same page.
--
-- Background. src/tests/page-catalog-route-drift.contract.test.ts records the result of an
-- earlier investigation — a set of page codes that resolve to a real, mounted page whose
-- route is already keyed to a DIFFERENT code in PAGE_CODE_BY_ROUTE. Its note says the real
-- fix is "consolidating the grant in rbacPageMatrix.ts onto the canonical code", left as a
-- follow-up because it touches live role grants. This is the safe half of that follow-up.
--
-- Alias -> canonical, taken from that test file rather than re-derived:
--   ATS_COMMAND_CENTER            -> ATS_DASHBOARD
--   ATS_INTERVIEW_APPROVALS       -> ATS_RECRUITER_QUEUE
--   ATS_INTERVIEW_QUEUE           -> ATS_RECRUITER_QUEUE
--   ATS_INTERVIEW_SUBMIT          -> ATS_RECRUITER_QUEUE
--   ATS_STATUTORY_ONBOARDING      -> ATS_JOINING_CONTROL_ROOM
--   EMPLOYEE_DASHBOARD            -> EMPLOYEE_MANAGEMENT
--   ONBOARDING_REQUESTS           -> ATS_ONBOARDING_REQUESTS
--   ONBOARDING_REVIEW             -> ATS_ONBOARDING_REQUESTS
--   ONBOARDING_SECTION_STATUS     -> ATS_ONBOARDING_REQUESTS
--   PAYROLL_ATTENDANCE_OVERRIDES  -> PAYROLL_ATTENDANCE_CONTROL_TOWER
--   PAYROLL_DASHBOARD             -> PAYROLL
--   PAYROLL_DEDUCTION_TYPES       -> PAYROLL_HO_QUEUES
--   PAYROLL_DEDUCTION_UPLOAD      -> PAYROLL_HO_QUEUES
--   PROVISIONING_APPOINTMENT      -> PROVISIONING_APPOINTMENT_LETTER
--
-- Why this is safe. The WHERE clause only touches an alias grant when the same role also
-- holds an active can_view grant on the canonical code. Such a role reaches the page today
-- through the canonical code — the alias contributes nothing, because no route gates on it.
-- What the alias DOES contribute is a duplicate tile in the module launcher pointing at a
-- path that either 404s or lands on a page the user already has. Removing it changes no
-- access and removes a broken duplicate.
--
-- NOT touched: 7 grants where the role holds ONLY the alias and not the canonical code.
-- Those are real access questions, not cleanup, and 1105 is the cautionary tale — 1097
-- "resolved" three of exactly that shape by granting the canonical code, without checking
-- the APIs behind the page accept the role, and had to be reverted. Left for review:
--   branch_payroll -> PAYROLL_DASHBOARD            (canonical PAYROLL)
--   finance_head   -> PAYROLL_DASHBOARD            (canonical PAYROLL)
--   hr_admin       -> PAYROLL_DEDUCTION_TYPES      (canonical PAYROLL_HO_QUEUES)
--   hr_admin       -> PAYROLL_DEDUCTION_UPLOAD     (canonical PAYROLL_HO_QUEUES)
--   interviewer    -> ATS_INTERVIEW_QUEUE          (canonical ATS_RECRUITER_QUEUE — verified
--                                                   REJECTED by every /api/ats/recruiter/*
--                                                   endpoint, so granting it would break)
--   interviewer    -> ATS_INTERVIEW_SUBMIT         (same)
--   payroll_admin  -> PAYROLL_ATTENDANCE_OVERRIDES (canonical PAYROLL_ATTENDANCE_CONTROL_TOWER)

UPDATE role_page_access al
  JOIN (
    SELECT 'ATS_COMMAND_CENTER' AS a, 'ATS_DASHBOARD' AS c UNION ALL
    SELECT 'ATS_INTERVIEW_APPROVALS','ATS_RECRUITER_QUEUE' UNION ALL
    SELECT 'ATS_INTERVIEW_QUEUE','ATS_RECRUITER_QUEUE' UNION ALL
    SELECT 'ATS_INTERVIEW_SUBMIT','ATS_RECRUITER_QUEUE' UNION ALL
    SELECT 'ATS_STATUTORY_ONBOARDING','ATS_JOINING_CONTROL_ROOM' UNION ALL
    SELECT 'EMPLOYEE_DASHBOARD','EMPLOYEE_MANAGEMENT' UNION ALL
    SELECT 'ONBOARDING_REQUESTS','ATS_ONBOARDING_REQUESTS' UNION ALL
    SELECT 'ONBOARDING_REVIEW','ATS_ONBOARDING_REQUESTS' UNION ALL
    SELECT 'ONBOARDING_SECTION_STATUS','ATS_ONBOARDING_REQUESTS' UNION ALL
    SELECT 'PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_ATTENDANCE_CONTROL_TOWER' UNION ALL
    SELECT 'PAYROLL_DASHBOARD','PAYROLL' UNION ALL
    SELECT 'PAYROLL_DEDUCTION_TYPES','PAYROLL_HO_QUEUES' UNION ALL
    SELECT 'PAYROLL_DEDUCTION_UPLOAD','PAYROLL_HO_QUEUES' UNION ALL
    SELECT 'PROVISIONING_APPOINTMENT','PROVISIONING_APPOINTMENT_LETTER'
  ) p ON p.a = al.page_code
  JOIN role_page_access can
    ON can.page_code = p.c
   AND can.role_key  = al.role_key
   AND can.active_status = 1
   AND can.can_view = 1
   SET al.active_status = 0
 WHERE al.active_status = 1
   AND al.can_view = 1;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Expect 0 — no alias grant should remain where the role also holds the canonical:
-- (re-run the SELECT form of the join above and confirm it returns nothing)
--
-- Expect 7 — the alias-only grants deliberately left alone:
-- SELECT role_key, page_code FROM role_page_access
--  WHERE active_status = 1 AND can_view = 1
--    AND page_code IN ('PAYROLL_DASHBOARD','PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD',
--                      'ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT','PAYROLL_ATTENDANCE_OVERRIDES');

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- UPDATE role_page_access SET active_status = 1
--  WHERE can_view = 1 AND page_code IN (
--    'ATS_COMMAND_CENTER','ATS_INTERVIEW_APPROVALS','ATS_INTERVIEW_QUEUE','ATS_INTERVIEW_SUBMIT',
--    'ATS_STATUTORY_ONBOARDING','EMPLOYEE_DASHBOARD','ONBOARDING_REQUESTS','ONBOARDING_REVIEW',
--    'ONBOARDING_SECTION_STATUS','PAYROLL_ATTENDANCE_OVERRIDES','PAYROLL_DASHBOARD',
--    'PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD','PROVISIONING_APPOINTMENT');
