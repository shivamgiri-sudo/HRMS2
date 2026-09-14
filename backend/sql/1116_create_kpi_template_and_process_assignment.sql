-- 1116_create_kpi_template_and_process_assignment.sql
--
-- Creates kpi_process_assignment, which the portal's KPI Assignments tab reads and writes and
-- which does not exist in the database.
--
-- /api/portal/internal/kpi-assignments joins it to kpi_template and process_master, and the POST
-- and DELETE write to it, so all three raised ER_NO_SUCH_TABLE and the tab in
-- EnhancedClientMaster.tsx could not list, save or delete an assignment.
--
-- This is deliberately a re-run of DDL that 509_portal_client_master_fixes.sql already contains,
-- not a new design. 509 is listed in the manifest and schema_migrations records it applied on
-- 2026-07-19, but none of the three tables it declares exists: portal_user_sessions,
-- portal_user_permissions and kpi_process_assignment are all absent. Something recorded that file
-- as applied without its statements taking effect. This migration repairs only the table needed by
-- the endpoints above; the two portal tables are a separate and larger question, because whatever
-- let 509 be recorded without running could have done the same to other files, and that wants
-- investigating rather than papering over.
--
-- The definition matches 509's so the two cannot disagree: same UNIQUE KEY, same index, same FK to
-- kpi_template, same charset and collation. The UNIQUE KEY is load-bearing rather than
-- housekeeping - the POST handler uses ON DUPLICATE KEY UPDATE and without a unique constraint to
-- update against, re-assigning the same template to the same process from the same date would
-- insert another row every time.
--
-- kpi_template is NOT created here. It already exists, created 2026-05-29, and is owned by
-- 010_kpi.sql, which runs earlier in the manifest. An earlier draft of this file declared it too;
-- that was wrong, and would have put a second, differing definition of the same table into the
-- migration history for any database built from scratch.
--
-- char(36) utf8mb4_unicode_ci matches kpi_template.id exactly. The server default is
-- utf8mb4_0900_ai_ci, and a foreign key whose type or collation differs from the referenced key is
-- rejected with errno 3780 - the failure that left 099 half-applied.
--
-- assigned_by carries no foreign key: the handler falls back to the literal 'system' when there is
-- no authenticated user, which is not a user id. 509 declares it NOT NULL and so does this.

CREATE TABLE IF NOT EXISTS kpi_process_assignment (
  id             char(36) NOT NULL DEFAULT (UUID()),
  process_id     char(36) NOT NULL,
  template_id    char(36) NOT NULL,
  effective_from date     NOT NULL,
  effective_to   date     DEFAULT NULL COMMENT 'NULL = still active',
  assigned_by    char(36) NOT NULL,
  created_at     datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_proc_tpl (process_id, template_id, effective_from),
  KEY idx_kpa_process (process_id),
  CONSTRAINT fk_kpa_template FOREIGN KEY (template_id) REFERENCES kpi_template (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
