-- Inbound Process's own "SOP" (Inbound Process.docx) is not a manual-paste
-- procedure like every other gap found in this audit -- it is the literal
-- source of a Google Apps Script that already reads LIVE data via JDBC and
-- writes the result into a Google Sheet:
--
--   fetchGNCData/fetchBellavitaData/fetchCloviaData/fetchNeemansData/
--   fetchViegaData/fetchExicomData/fetchDUBangladeshData, each querying
--   cdr_in_4 / cdr_in_9 / cdr_in_11_5 / cdr_in_250 / cdr_in_249 and (for
--   FCR) data_master_in, grouped by CallDate, for Call_Offered/Call_Answered/
--   AL%/SL%/ACHT/Repeat%/FCR%/manpower-mandate.
--
-- Those exact tables already exist LIVE in this project's own dialer_db
-- (NAMED_POOLS.dialer) -- 150K-830K rows each, current to 2026-09-08/09,
-- confirmed live on 2026-09-09 before this migration was written. So this
-- is not a bulk-upload gap at all: it is a real live source this codebase
-- already has read-only access to, and the fix is a scheduled read of it,
-- not a manual paste path. inbound_cdr_daily_actual is the landing table in
-- mas_hrms for that read (per the Database Boundary Rule: dialer_db is
-- upstream read-only, new data lands here) -- populated by
-- inbound-cdr-sync.service.ts running the SOP's own aggregation logic
-- against dialer_db, not by a human uploading a file.
--
-- client_code enumerates the seven queues the SOP's script covers. Two
-- (GNC, DU_BANGLADESH) share cdr_in_4; the rest each have their own CDR
-- table. login_count/repeat_pct require COUNT(DISTINCT ...), which KPI
-- Studio's own field-filter builder cannot express (no DISTINCT support) --
-- another reason this needed a purpose-built sync rather than a KPI Studio
-- source pointed straight at dialer_db.
-- Every one of the seven client_code values maps to a real, active
-- process_master row -- confirmed live 2026-09-09 (GNC, Viega, Exicom,
-- "Bella-Vita Organic", Clovia, "Neemans Private Limited" each matched by
-- name; DU_BANGLADESH maps to the same "DU Digital" process already used
-- for this session's Korea/Thailand APR, sql/1710 -- one process, three
-- regions).
CREATE TABLE IF NOT EXISTS inbound_cdr_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  client_code ENUM('GNC','BELLAVITA','CLOVIA','NEEMANS','VIEGA','EXICOM','DU_BANGLADESH') NOT NULL,
  call_date DATE NOT NULL,
  login_count INT NULL,
  call_offered INT NOT NULL DEFAULT 0,
  call_answered INT NOT NULL DEFAULT 0,
  -- answer_rate_pct is safely SUM(call_answered)/SUM(call_offered) across any
  -- date range -- all seven of the SOP's own queries compute AL the same way.
  -- service_level_pct/repeat_pct/fcr_pct are NOT: their denominators differ
  -- by client (some subtract a VDCL/QueueDuration adjustment, some don't,
  -- Clovia's Repeat_Percent even uses a different base than its own
  -- Call_Offered) -- stored here exactly as the SOP computes them per day,
  -- not re-derived, so a multi-day KPI must average these, not re-sum a
  -- borrowed numerator over the wrong denominator.
  answer_rate_pct DECIMAL(6,2) NULL,
  service_level_pct DECIMAL(6,2) NULL,
  acht_seconds INT NULL,
  repeat_pct DECIMAL(6,2) NULL,
  fcr_pct DECIMAL(6,2) NULL,
  tagging_count INT NULL,
  manpower_mandate INT NULL,
  required_login INT NULL,
  deficit_manpower INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'dialer_db_live_sync',
  synced_at DATETIME NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- One row per client per day -- a re-run of the sync updates the same row
  -- rather than accumulating duplicates, since the source query itself is
  -- always a full recompute of the trailing 30 days, not an incremental feed.
  UNIQUE KEY uq_inbound_cdr_daily (client_code, call_date),
  KEY idx_inbound_cdr_daily_date (call_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
