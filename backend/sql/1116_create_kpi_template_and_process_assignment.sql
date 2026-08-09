-- 1116_create_kpi_template_and_process_assignment.sql
--
-- Creates the two tables the portal's KPI Assignments tab has always read and written, and which
-- have never existed: kpi_template and kpi_process_assignment.
--
-- Three endpoints and a live UI tab depend on them. /api/portal/internal/kpi-templates selects
-- from kpi_template, /internal/kpi-assignments selects from kpi_process_assignment joined to both
-- kpi_template and process_master, and the POST and DELETE write to kpi_process_assignment.
-- EnhancedClientMaster.tsx drives all four from its "kpi-assignments" tab. Every one of them
-- raised ER_NO_SUCH_TABLE, so the tab could not list, could not populate its template dropdown,
-- and could not save.
--
-- Why new tables rather than reusing something: kpi_process_template looks like a candidate, but
-- it merges the two concepts into one row - a named template that is already bound to one process
-- with its own effective dates - so it cannot express "assign this existing template to that
-- process", which is exactly what the UI does. It is also empty, as is kpi_assignment, which
-- assigns templates to designation/department/employee rather than to a process. The live
-- per-process KPI data is kpi_process_config (291 rows, process_id + metric_id + target), a
-- different grain entirely, and nothing here touches it. So no existing table is being displaced
-- and no second source of truth is created.
--
-- char(36) utf8mb4_unicode_ci matches process_master.id exactly. A foreign key whose type or
-- collation differs from the referenced key is rejected with errno 3780, and the server default
-- here is utf8mb4_0900_ai_ci, so the COLLATE is required rather than decorative.
--
-- The UNIQUE KEY is load-bearing, not housekeeping: the POST handler uses ON DUPLICATE KEY UPDATE,
-- which needs a unique constraint to update against. Without it, re-assigning the same template to
-- the same process from the same date would silently insert a second row every time.
--
-- assigned_by carries no foreign key on purpose - the handler falls back to the literal 'system'
-- when there is no authenticated user, which is not a user id.

CREATE TABLE IF NOT EXISTS kpi_template (
  id            char(36)     NOT NULL,
  template_name varchar(191) NOT NULL,
  description   varchar(500) DEFAULT NULL,
  active_status tinyint(1)   NOT NULL DEFAULT 1,
  created_by    char(36)     DEFAULT NULL,
  created_at    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    datetime     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_kpi_template_active (active_status, template_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kpi_process_assignment (
  id             char(36) NOT NULL,
  process_id     char(36) NOT NULL,
  template_id    char(36) NOT NULL,
  effective_from date     NOT NULL,
  effective_to   date     DEFAULT NULL,
  assigned_by    char(36) DEFAULT NULL,
  created_at     datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_process_assignment (process_id, template_id, effective_from),
  KEY idx_kpa_process (process_id),
  KEY idx_kpa_template (template_id),
  CONSTRAINT fk_kpa_process  FOREIGN KEY (process_id)  REFERENCES process_master (id) ON DELETE CASCADE,
  CONSTRAINT fk_kpa_template FOREIGN KEY (template_id) REFERENCES kpi_template (id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
