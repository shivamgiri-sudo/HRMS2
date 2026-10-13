-- 2195_email_ticket_source.sql
--
-- The per-ticket tables from 2180/2181 now hold tickets of two email dashboards that read the
-- same ticketing server/schema: 'molecular' (database molecular_db_email) and 'reginald'
-- (database db_email, Reginald Men). Ticket ids are only unique within one source database, so
-- `source` becomes part of each key: (source, ticket_id) and (source, ticket_id, seq).
-- Existing rows (Molecular only) take the DEFAULT 'molecular'.
--
-- Both tables were empty on prod when this was written, so the key swap is instant. Every step
-- is guarded through information_schema, so re-running is a no-op. MySQL 8.0.42 syntax only.

-- molecular_email_ticket.source
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'molecular_email_ticket' AND COLUMN_NAME = 'source') = 0,
  'ALTER TABLE molecular_email_ticket ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT ''molecular'' FIRST',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- molecular_email_ticket primary key -> (source, ticket_id)
SET @s = IF((SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'molecular_email_ticket' AND CONSTRAINT_NAME = 'PRIMARY' AND COLUMN_NAME = 'source') = 0,
  'ALTER TABLE molecular_email_ticket DROP PRIMARY KEY, ADD PRIMARY KEY (source, ticket_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Period reads filter by source + created_at.
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'molecular_email_ticket' AND INDEX_NAME = 'idx_mol_ticket_source_created') = 0,
  'ALTER TABLE molecular_email_ticket ADD INDEX idx_mol_ticket_source_created (source, created_at)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- molecular_email_ticket_reopen_event.source
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'molecular_email_ticket_reopen_event' AND COLUMN_NAME = 'source') = 0,
  'ALTER TABLE molecular_email_ticket_reopen_event ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT ''molecular'' FIRST',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- molecular_email_ticket_reopen_event primary key -> (source, ticket_id, seq)
SET @s = IF((SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'molecular_email_ticket_reopen_event' AND CONSTRAINT_NAME = 'PRIMARY' AND COLUMN_NAME = 'source') = 0,
  'ALTER TABLE molecular_email_ticket_reopen_event DROP PRIMARY KEY, ADD PRIMARY KEY (source, ticket_id, seq)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
