-- 1636 — Dialler_Source registry: every productivity system the business operates, registered
-- by name with the metrics it can supply (requirements.md Requirement 16), plus a per-source
-- Column_Mapping so a manual-upload report whose column layout differs from the base template
-- is a configuration change, not a code change (criteria 16.12-16.14).
--
-- NOT YET EXECUTED. Purely additive: two new tables, nothing altered, nothing read by production
-- code yet (the ingestion wiring is Phase 3; the admin-screen write path is a later UI phase).
-- Needs owner approval before it runs (CLAUDE.md).
--
-- WHY THIS EXISTS
-- `dialer_session_log` holds 1,365 rows over 64 employees with `dialer_name` NULL on every row,
-- exactly one `integration_key` ('dialer_1') and one `source_system`
-- ('dialer_db.vicidial_agent_log_249') — a single ViciDial instance. `apr.campaign_id` holds 78
-- distinct free-text values with no owning process or dialler anywhere
-- (`campaign_master` holds 0 rows today). 3,810 manual `apr` rows all carry the single sentinel
-- campaign_id 'MANUAL_UPLOAD', so the originating dialler system is recorded nowhere. Three
-- productivity feeds are already in play (`apr`/sync, `apr`/manual, `dialer_session_log`) with no
-- common source registry — this table is that registry.
--
-- WHAT dialler_source IS
-- One row per registered productivity system: a stable `source_key`, a display name, an
-- ingestion mode (`integrated_pull` or `manual_upload`), an optional owning branch/process scope
-- (NULL = serves every branch/process), the declared Metric_Availability (which of the 14
-- controlled metrics this source actually supplies — criterion 16.3, validated at the
-- application layer against `PRODUCTIVITY_METRICS`, added in Task 4), and an effective-date
-- window matching every other store in this feature.
--
-- WHAT dialler_source_column_mapping IS
-- For a `manual_upload` source, a JSON object mapping that source's actual report-file column
-- headers to this system's target Upload fields, mirroring the JSON-blob shape already proven by
-- `wfm_header_mapping_profile` (migration 1500, `backend/src/modules/wfm/header-mapping-profile.service.ts`)
-- for a different bulk upload (roster import) in this same module, rather than inventing a
-- second normalized-row shape for the same idea. Unlike migration 1500's table, this one follows
-- the pattern of every other table in this feature: no constraints on references between tables,
-- avoiding the database bottleneck that currently blocks every deploy. A mapping is
-- versioned (`mapping_version`): amending it governs only submissions from that point forward.
--
-- ROLLBACK
--   DROP TABLE dialler_source_column_mapping;
--   DROP TABLE dialler_source;

CREATE TABLE IF NOT EXISTS dialler_source (
  id                   CHAR(36)     NOT NULL,
  source_key           VARCHAR(100) NOT NULL,
  display_name         VARCHAR(255) NOT NULL,
  ingestion_mode       ENUM('integrated_pull','manual_upload') NOT NULL,
  integration_key      VARCHAR(100) NULL,
  owning_branch_id     CHAR(36)     NULL,
  owning_process_id    CHAR(36)     NULL,
  metric_availability  JSON         NOT NULL,
  effective_from       DATE         NOT NULL,
  effective_to         DATE         NULL,
  active_status        TINYINT      NOT NULL DEFAULT 1,
  created_by           CHAR(36)     NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dialler_source_key (source_key),
  KEY idx_dialler_source_active_window (active_status, effective_from, effective_to)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Registered Dialler_Source (requirements.md Requirement 16). Every row ingested into a Productivity_Feed must resolve to exactly one active row here (criteria 16.4, 16.5) before it can contribute to Canonical_Productive_Minutes.';

CREATE TABLE IF NOT EXISTS dialler_source_column_mapping (
  id                CHAR(36)       NOT NULL,
  dialler_source_id CHAR(36)       NOT NULL,
  mapping_version   SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  column_mappings   JSON           NOT NULL,
  effective_from    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  effective_to      DATETIME       NULL,
  is_active         TINYINT(1)     NOT NULL DEFAULT 1,
  created_by        CHAR(36)       NULL,
  created_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME       NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dscm (dialler_source_id, mapping_version),
  KEY idx_dscm_source_active (dialler_source_id, is_active)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-Dialler_Source column mapping for manual_upload sources (criteria 16.12-16.14), JSON-blob shape mirroring wfm_header_mapping_profile (migration 1500). No reference constraints, unlike 1500.';

SELECT '1636 applied: dialler_source + dialler_source_column_mapping' AS migration_status;
