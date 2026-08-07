-- 1097_page_code_alias_grant_reconciliation.sql
--
-- Reconciles role_page_access grants that point at "alias" page codes — codes present in
-- page_catalog and granted to roles, but which no route in the app gates on. The grant is
-- active and looks real in the access matrix, yet confers nothing: the route the alias
-- describes is gated on a different code.
--
-- Found by cross-referencing every granted page_code against the codes actually used by
-- src/config/routes/*.tsx and src/lib/pageRoutePageCodes.ts (2026-08-07): 34 granted codes
-- had no route mapping; 23 of those resolve, by path, to a real gated code; 13 role/code
-- pairs were the only grant that role held for that page, so those users were locked out
-- of a page someone had deliberately granted them.
--
-- Resolved in two directions, deliberately not one:
--
--   Step 1 GRANTS the real code where the role's job plainly requires the page. These
--   users are locked out today of something they were meant to have.
--
--   Step 2 DEACTIVATES the dead EMPLOYEES alias rather than granting
--   EMPLOYEE_MANAGEMENT. /employees is the full employee directory — PII — and honouring
--   the alias literally would hand it to ~22 more people across six roles as a side effect
--   of a data-hygiene fix. Nobody loses access: the EMPLOYEES grant already confers
--   nothing. If wfm/qa/payroll should have the directory, grant EMPLOYEE_MANAGEMENT
--   deliberately; do not let it arrive by accident.
--
-- Alias rows other than EMPLOYEES are left active. They are inert, and they record the
-- original intent next to the corrective grant in step 1.
--
-- Additive and idempotent apart from the six targeted deactivations, each of which is
-- reversible — see the rollback at the bottom.

-- ─── Step 1: grant the real code where the alias was blocking real work ───────
INSERT INTO role_page_access
  (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  -- interviewer held ATS_INTERVIEW_QUEUE / ATS_INTERVIEW_SUBMIT; /ats/recruiter/my-candidates
  -- is gated on ATS_RECRUITER_QUEUE. 9 users.
  ('interviewer',   'ATS_RECRUITER_QUEUE',      1, 0, 0, 0, 0, 1),
  -- branch_head held ATS_COMMAND_CENTER; /ats/command-center is gated on ATS_DASHBOARD. 7 users.
  ('branch_head',   'ATS_DASHBOARD',            1, 0, 0, 0, 1, 1),
  -- payroll_hr held EMPLOYEE_EPF_COMPLIANCE; the page is PAYROLL_EPF_COMPLIANCE. 6 users.
  ('payroll_hr',    'PAYROLL_EPF_COMPLIANCE',   1, 0, 0, 0, 1, 1),
  -- finance_head/accounts_head held SALARY_REGISTER / SALARY_PROPOSAL_APPROVALS, which are
  -- tabs of /ats/joining-control-room, gated on ATS_JOINING_CONTROL_ROOM.
  ('finance_head',  'ATS_JOINING_CONTROL_ROOM', 1, 0, 0, 0, 1, 1),
  ('accounts_head', 'ATS_JOINING_CONTROL_ROOM', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = 1,
  active_status = 1;

-- ─── Step 2: retire the dead EMPLOYEES alias (confers nothing today) ──────────
UPDATE role_page_access
   SET active_status = 0
 WHERE page_code = 'EMPLOYEES'
   AND active_status = 1
   AND role_key IN ('wfm', 'qa', 'payroll', 'accounts_head', 'tq_head', 'finance_head');

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Expect 5 rows, all can_view=1:
-- SELECT role_key, page_code FROM role_page_access
--  WHERE active_status=1 AND can_view=1
--    AND (role_key,page_code) IN (('interviewer','ATS_RECRUITER_QUEUE'),
--        ('branch_head','ATS_DASHBOARD'),('payroll_hr','PAYROLL_EPF_COMPLIANCE'),
--        ('finance_head','ATS_JOINING_CONTROL_ROOM'),('accounts_head','ATS_JOINING_CONTROL_ROOM'));
-- Expect 0 rows:
-- SELECT role_key FROM role_page_access
--  WHERE page_code='EMPLOYEES' AND active_status=1
--    AND role_key IN ('wfm','qa','payroll','accounts_head','tq_head','finance_head');

-- ─── Rollback ─────────────────────────────────────────────────────────────────
-- UPDATE role_page_access SET active_status=1
--  WHERE page_code='EMPLOYEES'
--    AND role_key IN ('wfm','qa','payroll','accounts_head','tq_head','finance_head');
-- UPDATE role_page_access SET active_status=0
--  WHERE (role_key,page_code) IN (('interviewer','ATS_RECRUITER_QUEUE'),
--        ('branch_head','ATS_DASHBOARD'),('payroll_hr','PAYROLL_EPF_COMPLIANCE'),
--        ('finance_head','ATS_JOINING_CONTROL_ROOM'),('accounts_head','ATS_JOINING_CONTROL_ROOM'));
