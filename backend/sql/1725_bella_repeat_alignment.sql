-- Bella Vita Repeat LOB's own "Alignment" sheet -- found while auditing
-- every sheet of "Bella Vita Repeat LOB Mis Dashboard July26.xlsb", not
-- named in BELLAVITA Dashboard.docx's own SOP text, but real data with no
-- DB backing anywhere: an agent roster with TL assignment, DOJ and status.
--
-- A directory table, not a daily-actual: re-upload replaces the current
-- roster row per (process, MAS ID), same pattern as du_team_mapping
-- (sql/1714) and clovia_team_alignment (sql/1717). MAS ID alone is the
-- identity -- the one real collision found live (MAS62717, "VIVEK" then
-- "VIVEK SHARMA" with a later DOJ) is a genuine same-person data
-- correction between rows, exactly what upsert-by-MAS-ID is for.
CREATE TABLE IF NOT EXISTS bella_repeat_alignment (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  mas_employee_code VARCHAR(50) NOT NULL,
  agent_name VARCHAR(255) NULL,
  team_leader VARCHAR(255) NULL,
  doj DATE NULL,
  agent_period VARCHAR(50) NULL,
  status VARCHAR(50) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bella_repeat_alignment (process_id, mas_employee_code),
  KEY idx_bella_repeat_alignment_tl (team_leader)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'BELLA_REPEAT_ALIGNMENT';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'BELLA_REPEAT_ALIGNMENT', 'Bella Vita Repeat LOB — Alignment', 'bella_repeat_alignment',
   'Bella Vita Repeat LOB''s own Alignment sheet: agent roster with TL assignment (no DB backing exists).',
   JSON_ARRAY('MAS_ID'),
   JSON_ARRAY('Agent_Name', 'TL', 'DOJ', 'Agent_Period', 'Status'),
   JSON_OBJECT('MAS_ID', 'MAS50846', 'Agent_Name', 'CHANCHAL', 'TL', 'Kripa', 'DOJ', '2022-09-25', 'Agent_Period', 'BAU', 'Status', 'Active'),
   1);
