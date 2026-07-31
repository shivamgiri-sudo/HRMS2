-- 1027_ceo_my_kpi_revoke.sql
--
-- Removes the "My KPI" self-service page from the CEO role.
--
-- The CEO is not measured on operational KPIs, so /my-kpi has nothing to show him.
-- The CEO UAT of 31-Jul-2026 reported the page as hollow — all three KPIs reading
-- em-dash, "No data available for this period", Overall Score 0%, and a footer of
-- "3 KPIs Tracked, 0 With Data". The correct fix is to stop offering the page, not
-- to make an empty one render better.
--
-- MY_KPI is in COMMON_USER_PAGE_CODES, a blanket grant to every role, and it is
-- separately present in role_page_access for 24 roles. Both layers must agree:
--   - the code-side union is handled by ROLE_EXCLUDED_PAGE_CODES in
--     backend/src/shared/rbacPageMatrix.ts
--   - the database grant is revoked here, because /api/access/me reads
--     role_page_access at runtime and would otherwise keep the page visible
--
-- Scope is deliberately narrow: ONLY the ceo row. The other 23 roles keep MY_KPI —
-- agents, team leaders, QA and ops staff are measured on KPIs and the page is
-- meaningful for them. can_view is set to 0 rather than the row being deleted, so
-- the grant is auditable and trivially reversible.
--
-- SEPARATE ISSUE, NOT ADDRESSED HERE — the CEO has KPI data he should not have.
-- As of 31-Jul-2026, employee MAS00001 carries 3 rows in kpi_employee_resolved and
-- 28 in kpi_daily_actual, because KPI assignment resolves by process and the CEO is
-- attached to one. Hiding the page does not stop those rows being written, and they
-- also feed the org-wide leaderboard and its averages. Fixing that means changing
-- how KPI assignment resolves for non-operational roles, which needs an owner.
--
-- Additive and idempotent. Updates at most one row. Creates nothing, drops nothing.
--
-- NOT EXECUTED AUTOMATICALLY. Review, then run against the target schema.

UPDATE role_page_access
   SET can_view   = 0,
       can_create = 0,
       can_edit   = 0,
       can_delete = 0,
       can_export = 0
 WHERE role_key  = 'ceo'
   AND page_code = 'MY_KPI';

-- Verification after running:
--   SELECT role_key, page_code, can_view
--     FROM role_page_access
--    WHERE page_code = 'MY_KPI' AND role_key = 'ceo';
--   -- expected: can_view = 0
--
--   SELECT COUNT(*) AS roles_retaining_my_kpi
--     FROM role_page_access
--    WHERE page_code = 'MY_KPI' AND can_view = 1;
--   -- expected: 23 (was 24)
