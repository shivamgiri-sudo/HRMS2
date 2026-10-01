-- One row per pendency reminder email actually attempted (ESI documents, bank account,
-- DigiLocker). This is both the audit trail ("who was reminded, about what, when, by
-- whom") and the cooldown source: the sender reads the last row per (employee, kind) to
-- enforce the minimum gap and the maximum number of reminders.
--
-- Deliberately no FOREIGN KEY on employee_id: employees.id collation differs between
-- environments and a mismatched FK fails the whole migration (the 1500/1536 trap). The
-- index below is what the cooldown lookup needs.
CREATE TABLE IF NOT EXISTS pendency_reminder_log (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  employee_id     CHAR(36)      NOT NULL,
  reminder_kind   ENUM('esi_docs','bank_account','digilocker') NOT NULL,
  status          ENUM('sent','failed') NOT NULL,
  recipient       VARCHAR(255)  NULL,
  missing_items   JSON          NULL,
  link_url        VARCHAR(500)  NULL,
  trigger_source  ENUM('manual','scheduler') NOT NULL DEFAULT 'manual',
  sent_by         CHAR(36)      NULL,
  error_message   VARCHAR(500)  NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prl_employee_kind (employee_id, reminder_kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
