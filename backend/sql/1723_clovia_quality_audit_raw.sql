-- Clovia's own "Quality Raw" sheet -- found while auditing every sheet of
-- the same workbook family already used this session for Chat Performance/
-- CRM Disposition/Team Alignment/APR Utilization/IB+Outbound CDR Raw/
-- Feedback/Rechurn Calls, not named in Clovia Steps.docx's own SOP text,
-- but real data with no DB backing anywhere: a per-chat/email QA audit
-- scorecard, 44 real rows in the sample file. Verified live: all 3 real
-- MAS codes sampled resolve to real employees.employee_code rows with
-- matching names.
--
-- Row identity verified live across all 44 real rows with zero collisions:
-- (the sheet's own "Unique" column [Date+EMP ID concatenation], Chat ID) --
-- neither alone is unique (the same agent is audited more than once per
-- day, and the same Chat ID can recur across audit cycles).
--
-- Fatal/ACPT/ACPT Reason are kept as free text/nullable, not coerced into a
-- boolean -- their real values ('1', 'Process', 'Customer') don't map to an
-- obvious flag without more context from the QA team, so this stores them
-- verbatim rather than guessing a meaning.
CREATE TABLE IF NOT EXISTS clovia_quality_audit_raw (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  report_date DATE NOT NULL,
  chat_mail_date DATE NULL,
  audit_date DATE NULL,
  unique_ref VARCHAR(100) NOT NULL,
  chat_id VARCHAR(50) NOT NULL,
  mas_employee_code VARCHAR(50) NULL,
  agent_name VARCHAR(255) NULL,
  tl_name VARCHAR(255) NULL,
  chat_source VARCHAR(50) NULL,
  cx_query VARCHAR(255) NULL,
  frt_shared_score DECIMAL(6,2) NULL,
  correct_info_score DECIMAL(6,2) NULL,
  soft_skills_score DECIMAL(6,2) NULL,
  reminder_shared_score DECIMAL(6,2) NULL,
  concern_resolved_score DECIMAL(6,2) NULL,
  tagging_shared_score DECIMAL(6,2) NULL,
  aoi VARCHAR(255) NULL,
  lob VARCHAR(50) NULL,
  week_label VARCHAR(20) NULL,
  cq_score DECIMAL(6,4) NULL,
  fatal VARCHAR(50) NULL,
  acpt VARCHAR(100) NULL,
  acpt_reason VARCHAR(255) NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_quality_audit_raw (process_id, unique_ref, chat_id, source_reference),
  KEY idx_clovia_quality_audit_raw_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_QUALITY_AUDIT';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description, required_columns, optional_columns, sample_row, active_status)
VALUES
  (UUID(), 'CLOVIA_QUALITY_AUDIT', 'Clovia — Quality Audit', 'clovia_quality_audit_raw',
   'Clovia''s own Quality Raw sheet: per-chat/email QA audit scorecard (no DB backing exists).',
   JSON_ARRAY('Unique', 'Chat_ID', 'Chat_Mail_Date'),
   JSON_ARRAY('Audit_Date', 'Emp_ID', 'Emp_Name', 'TL', 'Chat_Source', 'Cx_Query', 'FRT_Score', 'Correct_Info_Score', 'Soft_Skills_Score', 'Reminder_Score', 'Concern_Resolved_Score', 'Tagging_Score', 'AOI', 'LOB', 'Week', 'CQ_Score', 'Fatal', 'ACPT', 'ACPT_Reason'),
   JSON_OBJECT('Unique', '46266MAS57695', 'Chat_ID', '4724991', 'Chat_Mail_Date', '2026-09-01', 'Emp_ID', 'MAS57695', 'Emp_Name', 'Rashmi Singh', 'TL', 'Aashima Kapila', 'Chat_Source', 'Email', 'Cx_Query', 'Sap_Issue', 'FRT_Score', 15, 'Correct_Info_Score', 17, 'Soft_Skills_Score', 17, 'Reminder_Score', 17, 'Concern_Resolved_Score', 17, 'Tagging_Score', 17, 'AOI', 'No error found.', 'LOB', 'Email', 'Week', 'Week-1', 'CQ_Score', 1.0, 'Fatal', '1', 'ACPT', 'Process', 'ACPT_Reason', 'Refund not released'),
   1);
