-- 1051_kpi_master_config_effective_dating.sql
--
-- Make KPI target effective dating actually work.
--
-- WHY
-- ---
-- kpi_master_config is the live target table (372 rows, all active) and upserts
-- in place, so editing a target rewrites the past: a score computed in June
-- against a target of 80 reports, after an August edit, as measured against 95.
-- A performance conversation cannot then separate "the agent got worse" from
-- "we raised the bar".
--
-- effective_from and effective_to ALREADY EXIST on this table. They were added
-- by an earlier change, are nullable, and are NULL on every one of the 372 rows.
-- They are also absent from the unique key, so the table still cannot hold two
-- dated versions of the same target — the columns are present but inert.
--
-- This migration originally tried to ADD them and failed with ER_DUP_FIELDNAME
-- when executed against a clone of production. It now completes what the earlier
-- change started.
--
-- WHAT
-- ----
--   1. Stamp the 372 existing rows with a start date so they are dated rather
--      than undated. 1970-01-01 means "has always applied", which is exactly
--      what they mean today. Backfilling from created_at was rejected: it would
--      invent an effective date nobody agreed to and silently unapply existing
--      config to earlier periods.
--   2. Make effective_from NOT NULL so it can join the unique key. MySQL treats
--      NULL <> NULL in a UNIQUE index, so a nullable column there would let the
--      same scope be inserted repeatedly.
--   3. Widen the unique key to include it, which is what finally allows a second
--      dated version of a target.
--
-- The reader is NULL-tolerant regardless (`effective_from IS NULL OR ...`), so
-- it behaves correctly whether or not this has been applied. That matters
-- because production runs SKIP_MIGRATIONS=true.
--
-- RISK AT APPLY TIME
-- ------------------
-- Step 3 drops and recreates a unique key, taking a brief metadata lock. 372
-- rows, so it is fast, but a target write racing the ALTER would block. Run it
-- outside the 01:00 KPI sync window.
--
-- If the DROP lands and the ADD fails, the table loses its uniqueness guarantee
-- and duplicate scope rows become insertable. Verify afterwards:
--   SHOW INDEX FROM kpi_master_config WHERE Key_name = 'uq_kpi_org_designation_from';
--
-- Verified by executing against a clone of production in a throwaway schema.
--
-- ROLLBACK
--   ALTER TABLE kpi_master_config
--     DROP INDEX uq_kpi_org_designation_from,
--     ADD UNIQUE KEY uq_kpi_org_designation (metric_id, org_unit_type, org_unit_id, designation_scope_key),
--     MODIFY COLUMN effective_from DATE NULL,
--     DROP INDEX idx_kmc_effective;
--   UPDATE kpi_master_config SET effective_from = NULL WHERE effective_from = '1970-01-01';
--   (safe only while no scope holds more than one version)

-- 0. Ensure the columns exist.
--
-- The note above says effective_from and effective_to "ALREADY EXIST ... added by an earlier
-- change". That is true of production and of nothing else: no migration in the manifest adds
-- them, so the change was applied to the live database directly and never written down. On a
-- database built from the manifest this file failed at step 1 with
-- "Unknown column 'effective_from' in 'where clause'".
--
-- Adding them here makes the file self-contained without changing what it does anywhere the
-- columns are already present: a duplicate ADD COLUMN raises errno 1060, which the runner
-- treats as idempotent per statement and skips. Nullable on the way in because step 2 is what
-- deliberately promotes effective_from to NOT NULL, and step 1 has to see the NULLs first.
ALTER TABLE kpi_master_config ADD COLUMN effective_from DATE NULL;
ALTER TABLE kpi_master_config ADD COLUMN effective_to   DATE NULL;

-- 1. Date the undated rows. Scoped to NULL so a row someone has already dated
--    deliberately is left exactly as it is.
UPDATE kpi_master_config
   SET effective_from = '1970-01-01'
 WHERE effective_from IS NULL;

-- 2. A nullable column cannot carry uniqueness in MySQL.
ALTER TABLE kpi_master_config
  MODIFY COLUMN effective_from DATE NOT NULL DEFAULT '1970-01-01';

-- 3. Allow successive dated versions of the same target.
ALTER TABLE kpi_master_config
  DROP INDEX uq_kpi_org_designation,
  ADD UNIQUE KEY uq_kpi_org_designation_from
    (metric_id, org_unit_type, org_unit_id, designation_scope_key, effective_from);

-- Resolution filters on these, so index them.
ALTER TABLE kpi_master_config
  ADD INDEX idx_kmc_effective (is_active, effective_from, effective_to);
