-- Housing Premium's own "Team Details" sheet -- found while auditing every
-- sheet of the same real workbook already downloaded this session for
-- Sale Raw (sql/1706), not named in Housing Premium's own SOP text, but
-- real data with no DB backing anywhere: per-agent monthly sales target,
-- achievement and TL assignment. Verified live: all 3 MAS codes sampled
-- (MAS62015/MAS61068/MAS62014) resolve to real, active employees.employee_
-- code rows with matching names (Abhay/Abhinav Srivastava/Arpit Gangwar).
--
-- This is a different granularity than housing_premium_sale_raw's own
-- per-row `target` field (sql/1706) -- that one is process-level per order;
-- this is per-agent per reporting period. The sheet carries no per-row
-- date of its own (it is a point-in-time snapshot, refreshed as the
-- workbook is refreshed) -- report_period (e.g. "2026-08") is supplied at
-- upload time, not invented from the filename.
--
-- target_amount/achievement_pct are nullable: an "InActive" agent's row
-- shows a literal "-" placeholder in both the source's own Target and Ach%
-- columns, meaning "no target set" -- not zero.
CREATE TABLE IF NOT EXISTS housing_premium_agent_target (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_period CHAR(7) NOT NULL,
  mas_employee_code VARCHAR(50) NOT NULL,
  agent_name VARCHAR(255) NULL,
  tl_name VARCHAR(255) NULL,
  center VARCHAR(100) NULL,
  doj DATE NULL,
  tenure_days INT NULL,
  tenure_bucket VARCHAR(50) NULL,
  target_amount DECIMAL(12,2) NULL,
  achievement_amount DECIMAL(12,2) NULL,
  achievement_pct DECIMAL(8,4) NULL,
  status VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_housing_premium_agent_target (process_id, report_period, mas_employee_code),
  KEY idx_housing_premium_agent_target_period (process_id, report_period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'HOUSING_PREMIUM_AGENT_TARGET';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'HOUSING_PREMIUM_AGENT_TARGET', 'Housing Premium — Agent Target & Achievement', 'housing_premium_agent_target',
   'Housing Premium''s own Team Details sheet: per-agent monthly sales target, achievement and TL assignment (no DB backing exists). Report_Period must be supplied at upload time -- the sheet carries no date column of its own.',
   JSON_ARRAY('Emp_ID', 'Report_Period'),
   JSON_ARRAY('Agent_Name', 'TL_Name', 'Center', 'DOJ', 'Tenure', 'Tenure_Bucket', 'Target', 'Achievement', 'Ach_Pct', 'Status'),
   JSON_OBJECT('Emp_ID', 'MAS62015', 'Report_Period', '2026-08', 'Agent_Name', 'Abhay Jadaun', 'TL_Name', 'Vikarm', 'Center', 'MCN', 'DOJ', '2026-03-21', 'Tenure', 161, 'Tenure_Bucket', '120-180', 'Target', 80000, 'Achievement', 75986, 'Ach_Pct', 94.98, 'Status', 'Active'),
   1);
