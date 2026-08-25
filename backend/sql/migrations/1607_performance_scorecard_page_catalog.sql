-- Migration 1607: Register PERFORMANCE_SCORECARD_COMMAND_CENTER in page_catalog
-- and seed role_page_access grants (can_view only) for 16 roles.
-- admin and wfm deliberately excluded (see 2026-08-22 incident).
-- Purely additive; WHERE NOT EXISTS makes it idempotent.
--
-- Column names verified against the LIVE schema and the real application code
-- (backend/src/modules/access/*.ts consistently reads/writes page_code/page_name,
-- never page_key/page_label — confirmed 2026-08-25 via SHOW CREATE TABLE on both
-- page_catalog and role_page_access, and a grep of every access-module query).
-- A concurrent-session edit (commit 989a1334) had briefly changed this migration
-- to the non-existent page_key/page_label columns; reverted here after
-- independent re-verification, since running it as committed would have thrown
-- ER_BAD_FIELD_ERROR and silently gated this page shut for every role.

INSERT INTO page_catalog (page_code, page_name, module, description, created_at)
SELECT
  'PERFORMANCE_SCORECARD_COMMAND_CENTER',
  'Performance Scorecard',
  'performance',
  'Employee performance scorecard command center — daily snapshot, KPI, and drill-down',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM page_catalog WHERE page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
);

INSERT INTO role_page_access (role_key, page_code, can_view, can_edit, can_delete, can_export, created_at)
SELECT r.role_key, 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 1, 0, 0, 0, NOW()
FROM (
  SELECT 'manager'           AS role_key UNION ALL
  SELECT 'process_manager'               UNION ALL
  SELECT 'assistant_manager'             UNION ALL
  SELECT 'branch_head'                   UNION ALL
  SELECT 'branch_manager'                UNION ALL
  SELECT 'team_leader'                   UNION ALL
  SELECT 'tl'                            UNION ALL
  SELECT 'hr'                            UNION ALL
  SELECT 'hr_admin'                      UNION ALL
  SELECT 'ho_hr'                         UNION ALL
  SELECT 'branch_hr'                     UNION ALL
  SELECT 'process_hr'                    UNION ALL
  SELECT 'ceo'                           UNION ALL
  SELECT 'coo'                           UNION ALL
  SELECT 'management'                    UNION ALL
  SELECT 'super_admin'
) r
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access
   WHERE role_key = r.role_key
     AND page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
);
