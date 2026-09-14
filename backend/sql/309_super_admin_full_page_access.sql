-- ============================================================
-- Migration 309: Super-admin full page access grant
-- Adds missing role_page_access rows for super_admin,
-- enables three rows that were mistakenly set to all-zero,
-- and registers the email-template bulk-import page.
-- Safe to run multiple times (INSERT IGNORE / ON DUPLICATE KEY).
-- ============================================================

-- 1. Pages that exist in page_catalog but had NO role_page_access row
--    for super_admin. Grant full permissions on all of them.
INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin', 'CANDIDATE_ONBOARDING_FULL',  1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'ONBOARDING_BGV',             1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'ONBOARDING_REQUESTS',        1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'ONBOARDING_REVIEW',          1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'ONBOARDING_SECTION_STATUS',  1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'COACHING',                   1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'TEAM_ATTENDANCE',            1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'TEAM_ROSTER',                1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'SALARY_PROPOSAL_QUEUE',      1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'SALARY_SLAB_MASTER',         1,1,1,1,1, 1, NOW()),
  (UUID(), 'super_admin', 'WEEK_OFF_PREFERENCES',       1,1,1,1,1, 1, NOW());

-- 2. Three rows that already exist but have can_view=0 — enable fully.
UPDATE role_page_access
SET can_view=1, can_create=1, can_edit=1, can_delete=1, can_export=1
WHERE role_key='super_admin'
  AND page_code IN ('GRIEVANCE_COMMAND_CENTER','PEOPLE_EXPERIENCE_COMMAND_CENTER','SUPPORT_COMMAND_CENTER')
  AND active_status=1;

-- 3. Register the email-template bulk-import page (built in migration 308).
--    INSERT IGNORE so re-runs are harmless.
INSERT IGNORE INTO page_catalog
  (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'EMAIL_TEMPLATE_BULK_IMPORT', 'Email Template Bulk Import',
   '/settings/email-templates/bulk-import', 'Admin',
   'Bulk import email templates from Excel/CSV', 1, NOW());

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin', 'EMAIL_TEMPLATE_BULK_IMPORT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',       'EMAIL_TEMPLATE_BULK_IMPORT', 1,1,1,1,1, 1, NOW());

-- 4. Record this migration as applied
INSERT IGNORE INTO schema_migrations (filename, applied_at)
VALUES ('309_super_admin_full_page_access.sql', NOW());
