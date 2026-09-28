-- DU Digital's Korea/Thailand MIS Dashboards each carry a "Team Details"
-- sheet mapping the dialer's Agent ID to a real MAS employee code -- found
-- while auditing every sheet of the same two real workbooks already
-- downloaded this session for DU APR (sql/1710), not named in DU.docx's own
-- SOP text, but real data with no DB backing anywhere. Verified live against
-- employees: all 6 real MAS IDs sampled from both sheets resolve to real
-- employee_code rows (RAVIRANJAN KUMAR/MAS59391, KUM KHUSHI/MAS59256, MD
-- SARFARAZ ALAM/MAS59390, AYUSH SINGH/MAS59392, SHIMRAN SUBBA/MAS59728,
-- TANUSHREE PRADHAN/MAS52098 -- name spellings differ slightly between the
-- dialer export and the employee master, as expected, but the codes match).
-- Thailand also carries non-MAS codes (e.g. "DUT07", "DUT12") for agents
-- with no employees row -- likely local/contracted staff -- kept as free
-- text, not forced to resolve.
--
-- This is a directory table, not a daily-actual table: no report_date,
-- re-upload simply replaces the current mapping per (process, dashboard,
-- agent_id).
CREATE TABLE IF NOT EXISTS du_team_mapping (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dashboard_label ENUM('KOREA','THAILAND') NOT NULL,
  agent_id VARCHAR(50) NOT NULL,
  agent_name VARCHAR(255) NULL,
  mas_employee_code VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_du_team_mapping (process_id, dashboard_label, agent_id),
  KEY idx_du_team_mapping_mas_code (mas_employee_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code IN ('DU_TEAM_MAPPING_KOREA', 'DU_TEAM_MAPPING_THAILAND');

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'DU_TEAM_MAPPING_KOREA', 'DU Digital — Team Mapping (Korea)', 'du_team_mapping',
   'DU Digital''s Agent ID -> MAS employee code directory, Korea dashboard, per its own Team Details sheet (no DB backing exists).',
   JSON_ARRAY('Agent_ID'),
   JSON_ARRAY('Agent_Name', 'MAS_ID'),
   JSON_OBJECT('Agent_ID', 'Agent7004', 'Agent_Name', 'Ravi Kumar', 'MAS_ID', 'MAS59391'),
   1),
  (UUID(), 'DU_TEAM_MAPPING_THAILAND', 'DU Digital — Team Mapping (Thailand)', 'du_team_mapping',
   'DU Digital''s Agent ID -> MAS employee code directory, Thailand dashboard, per its own Team Details sheet (no DB backing exists).',
   JSON_ARRAY('Agent_ID'),
   JSON_ARRAY('Agent_Name', 'MAS_ID'),
   JSON_OBJECT('Agent_ID', 'Agent7006', 'Agent_Name', 'Montri', 'MAS_ID', 'DUT07'),
   1);
