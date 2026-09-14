-- Clovia's own "Team Allignment" sheet -- found while auditing every sheet
-- of "Clovia_Performance_Dashboard Report Sept26 (1).xlsb" (the same
-- workbook family already used this session for Chat Performance/CRM
-- Disposition), not named in Clovia Steps.docx's own SOP text, but real
-- data with no DB backing anywhere: an agent roster with TL/LOB assignment
-- and login email. Verified live: all 4 real MAS codes sampled resolve to
-- real, active employees.employee_code rows with matching names (Kanishka
-- Sharma, Rashmi, Jagjeet Kaur, Shubha Jain Sharma).
--
-- A directory table, not a daily-actual: re-upload replaces the current
-- roster row per (process, emp code), same pattern as du_team_mapping
-- (sql/1714).
CREATE TABLE IF NOT EXISTS clovia_team_alignment (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  mas_employee_code VARCHAR(50) NOT NULL,
  email VARCHAR(255) NULL,
  agent_name VARCHAR(255) NULL,
  team_leader VARCHAR(255) NULL,
  lob VARCHAR(100) NULL,
  employment_type VARCHAR(50) NULL,
  doj DATE NULL,
  status VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_team_alignment (process_id, mas_employee_code),
  KEY idx_clovia_team_alignment_lob (lob)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_TEAM_ALIGNMENT';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'CLOVIA_TEAM_ALIGNMENT', 'Clovia — Team Alignment', 'clovia_team_alignment',
   'Clovia''s own Team Allignment sheet: agent roster with TL/LOB assignment (no DB backing exists).',
   JSON_ARRAY('EMP'),
   JSON_ARRAY('Email_ID', 'Agent_Name', 'Team_Leader', 'LOB', 'PTO', 'DOJ', 'Status'),
   JSON_OBJECT('EMP', 'MAS56101', 'Email_ID', 'kanishka.sharma@clovia.com', 'Agent_Name', 'Kanishka', 'Team_Leader', 'Aashima Kapila', 'LOB', 'Email', 'PTO', 'Production', 'DOJ', '2024-05-23', 'Status', 'Active'),
   1);
