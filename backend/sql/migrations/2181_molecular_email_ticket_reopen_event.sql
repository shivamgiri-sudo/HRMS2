-- 2181_molecular_email_ticket_reopen_event.sql
--
-- Molecular Email Dashboard: every Closed->Open event of a synced ticket (source
-- ticket_events), so the "Closed vs Reopened" trend can plot reopen EVENTS by event date
-- while molecular_email_ticket.reopen_count keeps the per-ticket total. A ticket reopened
-- twice = 1 unique reopened ticket, 2 rows here. The sync replaces a ticket's rows each time
-- it re-reads that ticket (seq = event order).
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS molecular_email_ticket_reopen_event (
  ticket_id VARCHAR(64) NOT NULL,
  seq INT NOT NULL,
  event_at DATETIME NOT NULL,
  PRIMARY KEY (ticket_id, seq),
  KEY idx_mol_reopen_event_at (event_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
