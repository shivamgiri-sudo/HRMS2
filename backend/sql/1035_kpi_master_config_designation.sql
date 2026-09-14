-- 1035_kpi_master_config_designation.sql
--
-- Lets a KPI target be set for a process AND designation together, e.g. an EXECUTIVE on
-- Onfido carrying a different DIALS target from a TEAM LEADER on the same process.
--
-- Today kpi_master_config.org_unit_type holds exactly one of
-- department/designation/process/cost_centre, and resolveEmployeeKpis() picks the single
-- highest-priority match (process > cost_centre > designation > department). A process row
-- therefore *overrides* a designation row rather than combining with it, so the pair cannot
-- be expressed at all. org_unit_type='designation' has never been used in production —
-- 0 rows — precisely because a process row always wins over it.
--
-- Additive and backward-compatible. designation_id is NULL on every existing row, which
-- means "applies to all designations in this org unit" — exactly what those rows mean today.
--
-- Safe to re-run.

-- ── Step 1: the new dimension ────────────────────────────────────────────────────────────
SET @has_designation := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'kpi_master_config'
     AND COLUMN_NAME = 'designation_id'
);
SET @sql := IF(@has_designation = 0,
  'ALTER TABLE kpi_master_config
     ADD COLUMN designation_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL
       COMMENT "Optional second dimension. NULL = applies to every designation in the org unit."
       AFTER org_unit_id',
  'SELECT "designation_id already present" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Step 2: fold NULL to a sentinel so the unique key actually fires ─────────────────────
-- MySQL treats NULL as distinct from NULL in a UNIQUE index, so adding a nullable
-- designation_id straight into uq_kpi_org would silently permit unlimited duplicate
-- (metric, org_unit, NULL) rows — the constraint would stop working for the *only* shape
-- that exists today. A STORED generated column folding NULL to '~ANY~' makes those rows
-- collide as they must. (Same defect found in salary_prep_run on 2026-07-31.)
SET @has_scope_key := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'kpi_master_config'
     AND COLUMN_NAME = 'designation_scope_key'
);
SET @sql := IF(@has_scope_key = 0,
  'ALTER TABLE kpi_master_config
     ADD COLUMN designation_scope_key VARCHAR(64) COLLATE utf8mb4_unicode_ci
       GENERATED ALWAYS AS (COALESCE(designation_id, "~ANY~")) STORED
       COMMENT "Sentinel-folded designation_id. Exists so the unique key treats two NULLs as equal."',
  'SELECT "designation_scope_key already present" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Step 3: widen the unique key ─────────────────────────────────────────────────────────
-- Replaces uq_kpi_org (metric_id, org_unit_type, org_unit_id). For every existing row
-- designation_scope_key is '~ANY~', so the new key enforces exactly the old constraint on
-- them; it only additionally allows one row per (metric, org unit, specific designation).

-- Order matters. uq_kpi_org (metric_id, ...) is the index MySQL uses to back the
-- kpi_master_config_ibfk_1 foreign key on metric_id, so dropping it first fails with
-- ER_DROP_INDEX_FK: "Cannot drop index 'uq_kpi_org': needed in a foreign key constraint".
-- The replacement also leads with metric_id, so creating it first lets it take over
-- backing the FK and the drop then succeeds.
SET @has_new_key := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'kpi_master_config'
     AND INDEX_NAME = 'uq_kpi_org_designation'
);
SET @sql := IF(@has_new_key = 0,
  'CREATE UNIQUE INDEX uq_kpi_org_designation
     ON kpi_master_config (metric_id, org_unit_type, org_unit_id, designation_scope_key)',
  'SELECT "uq_kpi_org_designation already present" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_old_key := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'kpi_master_config'
     AND INDEX_NAME = 'uq_kpi_org'
);
SET @sql := IF(@has_old_key > 0,
  'ALTER TABLE kpi_master_config DROP INDEX uq_kpi_org',
  'SELECT "uq_kpi_org already removed" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Step 4: resolution lookup path ───────────────────────────────────────────────────────
-- resolveEmployeeKpis() filters on (org_unit_type, org_unit_id, designation_id) per
-- employee, once per employee per sync.
SET @has_lookup := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'kpi_master_config'
     AND INDEX_NAME = 'idx_kmc_resolution'
);
SET @sql := IF(@has_lookup = 0,
  'CREATE INDEX idx_kmc_resolution
     ON kpi_master_config (is_active, org_unit_type, org_unit_id, designation_scope_key)',
  'SELECT "idx_kmc_resolution already present" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── Verification ─────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM kpi_master_config)                              AS total_rows,
  (SELECT COUNT(*) FROM kpi_master_config WHERE designation_id IS NULL) AS org_wide_rows,
  (SELECT COUNT(*) FROM kpi_master_config WHERE designation_id IS NOT NULL) AS designation_specific_rows;
