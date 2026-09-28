-- 1705_imprest_manager_sanctioned_float.sql
--
-- Schema-only preparation for Phase 2 (imprest replenishment auto-flagging). Confirmed with
-- the user: the replenishment trigger will be "% of the manager's sanctioned float"
-- (default 25%, configurable) rather than one flat rupee floor — which needs a per-manager
-- ceiling to compute a percentage against. imprest_manager (1093_imprest_manager_and_
-- allocation.sql) has never had one: the float balance is entirely ledger-derived
-- (imprest-ledger.service.ts getBalance()), with no cap/sanctioned-amount concept anywhere.
--
-- Both columns are nullable and default to no-op: sanctioned_float_amount NULL means "no cap
-- set, no auto-flag possible yet" for that manager (degrades to the equivalent of Option C —
-- no automatic flag — until Finance sets one), and replenishment_floor_pct NULL means "use
-- the global default" rather than every existing manager silently getting a 0% floor.
-- Phase 2 builds the actual flagging logic and UI on top of these; this migration adds
-- nothing that reads or writes them yet.
--
-- Guarded on information_schema per 1658_blood_group_normalization.sql's documented incident
-- (an unguarded ALTER/UPDATE against a column/table shape a target host does not have takes
-- the whole migration run, and the backend boot with it, down) even though imprest_manager is
-- known to exist everywhere this runs — the idiom costs nothing and keeps every ALTER in this
-- codebase consistent.
SET @has_sanctioned := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'imprest_manager'
     AND COLUMN_NAME  = 'sanctioned_float_amount'
);
SET @ddl := IF(@has_sanctioned = 0,
  'ALTER TABLE imprest_manager ADD COLUMN sanctioned_float_amount DECIMAL(18,2) NULL COMMENT ''NULL = no cap set, no auto-flag possible yet (Phase 2).'' AFTER tally_name',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_floor_pct := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'imprest_manager'
     AND COLUMN_NAME  = 'replenishment_floor_pct'
);
SET @ddl := IF(@has_floor_pct = 0,
  'ALTER TABLE imprest_manager ADD COLUMN replenishment_floor_pct DECIMAL(5,2) NULL COMMENT ''NULL = use the global default (25%). Per-manager override.'' AFTER sanctioned_float_amount',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1705_imprest_manager_sanctioned_float.sql applied' AS migration_status;
