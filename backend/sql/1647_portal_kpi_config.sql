-- ============================================================================================
-- 1647_portal_kpi_config.sql
--
-- Client-visible KPI definitions and targets for the Client Portal.
--
-- WHY THIS EXISTS
-- The portal's Performance tab currently renders nothing. The cause is not missing operational
-- data — attendance_daily_record holds 147,000 rows across 2026-01..2026-08 and leave_request holds
-- 29,892 — it is that portal.kpi.service.ts reads kpi_score (per-employee, unpopulated) and resolves
-- which metrics to show by fuzzy-matching kpi_template.template_name LIKE '%<process_name>%'.
-- kpi_process_assignment, the table built for that purpose, has 0 rows.
--
-- So the portal needs a definition of WHICH metrics a client sees and WHAT target each is measured
-- against, decoupled from the internal KPI machinery. That is what this table is.
--
-- WHY NOT REUSE kpi_process_config
-- It IS reused, and it takes precedence — 291 rows across 97 processes already hold real
-- per-process targets and those must win. This table supplies the DEFAULT for a
-- process/metric pair kpi_process_config does not cover, which is most of them: the portal metrics
-- are attendance, leave, lateness, absenteeism and retention, computed from operational tables,
-- and kpi_process_config is populated mainly with dialler/quality metrics. Resolution order is
-- implemented in portal.kpi-engine.service.ts as: kpi_process_config (process-specific)
-- -> portal_kpi_config (process-specific) -> portal_kpi_config (process_id IS NULL, the default).
--
-- WHY process_id IS NULLABLE
-- NULL means "the default for every process". Seeding six NULL rows gives every one of the 54 active
-- processes a working scorecard on day one, with no per-process configuration required. A row with a
-- process_id overrides the default for that process alone.
--
-- ON THE METRICS DELIBERATELY NOT SEEDED HERE
-- HC Utilization (actual_hc / sanctioned_hc) is NOT seeded, because workforce_mandate — the only
-- table holding sanctioned headcount — has 0 rows. Seeding it would produce a metric whose
-- denominator does not exist. The pre-existing attrition service already makes this mistake in the
-- other direction: it sets sanctioned_strength = headcount, which makes utilisation permanently
-- 100% and tells a client their staffing is perfect regardless of reality. The engine reports
-- utilisation as not-tracked until a mandate exists, which is the truth.
--
-- PURELY ADDITIVE. One new table plus six seed rows, all guarded. No ALTER, no DROP, no DELETE of
-- anything pre-existing, no backfill. Nothing reads it until the paired service code ships.
--
-- Every string column declares COLLATE utf8mb4_unicode_ci: a bare CHARSET=utf8mb4 resolves to the
-- server default (utf8mb4_0900_ai_ci on this host) and a later join to process_master or
-- kpi_metric_master would be a hard errno 1267 — the defect migration 1627 had to repair across 49
-- tables.
--
-- No FOREIGN KEY, matching every recent migration in this project.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS portal_kpi_config;
-- ============================================================================================

CREATE TABLE IF NOT EXISTS portal_kpi_config (
  id               CHAR(36)      NOT NULL DEFAULT (UUID())        COLLATE utf8mb4_unicode_ci,

  -- NULL = the default applied to every process. A row with a value overrides it for that process.
  process_id       CHAR(36)      NULL                             COLLATE utf8mb4_unicode_ci,

  metric_code      VARCHAR(20)   NOT NULL                         COLLATE utf8mb4_unicode_ci,
  metric_name      VARCHAR(100)  NOT NULL                         COLLATE utf8mb4_unicode_ci,
  unit             VARCHAR(20)   NOT NULL DEFAULT 'percent'       COLLATE utf8mb4_unicode_ci,
  direction        VARCHAR(20)   NOT NULL DEFAULT 'higher_is_better' COLLATE utf8mb4_unicode_ci,

  target_value     DECIMAL(10,2) NOT NULL,

  -- Achievement percentage below which the metric turns amber. Green at or above 100.
  -- Stored per metric rather than hardcoded because the tolerable shortfall genuinely differs:
  -- 85% of an attendance target is a bad month, 85% of a retention target is a crisis.
  amber_threshold  DECIMAL(10,2) NOT NULL DEFAULT 85.00,

  -- Shown under the number in the portal so a client can see what the metric means without asking.
  -- A KPI a client cannot interpret generates a meeting, not insight.
  description      VARCHAR(500)  NULL                             COLLATE utf8mb4_unicode_ci,

  display_order    INT           NOT NULL DEFAULT 100,
  active_status    TINYINT(1)    NOT NULL DEFAULT 1,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- Generated so the unique index can treat "the default" as a value. A plain
  -- UNIQUE (process_id, metric_code) would not constrain the NULL rows at all, because NULL never
  -- equals NULL in SQL, so the same default metric could be seeded twice and the engine would pick
  -- one arbitrarily. STORED rather than VIRTUAL so the index is usable by the ON DUPLICATE KEY path.
  process_scope    CHAR(36)      GENERATED ALWAYS AS (COALESCE(process_id, '~DEFAULT~')) STORED
                                 COLLATE utf8mb4_unicode_ci,

  UNIQUE KEY uq_portal_kpi_config (process_scope, metric_code),
  KEY idx_portal_kpi_config_process (process_id, active_status),
  KEY idx_portal_kpi_config_metric (metric_code, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index re-assertion. CREATE TABLE IF NOT EXISTS silently no-ops against a pre-existing table of
-- that name and leaves the inline INDEX clauses unevaluated, so a partial earlier run could have
-- created the table without them. PREPARE/EXECUTE rather than CREATE INDEX IF NOT EXISTS, which is
-- MariaDB syntax MySQL 8 rejects at parse time while the runner still records the file as applied.

SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_kpi_config'
                AND INDEX_NAME = 'idx_portal_kpi_config_process');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_portal_kpi_config_process ON portal_kpi_config (process_id, active_status)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_kpi_config'
                AND INDEX_NAME = 'idx_portal_kpi_config_metric');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_portal_kpi_config_metric ON portal_kpi_config (metric_code, active_status)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- --------------------------------------------------------------------------------------------
-- Default metric set.
--
-- Every one of these is computable TODAY from a table verified to hold data:
--   ATT / LAT / ABN / HDY / DQ  <- attendance_daily_record  (147,000 rows, 2026-01..2026-08)
--   LVE                          <- leave_request            (29,189 approved)
--   RET                          <- employees.date_of_exit + employment_status
--
-- Targets are the ones stated in the portal requirement, except where the requirement had none.
-- Each INSERT is guarded by NOT EXISTS on the metric code rather than INSERT IGNORE, so a replay
-- neither duplicates a row nor overwrites a target an administrator has since tuned.
-- --------------------------------------------------------------------------------------------

INSERT INTO portal_kpi_config
  (process_id, metric_code, metric_name, unit, direction, target_value, amber_threshold, display_order, description)
SELECT NULL, 'ATT', 'Attendance Rate', 'percent', 'higher_is_better', 95.00, 85.00, 10,
       'Days actually worked as a share of days the roster expected work. Half days count as half. Week-offs, holidays and approved leave are excluded from the denominator, so a rest day never counts against attendance.'
WHERE NOT EXISTS (SELECT 1 FROM portal_kpi_config WHERE process_scope = '~DEFAULT~' AND metric_code = 'ATT');

INSERT INTO portal_kpi_config
  (process_id, metric_code, metric_name, unit, direction, target_value, amber_threshold, display_order, description)
SELECT NULL, 'ABN', 'Absenteeism Rate', 'percent', 'lower_is_better', 3.00, 85.00, 20,
       'Unplanned absence as a share of expected working days. Approved leave is not absenteeism and is excluded.'
WHERE NOT EXISTS (SELECT 1 FROM portal_kpi_config WHERE process_scope = '~DEFAULT~' AND metric_code = 'ABN');

INSERT INTO portal_kpi_config
  (process_id, metric_code, metric_name, unit, direction, target_value, amber_threshold, display_order, description)
SELECT NULL, 'LAT', 'Late Arrival Rate', 'percent', 'lower_is_better', 5.00, 85.00, 30,
       'Days flagged as a late arrival as a share of days present. Reported only for periods where arrival time was captured.'
WHERE NOT EXISTS (SELECT 1 FROM portal_kpi_config WHERE process_scope = '~DEFAULT~' AND metric_code = 'LAT');

INSERT INTO portal_kpi_config
  (process_id, metric_code, metric_name, unit, direction, target_value, amber_threshold, display_order, description)
SELECT NULL, 'LVE', 'Leave Rate', 'percent', 'lower_is_better', 5.00, 85.00, 40,
       'Approved leave days as a share of expected working days. Planned and legitimate — shown for capacity planning, not as a performance failure.'
WHERE NOT EXISTS (SELECT 1 FROM portal_kpi_config WHERE process_scope = '~DEFAULT~' AND metric_code = 'LVE');

INSERT INTO portal_kpi_config
  (process_id, metric_code, metric_name, unit, direction, target_value, amber_threshold, display_order, description)
SELECT NULL, 'RET', 'Retention Rate', 'percent', 'higher_is_better', 97.00, 95.00, 50,
       'Share of the month''s opening headcount still employed at month end. The inverse of attrition.'
WHERE NOT EXISTS (SELECT 1 FROM portal_kpi_config WHERE process_scope = '~DEFAULT~' AND metric_code = 'RET');

-- Half-day rate. Not in the original requirement, added because it is 13% of all attendance rows
-- (20,440 of 147,000) and is otherwise invisible: a half day is neither present nor absent, so a
-- client reading attendance alone cannot see that a material share of the floor worked half a shift.
INSERT INTO portal_kpi_config
  (process_id, metric_code, metric_name, unit, direction, target_value, amber_threshold, display_order, description)
SELECT NULL, 'HDY', 'Half Day Rate', 'percent', 'lower_is_better', 5.00, 85.00, 60,
       'Days worked as a half shift, as a share of expected working days. Counts as half a day in attendance.'
WHERE NOT EXISTS (SELECT 1 FROM portal_kpi_config WHERE process_scope = '~DEFAULT~' AND metric_code = 'HDY');

-- Data completeness. THE most important addition for a client-facing scorecard, and the reason it is
-- seeded rather than left optional: 20,086 of 147,000 attendance rows (13.7%) are 'missing_punch' or
-- 'unreconciled'. Those days are neither confirmed present nor confirmed absent. Publishing an
-- attendance figure derived from them without saying so presents a reconciliation backlog as
-- employee behaviour. A client who later discovers it has reason to distrust every other number on
-- the page, so it is disclosed on the same screen.
INSERT INTO portal_kpi_config
  (process_id, metric_code, metric_name, unit, direction, target_value, amber_threshold, display_order, description)
SELECT NULL, 'DQ', 'Attendance Data Completeness', 'percent', 'higher_is_better', 98.00, 90.00, 70,
       'Share of attendance days with a confirmed status. The remainder are awaiting punch reconciliation and are excluded from the attendance calculation rather than assumed present or absent.'
WHERE NOT EXISTS (SELECT 1 FROM portal_kpi_config WHERE process_scope = '~DEFAULT~' AND metric_code = 'DQ');
