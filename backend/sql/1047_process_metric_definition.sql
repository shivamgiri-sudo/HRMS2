-- 1047_process_metric_definition.sql
--
-- Per-process metric definitions.
--
-- WHY
-- ---
-- Every one of the 97 processes carrying KPI config holds the identical three
-- metrics — ATTENDANCE_PCT, DIALS, TALK_TIME — each with exactly ONE distinct
-- target value across all of them. Per-process targeting does not exist today;
-- what exists is a single bulk seed (193_kpi_live_data_bridge.sql) that
-- cross-joined every process against three metrics at hardcoded 240/80/95.
--
-- Meanwhile the live call-quality source shows quality ranging from 23.7% to
-- 72.7% across the ten active clients, so one shared target is not merely
-- imprecise, it is meaningless.
--
-- kpi_metric_master.metric_code is globally UNIQUE and the table is not
-- process-scoped, so a process cannot simply name its own metric. That is the
-- constraint this table works around: the canonical code stays global while
-- display_name carries what THIS process calls it. Neemans may label
-- QUALITY_SCORE as "CX Score" and GNC as "Audit %", and both still roll up.
--
-- A client parameter with no canonical equivalent sets metric_id = NULL and
-- carries local_code instead. It renders on that process's dashboard and is
-- excluded from cross-process aggregates, which is the honest treatment — a
-- score that means something different per process must not be averaged.
--
-- ADDITIVE. Creates one new table. Alters nothing, reads nothing, and no code
-- path selects from it yet.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS process_metric_definition;
--   (and remove the manifest entry in src/db/runPendingMigrations.ts)

CREATE TABLE IF NOT EXISTS process_metric_definition (
  id                CHAR(36)      NOT NULL,

  process_id        CHAR(36)      NOT NULL,

  -- Exactly one of these is set; the CHECK below enforces it.
  --   metric_id  -> maps to the canonical kpi_metric_master row, so the value
  --                 can be compared and rolled up across processes.
  --   local_code -> process-local parameter with no canonical peer.
  metric_id         CHAR(36)          NULL,
  local_code        VARCHAR(50)       NULL,

  -- What this process calls the metric. The entire point of the table.
  display_name      VARCHAR(255)  NOT NULL,

  -- A canonical metric inherits unit and direction from kpi_metric_master. A
  -- process-local one has no such row, so it must carry its own or it cannot be
  -- formatted, compared against a target, or scored — "62" is meaningless
  -- without knowing it is a percentage and that higher is better.
  unit              VARCHAR(50)       NULL,
  direction         ENUM('higher_is_better','lower_is_better') NULL,

  display_order     INT           NOT NULL DEFAULT 100,
  weightage         DECIMAL(5,2)  NOT NULL DEFAULT 100.00,

  -- A fatal parameter zeroes the whole audit regardless of other scores.
  is_fatal          TINYINT(1)    NOT NULL DEFAULT 0,

  -- Effective dating is on the definition itself, so renaming or retiring a
  -- parameter does not rewrite what past periods were measured against.
  effective_from    DATE          NOT NULL,
  effective_to      DATE              NULL,

  active_status     TINYINT(1)    NOT NULL DEFAULT 1,
  created_by        CHAR(36)          NULL,
  approved_by       CHAR(36)          NULL,
  approved_at       DATETIME          NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- MySQL treats NULL <> NULL in a UNIQUE key, so a nullable metric_id would
  -- let the same process register the same canonical metric repeatedly. The
  -- generated sentinel collapses both cases into one comparable value. Same
  -- technique 1035_kpi_master_config_designation.sql used for designation_id,
  -- and for the same reason.
  metric_scope_key  VARCHAR(50)
                    GENERATED ALWAYS AS (COALESCE(metric_id, local_code)) STORED,

  PRIMARY KEY (id),

  CONSTRAINT chk_pmd_one_metric_reference
    CHECK ((metric_id IS NULL) <> (local_code IS NULL)),

  -- Refuse a process-local metric that cannot be rendered or scored, rather
  -- than accepting it and discovering the gap on a dashboard.
  CONSTRAINT chk_pmd_local_needs_unit_and_direction
    CHECK (metric_id IS NOT NULL OR (unit IS NOT NULL AND direction IS NOT NULL)),

  UNIQUE KEY uq_pmd_process_metric_from (process_id, metric_scope_key, effective_from),

  KEY idx_pmd_resolution (process_id, active_status, effective_from, effective_to),
  KEY idx_pmd_metric (metric_id),

  CONSTRAINT fk_pmd_process FOREIGN KEY (process_id)
    REFERENCES process_master (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pmd_metric FOREIGN KEY (metric_id)
    REFERENCES kpi_metric_master (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
