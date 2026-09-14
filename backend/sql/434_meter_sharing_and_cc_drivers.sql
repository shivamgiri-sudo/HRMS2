-- 434_meter_sharing_and_cc_drivers.sql
--
-- Two gaps found while designing the tabular Branch Budget Planner.
--
-- 1) SHARED METERS DO NOT EXIST. finance_meter_master.cost_centre_id is NOT NULL and scalar, so a
--    meter belongs to exactly one cost centre. A single physical connection feeding three
--    processes cannot be represented, and computeLineAllocations() additionally THROWS unless
--    every active cost centre in the branch has a reading — so even the genuinely dedicated-meter
--    case (a few processes metered, the rest not) is rejected. Consumption is also summed across
--    meters regardless of reading_unit, so a kWh meter and a KL water meter add together into one
--    meaningless weight.
--
--    Fixed additively: meter_type distinguishes dedicated from shared, utility_type keeps unlike
--    units apart, parent_meter_id supports a main meter with sub-meters, share_rule says how a
--    shared meter divides, and finance_meter_cost_centre_share holds effective-dated fixed
--    percentages. cost_centre_id stays NOT NULL and keeps its meaning for dedicated meters
--    (it is the owner), so every existing row and query behaves exactly as before.
--
-- 2) 26 OF 38 SEEDED SUB-HEADS CARRY A SHARING DEFAULT THE ENGINE REJECTS.
--    finance_expense_sub_head_master.default_allocation_driver is seeded with floor_area,
--    device_count, hiring_volume and usage_units, but SUPPORTED_SHARING_METHODS accepts none of
--    them, so applying a seeded default throws
--    'Sharing method "floor_area" is not yet supported for branch-level splitting'.
--    The driver data those methods need has nowhere to live, so the columns are added here and
--    the methods are enabled in branch-budget-allocation.service.ts.
--
-- Additive and backward-compatible throughout: new nullable columns, new table, no changes to
-- existing columns and no data rewritten. Safe to re-run.
--
-- Rollback (manual, if ever needed):
--   DROP TABLE IF EXISTS finance_meter_cost_centre_share;
--   ALTER TABLE finance_meter_master DROP COLUMN meter_type, DROP COLUMN utility_type,
--     DROP COLUMN parent_meter_id, DROP COLUMN share_rule;
--   ALTER TABLE finance_cost_centre_monthly_driver DROP COLUMN seat_count,
--     DROP COLUMN floor_area_sqft, DROP COLUMN device_count, DROP COLUMN hiring_volume;

-- ── 1. meter master: dedicated vs shared, utility, sub-metering ──────────────

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_meter_master'
      AND column_name = 'meter_type') = 0,
  'ALTER TABLE finance_meter_master
     ADD COLUMN meter_type ENUM(''dedicated'',''shared'') NOT NULL DEFAULT ''dedicated'' AFTER cost_centre_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Keeps unlike units apart. Electricity is the default because every meter registered before this
-- migration was an electricity meter in practice, and defaulting to 'other' would have silently
-- excluded them from every utility-scoped query.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_meter_master'
      AND column_name = 'utility_type') = 0,
  'ALTER TABLE finance_meter_master
     ADD COLUMN utility_type ENUM(''electricity'',''diesel'',''water'',''gas'',''other'')
       NOT NULL DEFAULT ''electricity'' AFTER meter_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- A sub-meter names its main meter. The main meter's shareable consumption is its own reading
-- minus the sum of its sub-meters' readings, so sub-metered cost centres are charged actuals and
-- only the genuine remainder is shared.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_meter_master'
      AND column_name = 'parent_meter_id') = 0,
  'ALTER TABLE finance_meter_master ADD COLUMN parent_meter_id CHAR(36) NULL AFTER utility_type',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- How a shared meter divides. NULL for a dedicated meter (it is wholly its own cost centre's).
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_meter_master'
      AND column_name = 'share_rule') = 0,
  'ALTER TABLE finance_meter_master
     ADD COLUMN share_rule ENUM(''fixed_pct'',''headcount'',''seats'',''floor_area'',''sub_meter_remainder'')
       NULL AFTER parent_meter_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'finance_meter_master'
      AND index_name = 'idx_meter_master_parent') = 0,
  'ALTER TABLE finance_meter_master ADD INDEX idx_meter_master_parent (parent_meter_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 2. fixed-percentage shares for a shared meter ───────────────────────────
-- Effective-dated so a share change does not retroactively restate a closed month. Percentages
-- for one meter must total 100 for any given date; the service enforces that on write, because
-- MySQL cannot express the constraint.
CREATE TABLE IF NOT EXISTS finance_meter_cost_centre_share (
  id             CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  meter_id       CHAR(36) NOT NULL,
  cost_centre_id CHAR(36) NOT NULL,
  share_pct      DECIMAL(9,6) NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  effective_to   DATE NULL,
  remarks        TEXT NULL,
  created_by     CHAR(36) NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by     CHAR(36) NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_meter_share_meter (meter_id, effective_from),
  KEY idx_meter_share_cc (cost_centre_id),
  CONSTRAINT fk_meter_share_meter FOREIGN KEY (meter_id)
    REFERENCES finance_meter_master (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. the driver data the newly-enabled sharing methods need ───────────────
-- finance_cost_centre_monthly_driver already carries planned_headcount and revenue_rate_per_head.
-- Seats, floor area, devices and hiring volume are what the seeded sub-head defaults ask for.
SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_cost_centre_monthly_driver'
      AND column_name = 'seat_count') = 0,
  'ALTER TABLE finance_cost_centre_monthly_driver
     ADD COLUMN seat_count DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER planned_headcount',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_cost_centre_monthly_driver'
      AND column_name = 'floor_area_sqft') = 0,
  'ALTER TABLE finance_cost_centre_monthly_driver
     ADD COLUMN floor_area_sqft DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER seat_count',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_cost_centre_monthly_driver'
      AND column_name = 'device_count') = 0,
  'ALTER TABLE finance_cost_centre_monthly_driver
     ADD COLUMN device_count DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER floor_area_sqft',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'finance_cost_centre_monthly_driver'
      AND column_name = 'hiring_volume') = 0,
  'ALTER TABLE finance_cost_centre_monthly_driver
     ADD COLUMN hiring_volume DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER device_count',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
