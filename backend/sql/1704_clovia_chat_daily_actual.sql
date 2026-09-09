-- Clovia's "Chat" dashboard (per its own SOP: "Chat Dump: Botlytics", no DB
-- backing anywhere) -- a real sample file was found and read directly:
-- "Clovia_Performance_Dashboard Report Sept26 (1).xlsb", sheet
-- "Chat Performance", its clean daily-aggregate block (columns I-N: Date,
-- Total Chat, Total Response, Response%, C-Sat Count, Chat-CSAT%).
--
-- Response% and Chat-CSAT% are stored pre-computed in the source sheet but
-- NOT carried here -- they are directly derivable from the raw counts this
-- table does keep (total_response/total_chat, csat_count/total_response),
-- and storing a derived ratio alongside its own inputs is a second source of
-- truth that can silently disagree with the numbers it was computed from.
CREATE TABLE IF NOT EXISTS clovia_chat_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  total_chat INT NOT NULL DEFAULT 0,
  total_response INT NOT NULL DEFAULT 0,
  csat_count INT NOT NULL DEFAULT 0,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_chat_daily (process_id, report_date, source_reference),
  KEY idx_clovia_chat_daily_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_CHAT_DAILY';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES
(UUID(), 'CLOVIA_CHAT_DAILY', 'Clovia Chat Performance (Daily)',
 'clovia_chat_daily_actual',
 'Daily chat volume/response/CSAT counts for Clovia''s Chat dashboard (Botlytics chat dump, per its SOP -- no DB backing exists). Columns taken from the live "Clovia_Performance_Dashboard Report Sept26 (1).xlsb" workbook, Chat Performance sheet.',
 JSON_ARRAY('Date','Total Chat','Total Response','C-Sat Count'),
 JSON_ARRAY(),
 JSON_OBJECT(
   'Date','2026-09-01',
   'Total Chat','134',
   'Total Response','2',
   'C-Sat Count','2'
 ), 1);
