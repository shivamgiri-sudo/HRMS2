-- 1862_process_master_auto_deactivation.sql
-- Owner ruling 2026-09-24: a process whose cost centres are all closed must go inactive
-- automatically. syncProcessActiveStatusWithCostCentres() (shared/cost-centre-sync.ts, run
-- nightly by cost-centre-process-resolver.worker) does that and records each automatic
-- deactivation here, so it can be audited and so only these rows are reactivated
-- automatically when a cost centre reopens (hand-deactivated processes are never touched).
--
-- New table, CREATE TABLE IF NOT EXISTS: additive and safe to replay. process_id matches
-- process_master.id: CHAR(36) utf8mb4_unicode_ci (verified live 2026-09-24).

CREATE TABLE IF NOT EXISTS process_master_auto_deactivation (
  process_id CHAR(36) NOT NULL,
  process_code VARCHAR(50) NULL,
  process_name VARCHAR(255) NULL,
  deactivated_at DATETIME NOT NULL,
  reactivated_at DATETIME NULL,
  PRIMARY KEY (process_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
