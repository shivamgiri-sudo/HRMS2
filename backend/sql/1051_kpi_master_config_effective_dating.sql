-- 1051_kpi_master_config_effective_dating.sql
--
-- Effective dating for KPI targets.
--
-- WHY
-- ---
-- kpi_master_config is the live target table (372 rows, all active) and upserts
-- in place. Changing a target therefore rewrites history: a score computed in
-- June against a target of 80 is, after an August edit, reported as having been
-- measured against 95. Nothing records that the target moved, so a performance
-- conversation cannot distinguish "the agent got worse" from "we raised the bar".
--
-- This is the same defect process_metric_definition (1047) was built to avoid,
-- and the two must agree or a metric's definition and its target will disagree
-- about which period they describe.
--
-- WHAT
-- ----
-- Adds effective_from / effective_to and widens the unique key to include
-- effective_from, so one scope can hold several dated versions of a target.
--
-- Existing rows are stamped effective_from = '1970-01-01' with effective_to
-- NULL, which means "applies to everything, unchanged". That is deliberate:
-- backfilling from created_at would invent an effective date nobody agreed to
-- and would silently unapply existing config to earlier periods. Behaviour after
-- this migration is identical until someone creates a second version.
--
-- RISK AT APPLY TIME
-- ------------------
-- The unique key is dropped and recreated, which takes a brief metadata lock.
-- 372 rows, so it is fast, but a target write racing the ALTER would block. Run
-- it outside the 01:00 KPI sync window.
--
-- If the DROP succeeds and the ADD fails, the table is left without its
-- uniqueness guarantee — duplicate scope rows could then be inserted. Verify
-- afterwards:
--   SHOW INDEX FROM kpi_master_config WHERE Key_name = 'uq_kpi_org_designation_from';
--
-- ADDITIVE to the reader: resolveEmployeeKpis filters on the new columns, and
-- rows stamped 1970-01-01 with a NULL end date always match.
--
-- ROLLBACK
--   ALTER TABLE kpi_master_config
--     DROP INDEX uq_kpi_org_designation_from,
--     ADD UNIQUE KEY uq_kpi_org_designation (metric_id, org_unit_type, org_unit_id, designation_scope_key),
--     DROP COLUMN effective_to,
--     DROP COLUMN effective_from;
--   (safe only while no scope holds more than one version)

ALTER TABLE kpi_master_config
  ADD COLUMN effective_from DATE NOT NULL DEFAULT '1970-01-01' AFTER weightage,
  ADD COLUMN effective_to   DATE     NULL                      AFTER effective_from;

-- Widen the uniqueness so a scope can carry successive dated versions. Without
-- this the ADD below would reject the second version of any target.
ALTER TABLE kpi_master_config
  DROP INDEX uq_kpi_org_designation,
  ADD UNIQUE KEY uq_kpi_org_designation_from
    (metric_id, org_unit_type, org_unit_id, designation_scope_key, effective_from);

-- Resolution reads by date, so give it the columns it filters on.
ALTER TABLE kpi_master_config
  ADD INDEX idx_kmc_effective (is_active, effective_from, effective_to);
