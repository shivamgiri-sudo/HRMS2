-- 1062_seed_module_launcher_and_mcnmeet_pages.sql
--
-- NOT EXECUTED. Prepared during release stabilisation 2026-08-03.
--
-- Two page codes are referenced by the running application but appear in no SQL migration,
-- so no page_catalog row has ever been created for either:
--
--   MODULE_LAUNCHER  granted to assistant_manager, interviewer, payroll_admin and recruiter
--                    in rbacPageMatrix.ts, and mounted at /modules. Four roles hold a grant
--                    for a page the catalog does not know exists.
--   MCNMEET          mounted at its route and present in the sidebar, added by 1049, but
--                    that migration seeds no catalog row and no role holds a grant.
--
-- Both are real, working pages. This is the inverse of 1061: there the grant existed without
-- a page, here the page exists without a catalog row.
--
-- Why it matters beyond a red test: page_catalog is what ModuleLauncher reads to decide
-- where to send a user, and what every access review reports from. A page absent from it is
-- invisible to governance while being fully reachable in the product.
--
-- Grants deliberately mirror rbacPageMatrix.ts rather than inventing a role set. MCNMEET is
-- seeded as a catalog row with NO grants, because no role is granted it in the matrix today
-- — seeding access nobody asked for would be inventing policy inside a migration.
--
-- SCHEMA NOTE. An earlier draft used page_catalog.module_code and role_page_access.page_id.
-- Neither column exists. page_catalog's column is `module`, and role_page_access keys on
-- page_code VARCHAR(100) with no foreign key to page_catalog at all. Verified against
-- 100_user_page_access.sql, 003_access_control.sql and the live queries in
-- src/modules/access.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — Current state
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0: existing rows for these codes (expect none)' AS report;
SELECT page_code, page_path, active_status
  FROM page_catalog
 WHERE page_code IN ('MODULE_LAUNCHER', 'MCNMEET');

SELECT 'Step 0b: existing grants for these codes' AS report;
SELECT role_key, page_code, can_view, active_status
  FROM role_page_access
 WHERE page_code IN ('MODULE_LAUNCHER', 'MCNMEET');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — Catalog rows
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'MODULE_LAUNCHER', 'My Modules', '/modules', 'platform',
       'Landing grid that routes a user to the modules they hold access to.', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'MODULE_LAUNCHER');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'MCNMEET', 'McnMeet', '/mcnmeet', 'platform',
       'Meeting scheduling and room booking surface added by 1049.', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'MCNMEET');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — Grants for MODULE_LAUNCHER only, mirroring the matrix exactly.
-- View-only: the launcher navigates, it does not create, edit, delete or export.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), r.role_key, 'MODULE_LAUNCHER', 1, 0, 0, 0, 0, 1
  FROM (SELECT 'assistant_manager' AS role_key
        UNION ALL SELECT 'interviewer'
        UNION ALL SELECT 'payroll_admin'
        UNION ALL SELECT 'recruiter') r
 WHERE NOT EXISTS (
   SELECT 1 FROM role_page_access x
    WHERE x.page_code = 'MODULE_LAUNCHER' AND x.role_key = r.role_key
 );

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 3: after' AS report;
SELECT pc.page_code,
       pc.page_path,
       pc.active_status,
       (SELECT COUNT(*) FROM role_page_access rpa WHERE rpa.page_code = pc.page_code) AS grants
  FROM page_catalog pc
 WHERE pc.page_code IN ('MODULE_LAUNCHER', 'MCNMEET');
-- EXPECT: MODULE_LAUNCHER /modules  active=1 grants=4
--         MCNMEET         /mcnmeet  active=1 grants=0

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback
-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE FROM role_page_access WHERE page_code = 'MODULE_LAUNCHER';
-- DELETE FROM page_catalog     WHERE page_code IN ('MODULE_LAUNCHER','MCNMEET');
