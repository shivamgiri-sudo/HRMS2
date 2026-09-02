-- ============================================================================================
-- 1644_kpi_studio_foundation.sql
--
-- The configuration store behind KPI Studio: a KPI can now be BUILT and its CALCULATION
-- CONFIGURED per Branch / Process / Designation / Employee, instead of its arithmetic living
-- hardcoded in TypeScript.
--
-- WHY THIS EXISTS
-- kpi_formula_version.formula_expression (504), kpi_data_source_mapping.formula_sql and
-- kpi_formula_catalog.formula_expression (125) have all existed as free-text columns for
-- multiple releases and NOTHING HAS EVER PARSED ANY OF THEM. Every metric's arithmetic is
-- instead written by hand in kpi-data-connector.service.ts, one bespoke block per metric,
-- which is how AHT ended up computed two different ways in two different files:
-- (talk + dispo) / calls in syncAprMetrics, (talk + hold + acw) / calls in dialer-kpi-sync.
-- Neither is wrong; they are different processes' definitions of the same word. That is
-- configuration, and it has been living in code.
--
-- These tables hold that configuration, and kpi-formula.engine.ts evaluates it.
--
-- WHY NOT REUSE kpi_data_source_mapping / kpi_role_template_metric (125)
-- Those belong to the process/role scoring engine whose period tables (kpi_score_period,
-- kpi_score_detail, kpi_score_summary) are a SEPARATE pipeline from the one that actually
-- feeds production today (kpi_master_config -> kpi_employee_resolved -> kpi_daily_actual,
-- read by /api/kpi-master/live and every KPI page). Writing Studio config into 125's tables
-- would put it in the pipeline nothing reads. These tables resolve into the pipeline that is
-- live, alongside kpi_master_config rather than instead of it (see 1645).
--
-- SCOPE MODEL
-- kpi_studio_definition carries four nullable scope columns. Specificity decides which row
-- wins, most specific first, so one KPI can be defined once for a whole branch and overridden
-- for a single employee without touching the branch row:
--     employee_id                                     (tier 0 — this person)
--     branch + process + designation                  (tier 1)
--     process + designation                           (tier 2)
--     branch + process                                (tier 3)
--     process                                         (tier 4)
--     branch + designation                            (tier 5)
--     designation                                     (tier 6)
--     branch                                          (tier 7)
-- Tiers are computed in kpi-studio.service.ts, NOT stored, so the precedence rule lives in
-- exactly one place and cannot drift from the SQL. scope_key exists only to make the unique
-- index possible.
--
-- EFFECTIVE DATING IS NOT OPTIONAL HERE
-- kpi_master_config upserts in place, so editing a target silently rewrites history: a score
-- computed in June against a target of 80 later reports as measured against 95, and nobody
-- can separate "the agent got worse" from "we raised the bar". A definition is superseded by
-- setting effective_to and inserting a new row, never by UPDATE of the formula or target.
--
-- PURELY ADDITIVE. Six new tables, no ALTER, no DROP, no DELETE, no UPDATE, no backfill.
-- Nothing reads these tables until the paired service code ships, and 1645 makes reading them
-- conditional on their existence, so applying this file alone changes no employee's score.
--
-- Every string column declares COLLATE utf8mb4_unicode_ci explicitly. A bare CHARSET=utf8mb4
-- resolves to the SERVER default (utf8mb4_0900_ai_ci on this host) and joining a drifted table
-- to employees/kpi_metric_master is then a hard ER_CANT_AGGREGATE_2COLLATIONS (1267) — the
-- defect migration 1627 exists solely to repair across 49 tables. Verified against the live
-- schema: kpi_metric_master, kpi_employee_resolved, kpi_daily_actual, employees, branch_master,
-- process_master, designation_master and integration_config are all utf8mb4_unicode_ci.
--
-- No FOREIGN KEY anywhere, matching every recent migration in this project.
--
-- Indexes are declared inline AND re-asserted under INFORMATION_SCHEMA.STATISTICS guards,
-- because CREATE TABLE IF NOT EXISTS no-ops against a pre-existing table of that name and
-- would leave the inline INDEX clauses unevaluated on a partial replay.
--
-- ROLLBACK (child-first):
--   DROP TABLE IF EXISTS kpi_studio_computation_log;
--   DROP TABLE IF EXISTS kpi_studio_manual_value;
--   DROP TABLE IF EXISTS kpi_studio_upload_batch;
--   DROP TABLE IF EXISTS kpi_studio_source_field;
--   DROP TABLE IF EXISTS kpi_studio_definition;
--   DROP TABLE IF EXISTS kpi_studio_data_source;
-- ============================================================================================

-- --------------------------------------------------------------------------------------------
-- 1. Data sources — WHERE a formula's inputs come from.
--
-- source_type discriminates the three ingestion routes the business actually has:
--   'integration_connector' — an external MySQL/MSSQL server already configured in
--                             integration_config, reached through external-db.service.ts's
--                             getPoolForKey(). Credentials stay AES-256-GCM encrypted in
--                             integration_config.encrypted_credentials and are NEVER copied
--                             here; integration_key is a pointer, not a secret.
--   'local_query'           — a table inside mas_hrms itself (attendance_daily_record,
--                             kpi_daily_actual, apr...). No credentials involved.
--   'upload'                — CSV/XLSX uploaded by a human; rows land in
--                             kpi_studio_manual_value against an upload batch.
--   'manual'                — typed in directly, same landing table, no batch.
--
-- Google Sheets is deliberately NOT a source_type. There is no working Sheets integration in
-- this codebase — quality-aggregator.service.ts's connectGoogleSheet() is a stub that always
-- returns "not implemented", the googleapis package is not installed, and the existing UI
-- collects a service-account JSON that goes nowhere. A Sheet is exported to CSV and ingested
-- through 'upload'. Adding an enum value for a route that does not work would be a promise the
-- system cannot keep; when real Sheets sync is built it becomes an integration_config
-- connector like every other external system.
-- --------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_studio_data_source (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID())        COLLATE utf8mb4_unicode_ci,
  source_code         VARCHAR(64)   NOT NULL                         COLLATE utf8mb4_unicode_ci,
  source_name         VARCHAR(255)  NOT NULL                         COLLATE utf8mb4_unicode_ci,
  source_type         VARCHAR(32)   NOT NULL DEFAULT 'local_query'   COLLATE utf8mb4_unicode_ci,

  -- Pointer into integration_config.integration_key for source_type='integration_connector'.
  -- Never a credential.
  integration_key     VARCHAR(100)  NULL                             COLLATE utf8mb4_unicode_ci,

  -- For query-backed sources. Validated as a safe identifier in application code before ever
  -- reaching SQL (assertSafeIdentifier / quoteIdentifier, the same guard databaseAdapter.ts
  -- uses) because a table or column name cannot be a bound parameter.
  source_object       VARCHAR(255)  NULL                             COLLATE utf8mb4_unicode_ci,
  employee_key_column VARCHAR(128)  NULL                             COLLATE utf8mb4_unicode_ci,
  employee_key_kind   VARCHAR(32)   NOT NULL DEFAULT 'employee_code' COLLATE utf8mb4_unicode_ci,
  date_column         VARCHAR(128)  NULL                             COLLATE utf8mb4_unicode_ci,

  -- Non-secret extras: static filters, timezone, sheet name for an uploaded export, etc.
  config_json         JSON          NULL,

  description         TEXT          NULL                             COLLATE utf8mb4_unicode_ci,
  active_status       TINYINT(1)    NOT NULL DEFAULT 1,
  created_by          CHAR(36)      NULL                             COLLATE utf8mb4_unicode_ci,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_studio_source_code (source_code),
  KEY idx_kpi_studio_source_type (source_type, active_status),
  KEY idx_kpi_studio_source_integration (integration_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------------------
-- 2. Source fields — the NAMED VARIABLES a formula may reference.
--
-- This table is what makes the formula builder safe and discoverable at the same time. The UI
-- lists a source's fields as clickable chips; validateFormula() is handed the same list as its
-- allowedVariables, so an author cannot reference a column the source does not expose. Without
-- that, a typo produces a formula that evaluates to null forever and looks like missing data.
--
-- source_expression is the SQL fragment that produces the value (e.g. SUM(talk_sec)). It is
-- built by the UI from a picked column plus a picked aggregate, never free-typed by the user,
-- and is identifier-validated server-side before use.
-- --------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_studio_source_field (
  id                CHAR(36)      NOT NULL DEFAULT (UUID())    COLLATE utf8mb4_unicode_ci,
  data_source_id    CHAR(36)      NOT NULL                     COLLATE utf8mb4_unicode_ci,

  -- The identifier an author types in a formula. Constrained to ^[A-Za-z_][A-Za-z0-9_]*$ in
  -- application code so it is always a legal formula variable.
  field_name        VARCHAR(64)   NOT NULL                     COLLATE utf8mb4_unicode_ci,
  display_name      VARCHAR(255)  NULL                         COLLATE utf8mb4_unicode_ci,

  source_column     VARCHAR(128)  NULL                         COLLATE utf8mb4_unicode_ci,
  aggregate_fn      VARCHAR(16)   NOT NULL DEFAULT 'SUM'       COLLATE utf8mb4_unicode_ci,
  source_expression VARCHAR(500)  NULL                         COLLATE utf8mb4_unicode_ci,

  unit              VARCHAR(50)   NULL                         COLLATE utf8mb4_unicode_ci,
  description        TEXT         NULL                         COLLATE utf8mb4_unicode_ci,
  active_status     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_studio_field (data_source_id, field_name),
  KEY idx_kpi_studio_field_source (data_source_id, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------------------
-- 3. Definitions — a KPI, scoped, with its calculation and its target.
--
-- formula_expression NULL is meaningful and is the backwards-compatible default: it means
-- "this metric's value already arrives in kpi_daily_actual from an existing sync worker, just
-- score it against this target". That is exactly what every one of today's 372 kpi_master_config
-- rows does, so a Studio definition can add scope precision or a target without anyone having
-- to author arithmetic.
--
-- target_source records WHERE the number came from, because "target 240" chosen by a manager
-- and "target 240" written into a client SLA are different facts in a performance conversation.
-- --------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_studio_definition (
  id                 CHAR(36)       NOT NULL DEFAULT (UUID())   COLLATE utf8mb4_unicode_ci,
  metric_id          CHAR(36)       NOT NULL                    COLLATE utf8mb4_unicode_ci,

  -- Scope. All four NULL is rejected in application code: an unscoped definition would apply
  -- to the entire company, which is never what someone building a KPI for a process meant.
  branch_id          CHAR(36)       NULL                        COLLATE utf8mb4_unicode_ci,
  process_id         CHAR(36)       NULL                        COLLATE utf8mb4_unicode_ci,
  designation_id     CHAR(36)       NULL                        COLLATE utf8mb4_unicode_ci,
  employee_id        CHAR(36)       NULL                        COLLATE utf8mb4_unicode_ci,

  -- Calculation. NULL formula = read the metric's existing actuals (see above).
  data_source_id     CHAR(36)       NULL                        COLLATE utf8mb4_unicode_ci,
  formula_expression VARCHAR(2000)  NULL                        COLLATE utf8mb4_unicode_ci,
  -- How daily values roll up across a period: average | sum | last | min | max | latest_non_null
  aggregation_method VARCHAR(30)    NOT NULL DEFAULT 'average'  COLLATE utf8mb4_unicode_ci,

  -- Scoring. Mirrors kpi-score-engine.ts's KpiScoringType; NULL falls back to the metric's own
  -- direction, which is today's behaviour.
  scoring_type       VARCHAR(30)    NULL                        COLLATE utf8mb4_unicode_ci,
  target_value       DECIMAL(18,4)  NULL,
  min_threshold      DECIMAL(18,4)  NULL,
  max_achievement    DECIMAL(12,4)  NOT NULL DEFAULT 120.0000,
  weightage          DECIMAL(5,2)   NOT NULL DEFAULT 100.00,
  target_source      VARCHAR(32)    NOT NULL DEFAULT 'manager'  COLLATE utf8mb4_unicode_ci,

  -- Effective dating. Superseding inserts a new row and closes the old one.
  effective_from     DATE           NOT NULL,
  effective_to       DATE           NULL,

  active_status      TINYINT(1)     NOT NULL DEFAULT 1,
  notes              TEXT           NULL                        COLLATE utf8mb4_unicode_ci,
  created_by         CHAR(36)       NULL                        COLLATE utf8mb4_unicode_ci,
  approved_by        CHAR(36)       NULL                        COLLATE utf8mb4_unicode_ci,
  approved_at        DATETIME       NULL,
  created_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Generated so the unique index can treat "no branch" as a value rather than as SQL NULL,
  -- which never equals itself and would let the same scope be defined twice. STORED, not
  -- VIRTUAL, because a UNIQUE index on a VIRTUAL column cannot be used for the ON DUPLICATE
  -- KEY path the service relies on.
  scope_key          VARCHAR(200)   GENERATED ALWAYS AS (
                       CONCAT_WS('|',
                         COALESCE(branch_id,      '~'),
                         COALESCE(process_id,     '~'),
                         COALESCE(designation_id, '~'),
                         COALESCE(employee_id,    '~'))
                     ) STORED                                   COLLATE utf8mb4_unicode_ci,

  PRIMARY KEY (id),
  -- effective_from is part of the key so a superseding row can be inserted without first
  -- deleting the one it replaces.
  UNIQUE KEY uq_kpi_studio_def_scope (metric_id, scope_key, effective_from),
  KEY idx_kpi_studio_def_process (process_id, active_status),
  KEY idx_kpi_studio_def_branch (branch_id, active_status),
  KEY idx_kpi_studio_def_designation (designation_id, active_status),
  KEY idx_kpi_studio_def_employee (employee_id, active_status),
  KEY idx_kpi_studio_def_metric (metric_id, active_status),
  KEY idx_kpi_studio_def_effective (effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------------------
-- 4. Upload batches — provenance for every uploaded figure.
--
-- Exists because apr already demonstrates the failure mode it prevents: 3,810 rows there carry
-- campaign_id 'MANUAL_UPLOAD' with a NULL upload_batch_id and empty process/branch, so nobody
-- can say who uploaded them or from which file. Migration 1640 had to add triggers to stop more
-- of them. A KPI figure that affects someone's rating must be traceable to a file and a person
-- from the first row onward.
-- --------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_studio_upload_batch (
  id              CHAR(36)      NOT NULL DEFAULT (UUID())  COLLATE utf8mb4_unicode_ci,
  data_source_id  CHAR(36)      NULL                       COLLATE utf8mb4_unicode_ci,
  file_name       VARCHAR(255)  NULL                       COLLATE utf8mb4_unicode_ci,
  -- 'preview' rows are parsed and shown but never scored; 'committed' rows feed formulas.
  status          VARCHAR(24)   NOT NULL DEFAULT 'preview' COLLATE utf8mb4_unicode_ci,
  period_start    DATE          NULL,
  period_end      DATE          NULL,
  total_rows      INT UNSIGNED  NOT NULL DEFAULT 0,
  accepted_rows   INT UNSIGNED  NOT NULL DEFAULT 0,
  rejected_rows   INT UNSIGNED  NOT NULL DEFAULT 0,
  column_map_json JSON          NULL,
  rejection_json  JSON          NULL,
  uploaded_by     CHAR(36)      NULL                       COLLATE utf8mb4_unicode_ci,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at    DATETIME      NULL,
  PRIMARY KEY (id),
  KEY idx_kpi_studio_batch_source (data_source_id, status),
  KEY idx_kpi_studio_batch_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------------------
-- 5. Manual and uploaded values — one number, for one employee, for one field, on one date.
--
-- Keyed on (employee_id, field_name, value_date) so a corrected re-upload replaces the figure
-- it corrects instead of double-counting it. superseded_by_batch_id keeps the earlier row
-- readable for audit rather than deleting history.
--
-- field_name is NOT a metric code. It is a formula VARIABLE — 'audited_calls', 'points_earned'
-- — which is what lets one upload feed several KPIs.
-- --------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_studio_manual_value (
  id                    CHAR(36)       NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  data_source_id        CHAR(36)       NULL                      COLLATE utf8mb4_unicode_ci,
  employee_id           CHAR(36)       NOT NULL                  COLLATE utf8mb4_unicode_ci,
  field_name            VARCHAR(64)    NOT NULL                  COLLATE utf8mb4_unicode_ci,
  value_date            DATE           NOT NULL,
  field_value           DECIMAL(18,4)  NULL,
  entry_source          VARCHAR(24)    NOT NULL DEFAULT 'manual' COLLATE utf8mb4_unicode_ci,
  upload_batch_id       CHAR(36)       NULL                      COLLATE utf8mb4_unicode_ci,
  superseded_by_batch_id CHAR(36)      NULL                      COLLATE utf8mb4_unicode_ci,
  note                  VARCHAR(500)   NULL                      COLLATE utf8mb4_unicode_ci,
  created_by            CHAR(36)       NULL                      COLLATE utf8mb4_unicode_ci,
  created_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_studio_manual (employee_id, field_name, value_date),
  KEY idx_kpi_studio_manual_date (value_date, field_name),
  KEY idx_kpi_studio_manual_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------------------
-- 6. Computation log — why a KPI reads what it reads. This IS the root-cause feature.
--
-- Stores the inputs a formula received and, when the result was null, WHICH input was missing.
-- Without it, "no data" is indistinguishable from "mapped to the wrong column" and from
-- "genuinely took no calls that day" — the three explanations a manager most needs told apart,
-- and the reason a broken mapping can hide as an empty KPI for months.
--
-- Written once per definition/employee/date evaluation and read by the drill-down. Bounded in
-- practice by employees x configured KPIs x days; the service prunes on a retention window
-- rather than letting it grow without limit.
-- --------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kpi_studio_computation_log (
  id                 CHAR(36)       NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  definition_id      CHAR(36)       NULL                      COLLATE utf8mb4_unicode_ci,
  metric_id          CHAR(36)       NOT NULL                  COLLATE utf8mb4_unicode_ci,
  employee_id        CHAR(36)       NOT NULL                  COLLATE utf8mb4_unicode_ci,
  score_date         DATE           NOT NULL,
  formula_expression VARCHAR(2000)  NULL                      COLLATE utf8mb4_unicode_ci,
  -- The actual named values fed to the engine. What makes a wrong number explainable.
  inputs_json        JSON           NULL,
  computed_value     DECIMAL(18,4)  NULL,
  -- 'computed' | 'no_data' | 'error' | 'skipped'
  status             VARCHAR(24)    NOT NULL DEFAULT 'computed' COLLATE utf8mb4_unicode_ci,
  -- The engine's own explanation, e.g. "Division by zero" or "talk_seconds has no value".
  null_reason        VARCHAR(500)   NULL                      COLLATE utf8mb4_unicode_ci,
  error_message      VARCHAR(500)   NULL                      COLLATE utf8mb4_unicode_ci,
  run_id             CHAR(36)       NULL                      COLLATE utf8mb4_unicode_ci,
  computed_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_kpi_studio_log (employee_id, metric_id, score_date),
  KEY idx_kpi_studio_log_status (status, score_date),
  KEY idx_kpi_studio_log_definition (definition_id, score_date),
  KEY idx_kpi_studio_log_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------------------
-- Index re-assertion.
--
-- CREATE TABLE IF NOT EXISTS silently no-ops when the table already exists, leaving every
-- inline INDEX clause above unevaluated. If an earlier partial run created a table without its
-- indexes, the guarded statements below add them; on a clean apply every guard finds the index
-- present and does nothing.
--
-- PREPARE/EXECUTE rather than CREATE INDEX IF NOT EXISTS: the latter is MariaDB syntax that
-- MySQL 8 rejects at parse time WHILE THE RUNNER STILL RECORDS THE FILE AS APPLIED, which is
-- how a migration that did nothing comes to look successful.
-- --------------------------------------------------------------------------------------------

SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_definition'
                AND INDEX_NAME = 'idx_kpi_studio_def_process');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_kpi_studio_def_process ON kpi_studio_definition (process_id, active_status)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_definition'
                AND INDEX_NAME = 'idx_kpi_studio_def_employee');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_kpi_studio_def_employee ON kpi_studio_definition (employee_id, active_status)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_manual_value'
                AND INDEX_NAME = 'idx_kpi_studio_manual_date');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_kpi_studio_manual_date ON kpi_studio_manual_value (value_date, field_name)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_computation_log'
                AND INDEX_NAME = 'idx_kpi_studio_log_status');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_kpi_studio_log_status ON kpi_studio_computation_log (status, score_date)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- Seed: the two local data sources every process can use immediately, so the builder is not
-- empty on first open and a KPI can be configured without an integration being set up first.
--
-- Guarded by NOT EXISTS on source_code rather than INSERT IGNORE, so a replay neither
-- duplicates nor overwrites an administrator's later edits to these rows.
-- --------------------------------------------------------------------------------------------

INSERT INTO kpi_studio_data_source
  (source_code, source_name, source_type, source_object, employee_key_column, employee_key_kind,
   date_column, description)
SELECT
  'HRMS_ATTENDANCE_DAILY',
  'Attendance (this system)',
  'local_query',
  'attendance_daily_record',
  'employee_id',
  'employee_id',
  'attendance_date',
  'Daily attendance rows already in this system. Use for presence, late marks and shrinkage-style KPIs.'
WHERE NOT EXISTS (SELECT 1 FROM kpi_studio_data_source WHERE source_code = 'HRMS_ATTENDANCE_DAILY');

INSERT INTO kpi_studio_data_source
  (source_code, source_name, source_type, source_object, employee_key_column, employee_key_kind,
   date_column, description)
SELECT
  'HRMS_MANUAL_ENTRY',
  'Manual entry or file upload',
  'manual',
  'kpi_studio_manual_value',
  'employee_id',
  'employee_id',
  'value_date',
  'Figures typed in or uploaded from a spreadsheet. Use for anything no system feeds yet, including a Google Sheet exported to CSV.'
WHERE NOT EXISTS (SELECT 1 FROM kpi_studio_data_source WHERE source_code = 'HRMS_MANUAL_ENTRY');
