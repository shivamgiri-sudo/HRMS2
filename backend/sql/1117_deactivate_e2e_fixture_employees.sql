-- Migration: deactivate the ten E2E fixture employees that are counted as live headcount
-- Date: 2026-08-09
--
-- WHAT IS WRONG
--   Ten rows in `employees` are E2E test fixtures carrying active_status = 1, so the
--   platform counts them as working staff. Verified read-only against production
--   2026-08-09 -- MAS36039 .. MAS36048, created 2026-06-07/08, every one of them:
--
--     * named "Test <role> E2E <timestamp>" (one is "Test Payroll Employee")
--     * logging in as ...@e2etest.local (one as payroll.test@example.com)
--     * branch_id NULL -- they were the entire remainder of the "active employee with
--       no valid branch" population after 1115 reactivated Delhi and Mumbai
--     * 39 attendance_daily_record rows each, plus roster assignments and 3 leave
--       requests between them, so they are not inert -- they generate operational data
--     * ZERO salary_prep_line rows, so no payroll has ever been computed for them
--
--   Effect: active headcount reads 1,127 when the real figure is 1,112, and the fixtures
--   pollute attendance and roster analytics. The charter is explicit that demo/test data
--   must be isolated and must not appear in production metrics.
--
-- WHY ONLY THESE TEN
--   Fifteen active rows look like test data. The other five are deliberately left alone:
--
--     MAS62916/62917/62919/62920  "Codex E2E Candidate", branch NOIDA-2, and each has
--                                 2 salary_prep_line rows -- they are inside payroll
--                                 runs. Payroll is read-only here; deactivating a row
--                                 that payroll has already costed is not a cleanup.
--     MAS62914                    "Jeera Test", sits on a real branch (Head Office).
--
--   The ten below are separable precisely because they have no branch and no payroll.
--
-- SAFETY
--   Deactivation, not deletion. Their attendance, roster and leave history stays intact
--   and simply belongs to an inactive employee, which is the ordinary state for anyone
--   who has left. Fully reversible.
--
--   The NOT EXISTS guard is the important one: if any of these ever acquires a payroll
--   line, this migration silently declines to touch that row rather than deactivating
--   someone payroll has costed. Combined with the employee_code list and the e2etest
--   email match, it cannot reach a real employee.
--
--   Nothing in the repository depends on these rows: the only reference to
--   "e2etest.local" anywhere is a comment in job-requisition.service.ts, and no code or
--   test references the employee codes. They do hold auth_user logins, so if an E2E
--   pipeline outside this repository authenticates as them and requires an ACTIVE
--   employee, re-activate with the rollback below.
--
-- ROLLBACK
--   UPDATE employees SET active_status = 1
--    WHERE employee_code IN ('MAS36039','MAS36040','MAS36041','MAS36042','MAS36043',
--                            'MAS36044','MAS36045','MAS36046','MAS36047','MAS36048');
--
-- Idempotent: the active_status = 1 predicate means a re-run matches nothing.

UPDATE employees e
   SET e.active_status = 0,
       e.updated_at = NOW()
 WHERE e.employee_code IN (
         'MAS36039','MAS36040','MAS36041','MAS36042','MAS36043',
         'MAS36044','MAS36045','MAS36046','MAS36047','MAS36048'
       )
   AND e.active_status = 1
   AND e.branch_id IS NULL
   AND (
         COALESCE(e.official_email, e.email) LIKE '%@e2etest.local'
      OR COALESCE(e.official_email, e.email) = 'payroll.test@example.com'
       )
   AND NOT EXISTS (
         SELECT 1 FROM salary_prep_line s WHERE s.employee_id = e.id
       );

-- Verification -- expects 0 rows (every fixture now inactive):
--   SELECT employee_code FROM employees
--    WHERE employee_code LIKE 'MAS3604%' AND active_status = 1;
--
-- And the "active employee with no valid branch" population should reach 0:
--   SELECT COUNT(*) FROM employees e
--     LEFT JOIN branch_master bm ON bm.id = e.branch_id
--    WHERE e.active_status = 1 AND (bm.id IS NULL OR bm.active_status = 0);
--
-- Active headcount should fall 1,127 -> 1,117 (the remaining 5 test rows are the
-- payroll-bearing ones deliberately left active).
