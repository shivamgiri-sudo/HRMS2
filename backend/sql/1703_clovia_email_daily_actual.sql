-- Clovia's "Email Dashboard" (per its own SOP: "Email Assign tracker, Email
-- Tracker" sheets, no DB backing anywhere) -- unlike most of the Report
-- Builder SOP gaps, a real sample file was found and read directly:
-- "Clovia Email Tracker Sept'26.xlsb" (Drive folder named in the SOP),
-- sheet "Raw". Columns taken verbatim from that live file:
-- Week, Date, AgentName, Open Email, In Process, Re-Open,
-- Total Mail Assigned, Total Touched Email, Closed Email, JunkMail.
--
-- Date is an Excel serial number in the source file (e.g. 46266 = a real
-- date in 2026), not text -- converted to a real DATE at import time.
CREATE TABLE IF NOT EXISTS clovia_email_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  agent_name VARCHAR(255) NOT NULL,
  report_date DATE NOT NULL,
  week_label VARCHAR(20) NULL,
  open_email INT NOT NULL DEFAULT 0,
  in_process INT NOT NULL DEFAULT 0,
  re_open INT NOT NULL DEFAULT 0,
  total_mail_assigned INT NOT NULL DEFAULT 0,
  total_touched_email INT NOT NULL DEFAULT 0,
  closed_email INT NOT NULL DEFAULT 0,
  junk_mail INT NOT NULL DEFAULT 0,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clovia_email_daily (process_id, agent_name, report_date, source_reference),
  KEY idx_clovia_email_daily_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'CLOVIA_EMAIL_DAILY';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES
(UUID(), 'CLOVIA_EMAIL_DAILY', 'Clovia Email Tracker (Daily, per agent)',
 'clovia_email_daily_actual',
 'Daily per-agent email counts for Clovia''s Email Dashboard, columns taken verbatim from the live "Clovia Email Tracker Sept''26.xlsb" workbook''s Raw sheet -- no DB backing exists for this data anywhere.',
 JSON_ARRAY('Date','AgentName','Open Email','In Process','Re-Open','Total Mail Assigned','Total Touched Email','Closed Email'),
 JSON_ARRAY('Week','JunkMail'),
 JSON_OBJECT(
   'Week','Week-1',
   'Date','2026-09-01',
   'AgentName','Kanishka',
   'Open Email','56',
   'In Process','9',
   'Re-Open','39',
   'Total Mail Assigned','104',
   'Total Touched Email','104',
   'Closed Email','47',
   'JunkMail','3'
 ), 1);
