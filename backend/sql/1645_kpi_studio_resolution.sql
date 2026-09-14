-- ============================================================================================
-- 1645_kpi_studio_resolution.sql
--
-- Lets a KPI Studio definition (1644) resolve into the pipeline that production actually reads,
-- by carrying the resolved formula down onto kpi_employee_resolved alongside the target.
--
-- WHY ON kpi_employee_resolved AND NOT A NEW TABLE
-- kpi_employee_resolved is the per-employee cache every KPI surface already reads through:
-- getResolvedKpis() feeds getLiveKpiPerformance(), which is behind /api/kpi-master/live,
-- /my-kpi, MyLiveKpiView, the team scorecard and the leaderboard. A parallel resolved table
-- would mean every one of those call sites has to learn to union two sources, and the first one
-- anybody forgot would silently show an employee a KPI set that disagrees with the next page
-- along. Five nullable columns on the existing cache means one resolver changes and every
-- reader inherits it.
--
-- WHAT EACH COLUMN IS FOR
-- The resolver already picks a winning row per metric across five precedence tiers and writes
-- the target it found. These columns record the rest of what a Studio definition decides:
--   studio_definition_id — which definition won, so the UI can link straight to it and a
--                          computed value is traceable to the configuration that produced it
--   formula_expression   — the arithmetic. NULL means "score the actuals an existing sync
--                          already writes", which is what all 372 of today's rows do
--   data_source_id       — where the formula's inputs come from
--   aggregation_method   — how dailies roll up over a period (average/sum/last/min/max)
--   scoring_type         — per-scope override of the metric's global scoring type, so one
--                          process can floor-gate a metric another process does not
--   resolved_scope       — which Studio tier won, in words ('employee',
--                          'process+designation'), for display next to the number
--
-- WHY resolved_from GETS EXACTLY ONE NEW VALUE
-- resolved_from is enum('process','cost_centre','designation','department') and is written by
-- our own resolver, read only for display. It gains 'kpi_studio' and nothing else. The
-- alternative — one enum value per Studio tier — would have added eight, and an enum with
-- twelve values where four are one mechanism and eight are another is a column that has to be
-- explained every time it is read. The tier goes in resolved_scope as text instead.
--
-- CRITICALLY: widening the enum is what makes this migration REQUIRED rather than optional.
-- Production runs SKIP_MIGRATIONS=true, so this file may not be applied when the paired code
-- ships. Writing 'kpi_studio' into the un-widened enum is a truncation error under
-- STRICT_TRANS_TABLES, and every KPI resolution for every employee would fail. The resolver
-- therefore capability-probes for these columns exactly as effectiveDatingPredicate() and
-- getLineageColumns() already do, and falls back to the current kpi_master_config-only
-- behaviour when they are absent. Applying this file alone changes no score; not applying it
-- means Studio definitions are ignored rather than anything breaking.
--
-- PURELY ADDITIVE. Five ADD COLUMN, one MODIFY that only widens an enum, two indexes. No DROP,
-- no DELETE, no UPDATE, no backfill. Every existing row reads NULL on all five new columns,
-- which the resolver treats as "not a Studio row" — the pre-1644 behaviour exactly.
--
-- Each ALTER is a SEPARATE guarded statement, never one multi-column ALTER. Migration 509
-- guarded one column then added eleven in a single all-or-nothing ALTER on one table, died
-- ER_DUP_FIELDNAME on a column that already existed, that error is on the runner's idempotent
-- swallow-list, and every statement after it silently never ran — migration 1118 exists only to
-- repair that.
--
-- No ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS anywhere: MariaDB-only syntax that
-- MySQL 8.0 rejects at the token while the runner still records the file as applied.
--
-- Every added string column declares COLLATE utf8mb4_unicode_ci. Verified against the live
-- schema: kpi_employee_resolved is utf8mb4_unicode_ci throughout, as are the tables these
-- columns join to (kpi_studio_definition, kpi_studio_data_source, kpi_metric_master).
--
-- ROLLBACK:
--   ALTER TABLE kpi_employee_resolved DROP COLUMN studio_definition_id;
--   ALTER TABLE kpi_employee_resolved DROP COLUMN formula_expression;
--   ALTER TABLE kpi_employee_resolved DROP COLUMN data_source_id;
--   ALTER TABLE kpi_employee_resolved DROP COLUMN aggregation_method;
--   ALTER TABLE kpi_employee_resolved DROP COLUMN scoring_type;
--   ALTER TABLE kpi_employee_resolved DROP COLUMN resolved_scope;
--   DROP INDEX idx_kpi_resolved_definition ON kpi_employee_resolved;
--   ALTER TABLE kpi_employee_resolved
--     MODIFY COLUMN resolved_from ENUM('process','cost_centre','designation','department')
--     COLLATE utf8mb4_unicode_ci NOT NULL;
-- ============================================================================================

-- --------------------------------------------------------------------------------------------
-- 1. Which definition won.
-- --------------------------------------------------------------------------------------------
SET @col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
                AND COLUMN_NAME = 'studio_definition_id');
SET @sql := IF(@col = 0,
  'ALTER TABLE kpi_employee_resolved ADD COLUMN studio_definition_id CHAR(36) NULL COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- 2. The arithmetic. NULL = score the actuals an existing sync already writes.
--
-- VARCHAR(2000) matches MAX_EXPRESSION_LENGTH in kpi-formula.engine.ts, so a formula the engine
-- accepts can always be stored. A shorter column would let the builder validate an expression
-- it then cannot save.
-- --------------------------------------------------------------------------------------------
SET @col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
                AND COLUMN_NAME = 'formula_expression');
SET @sql := IF(@col = 0,
  'ALTER TABLE kpi_employee_resolved ADD COLUMN formula_expression VARCHAR(2000) NULL COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- 3. Where the formula's inputs come from.
-- --------------------------------------------------------------------------------------------
SET @col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
                AND COLUMN_NAME = 'data_source_id');
SET @sql := IF(@col = 0,
  'ALTER TABLE kpi_employee_resolved ADD COLUMN data_source_id CHAR(36) NULL COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- 4. How dailies roll up over a period.
--
-- NULLABLE on purpose, unlike kpi_metric_master.aggregation_method which is NOT NULL DEFAULT
-- 'average'. NULL here means "no per-scope override, use the metric's own method", and a
-- NOT NULL DEFAULT would make every one of the 372 existing rows assert 'average' as a
-- deliberate choice nobody made — which then silently overrides a metric whose global method
-- is 'sum'.
-- --------------------------------------------------------------------------------------------
SET @col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
                AND COLUMN_NAME = 'aggregation_method');
SET @sql := IF(@col = 0,
  'ALTER TABLE kpi_employee_resolved ADD COLUMN aggregation_method VARCHAR(30) NULL COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- 5. Per-scope scoring override.
--
-- Same NULL-means-inherit reasoning. This is what lets one process floor-gate a metric while
-- another process scores the same metric on a plain ratio — the opt-in that kpi-floor-gating's
-- tests exist to protect, now settable per scope instead of only globally.
-- --------------------------------------------------------------------------------------------
SET @col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
                AND COLUMN_NAME = 'scoring_type');
SET @sql := IF(@col = 0,
  'ALTER TABLE kpi_employee_resolved ADD COLUMN scoring_type VARCHAR(30) NULL COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- 6. Which tier won, in words.
--
-- 'employee', 'branch+process+designation', 'process+designation', 'process', 'branch' ... The
-- existing UI already surfaces resolved_from as "via process" on every KPI card, and an
-- inherited target being mistaken for a chosen one is the exact confusion KpiTargetMatrix was
-- built to fix. This keeps that distinction available for Studio rows too.
-- --------------------------------------------------------------------------------------------
SET @col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
                AND COLUMN_NAME = 'resolved_scope');
SET @sql := IF(@col = 0,
  'ALTER TABLE kpi_employee_resolved ADD COLUMN resolved_scope VARCHAR(64) NULL COLLATE utf8mb4_unicode_ci',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- 7. Widen resolved_from by exactly one value.
--
-- Guarded on COLUMN_TYPE, not on column existence: the column always exists, so an existence
-- check would never fire and a replay would re-run a MODIFY that rewrites the table. Matching
-- on the absence of 'kpi_studio' in the type makes the statement genuinely idempotent.
--
-- All five original values are restated. A MODIFY that listed only the new value would DROP the
-- other four and truncate every one of the existing rows to ''.
--
-- NOT NULL and the collation are restated for the same reason: MODIFY COLUMN replaces the whole
-- definition, so an attribute left out is an attribute removed.
-- --------------------------------------------------------------------------------------------
SET @needs_widening := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                         WHERE TABLE_SCHEMA = DATABASE()
                           AND TABLE_NAME = 'kpi_employee_resolved'
                           AND COLUMN_NAME = 'resolved_from'
                           AND COLUMN_TYPE NOT LIKE '%kpi_studio%');
SET @sql := IF(@needs_widening = 1,
  'ALTER TABLE kpi_employee_resolved MODIFY COLUMN resolved_from ENUM(''process'',''cost_centre'',''designation'',''department'',''kpi_studio'') COLLATE utf8mb4_unicode_ci NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- 8. Index for the reverse lookup: "which employees does this definition currently drive?"
--
-- The Studio UI asks this every time a definition is opened, to show its blast radius before an
-- edit. Without an index that is a full scan of the resolved cache.
-- --------------------------------------------------------------------------------------------
SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
                AND INDEX_NAME = 'idx_kpi_resolved_definition');
SET @col := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_employee_resolved'
                AND COLUMN_NAME = 'studio_definition_id');
SET @sql := IF(@idx = 0 AND @col = 1,
  'CREATE INDEX idx_kpi_resolved_definition ON kpi_employee_resolved (studio_definition_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
