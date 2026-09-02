-- ============================================================================================
-- 1646_kpi_studio_multi_source.sql
--
-- Lets ONE KPI draw its inputs from SEVERAL data sources at once, and makes Google Sheets a real
-- source rather than a CSV export.
--
-- WHY
-- 1644 gave each definition a single data_source_id. That already covers the common case — one
-- process where AHT comes from the dialer MySQL, Quality from a sheet and Attendance from
-- mas_hrms, because each METRIC is its own definition row with its own source.
--
-- What it cannot express is a single metric whose formula spans sources:
--
--     PCT(audited_passed, total_calls)
--
-- where audited_passed is maintained by the QA team in a Google Sheet and total_calls comes from
-- the dialer database. That is not an exotic case; it is what happens whenever a ratio's numerator
-- and denominator are owned by different teams, which in a BPO is most quality and conversion
-- metrics. Under 1644 the only workaround is to copy one side into the other's system, which is
-- exactly the manual reconciliation this feature exists to remove.
--
-- HOW: a definition gets a SET of sources instead of one.
--
-- kpi_studio_definition.data_source_id is kept and keeps working — it stays the primary source, so
-- every definition written under 1644 continues to resolve unchanged and no backfill is needed.
-- Additional sources are rows in kpi_studio_definition_source. At compute time each source is read
-- for the same employees and date range, and the per-day field maps are MERGED before the formula
-- is evaluated, so the formula itself does not change and needs no source qualification:
-- `audited_passed` is just a field name whichever system it lives in.
--
-- WHY NOT QUALIFY FIELDS IN THE FORMULA (sheet.audited_passed)
-- Because the formula language would then need dotted identifiers, which means the parser, the
-- validator and every one of the engine's tests change to support a syntax whose only purpose is
-- to disambiguate a collision that configuration can simply forbid. Instead, field names must be
-- unique across a definition's chosen sources, validated on save with an error naming the clash.
-- The author renames one field; the formula stays readable.
--
-- GOOGLE SHEETS
-- No new columns are needed. A sheet maps onto the existing kpi_studio_data_source shape:
--   source_type         = 'google_sheet'
--   source_object       = the spreadsheet ID from its URL
--   employee_key_column = the HEADER TEXT of the column holding the employee code
--   date_column         = the header text of the column holding the date
--   config_json.tab     = which tab to read (defaults to the first)
--   integration_key     -> integration_config, whose encrypted_credentials holds the
--                          service-account JSON, AES-256-GCM encrypted
--
-- The credential deliberately lives in integration_config and not here: that is where every other
-- external system's secret already lives, it is already encrypted at rest, and one secret recorded
-- in two places is a secret that can disagree with itself. The reader authenticates with a
-- self-signed RS256 JWT exchanged for an access token — no new npm dependency, node:crypto only.
-- The existing connectGoogleSheet() stub in quality-aggregator.service.ts stays untouched and
-- remains superseded; this path does not use it.
--
-- PURELY ADDITIVE. One new table, two guarded index assertions. No ALTER of an existing table, no
-- DROP, no DELETE, no UPDATE, no backfill. Every definition that exists keeps its single source and
-- behaves identically; a definition with no rows in this table is a single-source definition.
--
-- Every string column declares COLLATE utf8mb4_unicode_ci: a bare CHARSET=utf8mb4 takes the server
-- default (utf8mb4_0900_ai_ci here) and joining to kpi_studio_definition would then be a hard
-- errno 1267, the defect 1627 had to repair across 49 tables.
--
-- No FOREIGN KEY, matching 1644 and every recent migration in this project. Orphan rows are
-- prevented in the service layer, which deletes a definition's source rows when it supersedes it.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS kpi_studio_definition_source;
-- ============================================================================================

CREATE TABLE IF NOT EXISTS kpi_studio_definition_source (
  id             CHAR(36)   NOT NULL DEFAULT (UUID()) COLLATE utf8mb4_unicode_ci,
  definition_id  CHAR(36)   NOT NULL                  COLLATE utf8mb4_unicode_ci,
  data_source_id CHAR(36)   NOT NULL                  COLLATE utf8mb4_unicode_ci,
  -- Read order. Lower first. Only matters when two sources supply the same field for the same
  -- employee and day, which validation forbids at save time — this exists so that if such a row
  -- reaches the database by any other route the winner is deterministic rather than dependent on
  -- which query returned first.
  read_order     INT        NOT NULL DEFAULT 100,
  active_status  TINYINT(1) NOT NULL DEFAULT 1,
  created_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One source cannot be attached to a definition twice: reading it twice would double the work and
  -- make read_order meaningless.
  UNIQUE KEY uq_kpi_studio_def_source (definition_id, data_source_id),
  KEY idx_kpi_studio_def_source_def (definition_id, active_status),
  KEY idx_kpi_studio_def_source_src (data_source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index re-assertion. CREATE TABLE IF NOT EXISTS silently no-ops against a pre-existing table of
-- that name, leaving the inline INDEX clauses unevaluated, so a partial earlier run could have left
-- the table without them. PREPARE/EXECUTE rather than CREATE INDEX IF NOT EXISTS, which is MariaDB
-- syntax MySQL 8 rejects at parse time while the runner still records the file as applied.

SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_definition_source'
                AND INDEX_NAME = 'idx_kpi_studio_def_source_def');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_kpi_studio_def_source_def ON kpi_studio_definition_source (definition_id, active_status)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_definition_source'
                AND INDEX_NAME = 'idx_kpi_studio_def_source_src');
SET @sql := IF(@idx = 0,
  'CREATE INDEX idx_kpi_studio_def_source_src ON kpi_studio_definition_source (data_source_id)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
