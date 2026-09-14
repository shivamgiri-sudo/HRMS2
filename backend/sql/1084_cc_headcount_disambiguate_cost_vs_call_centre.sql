-- 1084_cc_headcount_disambiguate_cost_vs_call_centre.sql
--
-- Renames the CC_HEADCOUNT report so its name says which "CC" it means.
--
-- Why: the report is registered as "Call Centre Headcount" and groups by
-- call_centre_code — the dialer/biometric integration key. Users read "CC" as cost
-- centre and consumed it as a cost-centre headcount, which it has never been. The
-- finance cost centre lives on employees.cost_centre_id -> cost_centre_master, and is
-- served by the separate `cost-centre-headcount` report in the report suite.
--
-- Verified against mas_hrms on 2026-08-07:
--   * employees.call_centre_code is NULL in ALL 58,627 rows, so the report's
--     COALESCE(e.call_centre_code, b.call_centre_code) always resolves to the branch
--     value (populated on 42 of 45 branches). It is a branch-grained report.
--   * the query carried no active_status filter, so it returned 58,627 against a true
--     active headcount of 1,125 — a 52x overstatement. Fixed in
--     reporting.service.ts (cc_headcount) alongside this migration.
--   * cost_centre_master has 927 rows (573 active) and 1,061 of 1,125 active employees
--     resolve to one — i.e. real cost-centre reporting was always possible, just not
--     from this report.
--
-- Name only. The report_code, query_key, category and permissions are untouched, so
-- every existing link, saved filter and role grant keeps working. No row is deleted.
-- Idempotent and safe to re-run.
--
-- ⚠ Production runs with SKIP_MIGRATIONS=true, so a deploy applies nothing. This file
-- must be run explicitly for the rename to reach users; the code-side headcount fix is
-- independent of it and takes effect on deploy.

UPDATE report_master
   SET report_name = 'Call Centre (Dialer) Headcount'
 WHERE report_code = 'CC_HEADCOUNT'
   AND report_name <> 'Call Centre (Dialer) Headcount';

SELECT CONCAT(
         'Migration 1084 applied: CC_HEADCOUNT now named "',
         report_name,
         '" (groups by call_centre_code, not cost centre)'
       ) AS status
  FROM report_master
 WHERE report_code = 'CC_HEADCOUNT';
