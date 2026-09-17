-- Migration 1806: Per-analyst breakdown for Molecular Email / Reginald Men Email tickets.
--
-- Owner report ("HRMS Issue and observation Reginald & GS1" -- Reginald sheet): "Molecular
-- EmailAP" and "Reginald EmailAPR" Tickets tabs "Don't Have any analyst Email view like Email
-- Receive, Closed, Pending Reopen, Pending" -- the existing Tickets tab (email_ticket_daily_actual,
-- email-ticket.service.ts) only shows day-wise TOTALS across every analyst, with no per-person
-- breakdown at all.
--
-- molecular-email-sync.service.ts's own doc-comment already corrected an earlier (2026-09-09)
-- audit's wrong claim that the upstream ticketing DB "does not exist anywhere in this project's
-- infrastructure" -- it lives at MOLECULAR_EMAIL_DB_HOST (db_email = Reginald, molecular_db_email
-- = Molecular) and is live-synced today. Confirmed live: tickets.assigned_to and
-- ticket_messages.created_by are both real user ids joining to users.id/users.name -- a per-analyst
-- breakdown is directly derivable from the same live source the day-wise sync already reads,
-- no new upload format needed.
--
-- One row per (dashboard, analyst, day), same shape as email_ticket_daily_actual minus
-- opening_pending (that field is a report-wide balance carried forward across ALL analysts'
-- backlog together in the source Apps Script; it has no clean per-analyst decomposition, so it
-- is deliberately left off this table rather than guessed).
CREATE TABLE IF NOT EXISTS email_ticket_analyst_daily_actual (
  id CHAR(36) NOT NULL PRIMARY KEY,
  process_id CHAR(36) NOT NULL,
  dashboard_label ENUM('MOLECULAR', 'REGINALD_MEN') NOT NULL,
  report_date DATE NOT NULL,
  analyst_user_id INT NOT NULL,
  analyst_name VARCHAR(200) NOT NULL,
  tickets_received INT NOT NULL DEFAULT 0,
  tickets_closed INT NOT NULL DEFAULT 0,
  tickets_reopened INT NOT NULL DEFAULT 0,
  tickets_open_pending INT NOT NULL DEFAULT 0,
  data_source VARCHAR(100) NOT NULL DEFAULT 'live_sync',
  source_reference VARCHAR(255) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_ticket_analyst_daily (process_id, dashboard_label, report_date, analyst_user_id),
  KEY idx_email_ticket_analyst_daily_process_date (process_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
