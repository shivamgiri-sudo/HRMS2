-- 2180_molecular_email_ticket.sql
--
-- Molecular Email Dashboard (MOL-02..MOL-06): one row per Molecular ticket, keyed by the
-- source ticket id, synced read-only from molecular_db_email (tickets / ticket_events /
-- ticket_messages / users) by molecular-email-sync.service.ts. The older daily-count table
-- (email_ticket_daily_actual) counted events, not tickets: a reopened ticket was counted
-- once per event and closures were outbound-message counts. This table keeps each ticket
-- once, so received/closed/reopened are unique-ticket counts and TAT is per ticket.
--
-- Timestamps are IST wall-clock, as read from the source pool (timezone +05:30).
-- category / priority are NULL when the source schema has no such column (the dashboard
-- shows N/A then). closure_basis says where final_closed_at came from: the source's own
-- closed column ('closed_at') or the agent's last outbound reply ('last_agent_reply'), the
-- source's only closure signal. dq_flag marks rows whose timestamps cannot give a valid TAT
-- (they still count as received/closed, but stay out of TAT averages, buckets and SLA %).
--
-- No process_id on purpose: Molecular has no process_master row and must not be attached to
-- Reginald (REG-07). Additive and idempotent: CREATE TABLE IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS molecular_email_ticket (
  ticket_id VARCHAR(64) NOT NULL PRIMARY KEY,
  created_at DATETIME NULL,
  agent_user_id VARCHAR(64) NULL,
  agent_name VARCHAR(200) NULL,
  category VARCHAR(200) NULL,
  priority VARCHAR(100) NULL,
  status VARCHAR(100) NULL,
  first_closed_at DATETIME NULL,
  final_closed_at DATETIME NULL,
  reopen_count INT NOT NULL DEFAULT 0,
  first_reopened_at DATETIME NULL,
  last_reopened_at DATETIME NULL,
  closure_basis VARCHAR(32) NULL,
  dq_flag VARCHAR(40) NULL,
  raw_created_at VARCHAR(40) NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mol_ticket_created (created_at),
  KEY idx_mol_ticket_final_closed (final_closed_at),
  KEY idx_mol_ticket_status (status),
  KEY idx_mol_ticket_agent (agent_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
