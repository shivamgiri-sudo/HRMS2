-- 1233_org_masters_hr_write_permission.sql
-- Closes a gap left by 1231's deliberately conservative view-only default: 1231's own header
-- says "write-capability parity with each page's backend guard was not individually verified".
-- This migration is that individual verification for ORG_MASTERS/hr specifically.
--
-- Verified live (2026-08-18, go-live readiness UAT continuation session): every write endpoint
-- backing ORG_MASTERS already accepts the hr role today --
--   backend/src/modules/org/org.routes.ts:
--     line 51  router.post(path, requireRole("admin", "hr"), ...)          -- create
--     line 55  router.put(`${path}/:id`, requireRole("admin", "hr"), ...)  -- edit
--     line 59  router.delete(`${path}/:id`, requireRole("admin"), ...)     -- delete: admin only, NOT hr
--     line 64  router.patch(`${path}/:id/status`, requireRole("admin", "hr"), ...) -- status toggle
--     line 235 router.post("/cost-centres", requireRole("admin", "hr"), ...)
--     line 240 router.put("/cost-centres/:id", requireRole("admin", "hr"), ...)
--     line 251 router.delete("/cost-centres/:id", requireRole("admin"), ...) -- delete: admin only, NOT hr
--     line 256 router.patch("/cost-centres/:id/status", requireRole("admin", "hr"), ...)
--
-- So the backend's own authorization boundary for hr on this page is: create=yes, edit=yes,
-- status-toggle=yes, delete=no. role_page_access.can_delete has no column write here on purpose
-- -- it already defaults to whatever 1231 set (0), which is the CORRECT value for hr (the
-- backend genuinely refuses hr on DELETE), so nothing to change there. Only can_create and
-- can_edit are updated, to align the DB grant with the backend contract exactly -- neither
-- widening beyond what the backend already accepts, nor leaving the DB more restrictive than
-- the backend for no reason (the brief's own instruction: "DB grants and backend capabilities
-- agree exactly").
--
-- Additive and idempotent: UPDATE only, guarded on the existing row (inserted by 1231),
-- no DROP, no DELETE, does not touch can_view/can_delete/active_status.

UPDATE role_page_access
   SET can_create = 1,
       can_edit   = 1
 WHERE page_code = 'ORG_MASTERS'
   AND role_key  = 'hr';

SELECT '1233_org_masters_hr_write_permission.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET can_create = 0, can_edit = 0
--   WHERE page_code = 'ORG_MASTERS' AND role_key = 'hr';
