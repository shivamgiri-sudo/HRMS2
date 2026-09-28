-- Molecular Email / Reginald Men Email dashboards read from an external MySQL
-- DB (molecular_db_email: tickets, ticket_messages, ticket_events, users) that
-- does not exist anywhere in this project's infrastructure -- confirmed via
-- SHOW DATABASES on every host this project has ever touched (2026-09-09
-- audit). Per the SOP's own "Day Wise Table" / Raw Export shape (Date, Total
-- Tickets, Email Closure, Open/Pending, Reopen, Opening Pending), this table
-- accepts that same daily granularity as a manual bulk upload -- the exact
-- reconciliation grain the SOP itself checks ("Sum rows vs top totals").
--
-- dashboard_label distinguishes Molecular Email vs Reginald Men Email (two
-- separate report instances of the identical shape, per their SOPs); both are
-- linked to process_id because only one "Reginald" process exists in
-- process_master today -- if these are ever split into distinct processes,
-- this column is what makes that split possible without a schema change.
CREATE TABLE IF NOT EXISTS email_ticket_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dashboard_label ENUM('MOLECULAR', 'REGINALD_MEN') NOT NULL,
  report_date DATE NOT NULL,
  total_tickets INT NOT NULL DEFAULT 0,
  email_closed INT NOT NULL DEFAULT 0,
  open_pending INT NOT NULL DEFAULT 0,
  email_reopen INT NOT NULL DEFAULT 0,
  -- Needed for closure % = closed / (opening_pending + total_tickets + reopen);
  -- not derivable from the other columns, so it is its own input, per the SOP.
  opening_pending INT NULL,
  data_source VARCHAR(100) NOT NULL DEFAULT 'bulk_upload',
  source_reference VARCHAR(255) NULL,
  upload_batch_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- One row per dashboard per day per upload source; a re-upload of the same
  -- day from the same batch updates rather than duplicates, but two different
  -- batches for the same day are kept distinct on purpose (same reasoning as
  -- process_delivery_actual: re-uploads must not silently collide).
  UNIQUE KEY uq_email_ticket_daily (process_id, dashboard_label, report_date, source_reference),
  KEY idx_email_ticket_daily_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELETE FROM upload_template_master WHERE upload_type_code = 'EMAIL_TICKET_DAILY';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES
(UUID(), 'EMAIL_TICKET_DAILY', 'Molecular / Reginald Men Email Tickets (Daily)',
 'email_ticket_daily_actual',
 'Daily ticket counts for the Molecular Email and Reginald Men Email dashboards. The underlying ticketing DB (molecular_db_email: tickets, ticket_messages, ticket_events, users) does not exist anywhere in this project''s infrastructure, so this is the manual path -- same daily grain as the dashboard''s own SOP "Day Wise Table" and Raw Export (Date, Total Tickets, Email Closure, Open/Pending, Reopen), plus Opening Pending which the SOP states feeds the closure% denominator and is not derivable from the others. Each row upserts one email_ticket_daily_actual row for the given Dashboard + Date.',
 JSON_ARRAY('Dashboard','Date','Total Tickets','Email Closure','Open/Pending','Reopen'),
 JSON_ARRAY('Opening Pending'),
 JSON_OBJECT(
   'Dashboard','Molecular Email',
   'Date','2026-09-08',
   'Total Tickets','412',
   'Email Closure','389',
   'Open/Pending','61',
   'Reopen','14',
   'Opening Pending','58'
 ), 1);
