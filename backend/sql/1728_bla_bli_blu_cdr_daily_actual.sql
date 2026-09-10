-- Bla Bli Blu's own "B-3 Dashboard" workbook family (a real, unaudited
-- Drive download found this session, e.g. "BLA BLI BLU_Master_Dashboard
-- Aug_26.xlsb") has a "CDR Raw" sheet whose data already exists live:
-- dialer_db.cdr_bla_bli_blu, 321,917 real rows confirmed live 2026-09-10,
-- current to today (a SmartPing/cloud-telephony power-dialer export
-- schema, distinct from the VICIdial-style schema used by every other
-- dialer_db table this session touched). apr_bla_bli_blu (the sibling
-- table this session's own memory had already flagged as a dead sync job)
-- is confirmed still empty and is NOT used here.
--
-- bla-bli-blu-cdr-sync.service.ts reads cdr_bla_bli_blu directly and lands
-- a daily aggregate here, per the Database Boundary Rule. agent_name is
-- the source's own free-text column (e.g. "GUNGUN GAUTAM") -- multiple
-- real employees share first names in employees, so this is stored as
-- free text and never joined to an employee_id, same identity decision
-- the user made explicitly for Clovia CRM Disposition earlier this
-- session.
CREATE TABLE IF NOT EXISTS bla_bli_blu_cdr_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  total_calls INT NOT NULL DEFAULT 0,
  unique_customers INT NOT NULL DEFAULT 0,
  connected_calls INT NOT NULL DEFAULT 0,
  unique_agents INT NOT NULL DEFAULT 0,
  talk_seconds INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'dialer_db_live_sync',
  synced_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bla_bli_blu_cdr_daily (process_id, report_date),
  KEY idx_bla_bli_blu_cdr_daily_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
