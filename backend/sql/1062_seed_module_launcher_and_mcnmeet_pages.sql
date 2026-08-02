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
-- Both are real, working pages. This is the inverse of 1059: there the grant existed without
-- a page, here the page exists without a catalog row.
--
-- Why it matters beyond a red test: page_catalog is what ModuleLauncher reads to decide
-- where to send a user, and what every access review reports from. A page absent from it is
-- invisible to governance while being fully reachable in the product.
--
-- Grants deliberately mirror rbacPageMatrix.ts rather than inventing a role set. MCNMEET is
-- seeded as a catalog row with NO grants, because no role is granted it in the matrix today
-- — seeding access nobody asked for would be inventing policy in a migration.
--
-- Safe to re-run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — Current state
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0: existing rows for these codes (expect none)' AS report;
SELECT page_code, page_path, active_status
  FROM page_catalog
 WHERE page_code IN ('MODULE_LAUNCHER', 'MCNMEET');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — Catalog rows
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO page_catalog (id, page_code, page_name, page_path, module_code, active_status)
SELECT UUID(), 'MODULE_LAUNCHER', 'My Modules', '/modules', 'platform', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'MODULE_LAUNCHER');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module_code, active_status)
SELECT UUID(), 'MCNMEET', 'McnMeet', '/mcnmeet', 'platform', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'MCNMEET');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — Grants for MODULE_LAUNCHER only, mirroring the matrix exactly.
-- View-only: the launcher navigates, it does not create, edit, delete or export.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_page_access (id, role_key, page_id, can_view, can_create, can_edit, can_delete, can_export)
SELECT UUID(), r.role_key, pc.id, 1, 0, 0, 0, 0
  FROM page_catalog pc
  JOIN (SELECT 'assistant_manager' AS role_key
        UNION ALL SELECT 'interviewer'
        UNION ALL SELECT 'payroll_admin'
        UNION ALL SELECT 'recruiter') r
 WHERE pc.page_code = 'MODULE_LAUNCHER'
   AND NOT EXISTS (
     SELECT 1 FROM role_page_access x WHERE x.page_id = pc.id AND x.role_key = r.role_key
   );

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 3: after' AS report;
SELECT pc.page_code,
       pc.page_path,
       pc.active_status,
       (SELECT COUNT(*) FROM role_page_access rpa WHERE rpa.page_id = pc.id) AS grants
  FROM page_catalog pc
 WHERE pc.page_code IN ('MODULE_LAUNCHER', 'MCNMEET');
-- EXPECT: MODULE_LAUNCHER /modules active=1 grants=4
--         MCNMEET         /mcnmeet active=1 grants=0

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback
-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE rpa FROM role_page_access rpa
--   JOIN page_catalog pc ON pc.id = rpa.page_id
--  WHERE pc.page_code = 'MODULE_LAUNCHER';
-- DELETE FROM page_catalog WHERE page_code IN ('MODULE_LAUNCHER','MCNMEET');
