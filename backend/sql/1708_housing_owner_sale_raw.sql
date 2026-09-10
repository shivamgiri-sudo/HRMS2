-- Housing Owner's "Sale Raw" (per its own SOP: "Open the Sale Raw Google
-- Sheet... Copy the required Sale data up to the Discount % column...
-- Paste the data into the Sale Raw sheet" -- no DB backing exists anywhere).
-- Columns read directly from a real sample: "Housing Owner Sep'26.xlsx",
-- sheet "Sale Raw" (downloaded via the user's own authenticated Drive
-- session). The sheet's real columns run: Date, Agent ID, Agent Name,
-- Value, Count, Payment Mode, Package Name, Package Type, Opp ID,
-- Discount % (the SOP's own "up to Discount %" boundary), then TL Name,
-- Week, Month, Day, AM -- the last three are redundant with Date and are
-- deliberately not stored.
CREATE TABLE IF NOT EXISTS housing_owner_sale_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  opp_id VARCHAR(50) NOT NULL,
  report_date DATE NOT NULL,
  agent_id VARCHAR(50) NULL,
  agent_name VARCHAR(255) NULL,
  tl_name VARCHAR(255) NULL,
  value DECIMAL(12,2) NOT NULL DEFAULT 0,
  sale_count INT NOT NULL DEFAULT 1,
  payment_mode VARCHAR(100) NULL,
  package_name VARCHAR(100) NULL,
  package_type VARCHAR(100) NULL,
  discount_pct DECIMAL(6,2) NULL,
  week_label VARCHAR(20) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_housing_owner_sale_raw (process_id, opp_id, source_reference),
  KEY idx_housing_owner_sale_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Housing Owner's sibling "Call Logs" sheet's own table
-- (housing_owner_call_logs) was RETRACTED 2026-09-10: db_masmis.
-- CR_housing_owner already carries this exact call performance data live,
-- sourced from the same Tata Teleservices dialer (its recording URLs are
-- literally https://cloudphone.tatateleservices.com/..., matching this
-- sheet's own "1. Tata Dialer Report" SOP heading). See
-- runPendingMigrations.ts's retraction comment for sql/1708.

DELETE FROM upload_template_master WHERE upload_type_code IN ('HOUSING_OWNER_SALE_RAW', 'HOUSING_OWNER_CALL_LOGS');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'HOUSING_OWNER_SALE_RAW', 'Housing Owner — Sale Raw', 'housing_owner_sale_raw',
   'Per-order Housing Owner sales, per its own SOP Sale Raw sheet (no DB backing exists).',
   JSON_ARRAY('Opp_ID', 'Date', 'Value'),
   JSON_ARRAY('Agent_ID', 'Agent_Name', 'TL_Name', 'Count', 'Payment_Mode', 'Package_Name', 'Package_Type', 'Discount_Pct', 'Week'),
   JSON_OBJECT('Opp_ID', '11904708', 'Date', '2026-09-01', 'Agent_ID', '109221296', 'Agent_Name', 'Himanshu Kumar MCN', 'TL_Name', 'Vintage', 'Value', 3245, 'Count', 1, 'Payment_Mode', 'Payment Link', 'Package_Name', 'RENT', 'Package_Type', 'ASSISTED', 'Discount_Pct', 49.99, 'Week', '1-10 Aug'),
   1);
