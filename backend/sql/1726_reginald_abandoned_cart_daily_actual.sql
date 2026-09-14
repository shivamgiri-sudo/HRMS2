-- Reginald Men's own "Abandoned Cart Dashboard SOP" (a separate dashboard
-- from the already-built Reginald Men Email one, sql/1700) is not a
-- manual-paste procedure -- its own "Data Source Mapping"/"Direct Paths"
-- sheets give exact live table names: dialer_db.cdr_ob_25 (2.7M rows,
-- current to yesterday) and dialer_db.vicidial_agent_log_10_25 (1.42M
-- rows), both confirmed live 2026-09-10 and filtered to this dashboard's
-- own 5 campaigns (ABANDON, KANNADA, KERALA, TAMIL, TELUGU), all of which
-- exist in the real data. reginald-abandoned-cart-sync.service.ts reads
-- both directly (Database Boundary Rule: dialer_db stays read-only) and
-- lands the result here.
--
-- Scoped to what the SOP defines UNAMBIGUOUSLY: Total CDR (COUNT(*)),
-- Unique Dialed (COUNT DISTINCT phone), and APR aggregates (login count,
-- talk/wrap/wait/dead seconds) from vicidial_agent_log_10_25's own
-- talk_sec/dispo_sec/wait_sec/dead_sec columns. The SOP's "Unique
-- Connected"/"Connect %"/"AHT" metrics depend on a "strict connect flag"
-- the SOP itself never enumerates against cdr_ob_25's real CallStatus
-- values (AB/NA/A/DROP/PTP/DISCX/NRC/VM/FP/NRN/CB/NI/SD/ALRD/NC/N/AOFW/
-- DISMX/CALLBK/B, all confirmed live) -- deliberately left NULL rather
-- than guessed, same discipline as clovia_quality_audit_raw's Fatal/ACPT
-- columns (sql/1723).
--
-- The SOP's Monthly/Live Sales and Employee Directory Google Sheets are a
-- separate, later gap (manual bulk-upload path, not a live sync) --
-- tracked, not yet built.
CREATE TABLE IF NOT EXISTS reginald_abandoned_cart_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  total_cdr INT NOT NULL DEFAULT 0,
  unique_dialed INT NOT NULL DEFAULT 0,
  login_count INT NULL,
  talk_seconds INT NULL,
  wrapup_seconds INT NULL,
  wait_seconds INT NULL,
  dead_seconds INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'dialer_db_live_sync',
  synced_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reginald_abandoned_cart_daily (process_id, report_date),
  KEY idx_reginald_abandoned_cart_daily_date (report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
