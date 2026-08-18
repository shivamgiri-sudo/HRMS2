-- Migration 1236: reactivate payroll_hr's ATS_ONBOARDING_REQUESTS page grant.
--
-- Follow-up to migration 1235 (branch_hr/payroll_head resend-onboarding-link access). While
-- fixing that, found payroll_hr already passes requireRole on POST /send-token/:candidateId
-- and GET /requests (it's been in the requireRole(...) list since migration 1005), but was
-- missing from the row-scope check array on both routes -- so every resend attempt was
-- silently 403'd despite the route accepting the role. Fixed in the same code change as
-- migration 1235.
--
-- Separately, and independently of that code bug: payroll_hr's role_page_access row for
-- ATS_ONBOARDING_REQUESTS (created 2026-07-22 by migration 1005) is active_status = 0 in
-- production today. Checked every migration touching payroll_hr or ATS_ONBOARDING_REQUESTS
-- (1005, 1097, 1104, 1105, 1230, 271, 345) for a deliberate deactivation -- found none. No
-- record of this being an intentional restriction, so treated as drift, not a decision to
-- respect. If it turns out to have been deliberate, the fix is a straightforward
-- UPDATE role_page_access SET active_status = 0 WHERE role_key='payroll_hr' AND
-- page_code='ATS_ONBOARDING_REQUESTS' to revert.
--
-- payroll_hr is added to backend/src/shared/rbacPageMatrix.ts's ROLE_SPECIFIC_PAGE_CODES in
-- the same change (it was already a key there for other pages), so a future
-- apply-rbac-page-matrix.mjs run treats this as intended rather than drift.
--
-- Additive/idempotent only: touches exactly one existing row, no DROP/DELETE.

UPDATE role_page_access
   SET active_status = 1
 WHERE role_key = 'payroll_hr'
   AND page_code = 'ATS_ONBOARDING_REQUESTS'
   AND active_status = 0;
