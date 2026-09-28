-- KPI Studio: process grain.
--
-- Studio produces one value per employee per day. A large share of client SLAs
-- are process totals instead (prepaid %, ROI, net revenue, a queue TAT), and
-- those cannot be rolled up from the employee output: a process ratio is
-- SUM(numerator)/SUM(denominator) over the whole process, not the mean of each
-- agent's personal ratio. The aggregation has to happen in the query.
--
-- A client's own database also has no MAS employee IDs in it — their orders
-- table has order rows, not agents — so there is nothing to group by or join on.
--
-- Purely additive. Both defaults ('employee', 'none') mean every existing
-- definition and data source keeps its current behaviour with no backfill.
-- Guarded through INFORMATION_SCHEMA/PREPARE the way 1644-1646 are, because
-- ADD COLUMN IF NOT EXISTS is MariaDB syntax that MySQL 8 rejects at the token
-- while the runner still records the file as applied.

-- ── kpi_studio_definition.grain ─────────────────────────────────────────────
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_definition'
              AND COLUMN_NAME = 'grain');
SET @s := IF(@c = 0,
  "ALTER TABLE kpi_studio_definition ADD COLUMN grain ENUM('employee','process') NOT NULL DEFAULT 'employee' AFTER metric_id",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ── kpi_studio_data_source: how a source's rows map to a process ────────────
-- 'constant' — the whole source is one client's database.
-- 'column'   — a column carries a client identifier that is NOT a
--              process_master.id (Shivamgiri's client_id='487', the dialer's
--              CampaignName='Blabliblu_IN'), so the translation to a process is
--              stated outright rather than inferred.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_data_source'
              AND COLUMN_NAME = 'process_key_kind');
SET @s := IF(@c = 0,
  "ALTER TABLE kpi_studio_data_source ADD COLUMN process_key_kind ENUM('none','constant','column') NOT NULL DEFAULT 'none'",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_data_source'
              AND COLUMN_NAME = 'process_key_column');
SET @s := IF(@c = 0,
  "ALTER TABLE kpi_studio_data_source ADD COLUMN process_key_column VARCHAR(64) NULL COLLATE utf8mb4_unicode_ci",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_data_source'
              AND COLUMN_NAME = 'process_key_value');
SET @s := IF(@c = 0,
  "ALTER TABLE kpi_studio_data_source ADD COLUMN process_key_value VARCHAR(191) NULL COLLATE utf8mb4_unicode_ci",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kpi_studio_data_source'
              AND COLUMN_NAME = 'process_id');
SET @s := IF(@c = 0,
  "ALTER TABLE kpi_studio_data_source ADD COLUMN process_id CHAR(36) NULL COLLATE utf8mb4_unicode_ci",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
