-- ============================================================================
-- ATS Hiring Entry — HR Domain Access Grant
-- ============================================================================
-- Purpose: Grant HR domain roles (hr, branch_head) access to ATS_RECRUITER_QUEUE
--          page code so they can view and manage hiring entry pages.
--
-- Requirement: All HR domain users (HR Manager, Branch Heads) and Super Admin
--              should be able to access /ats/recruiter/hiring-entry.
--
-- Security: Backend row-level access control in recruiter-hiring.routes.ts
--           ensures users can only access:
--           1. Records they created (recruiters)
--           2. Full access for privileged roles (admin, hr, super_admin, branch_head)
--           3. Branch-scoped access for same-branch users
-- ============================================================================

-- Grant HR domain roles access to ATS_RECRUITER_QUEUE
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  ('hr', 'ATS_RECRUITER_QUEUE', 1, 1, 1, 0, 1),
  ('branch_head', 'ATS_RECRUITER_QUEUE', 1, 1, 1, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1;

-- Note: The requireRole middleware in recruiter-hiring.routes.ts restricts
--       access to: admin, hr, super_admin, recruiter, branch_head only.
