-- Who receives each branch's provisioning notifications, configured explicitly.
--
-- Recipients are currently derived from three places with different semantics —
-- user_assignment_scope (the TO), employees.reporting_manager_id (a CC), and
-- branch_master.hr_contact (a CC fallback). Nothing states the intent, so a
-- wrong row is invisible until someone notices the mail went to the wrong desk.
-- NOIDA-2's admin task was routed to a Training & Quality employee for exactly
-- that reason, and before that a join against an always-NULL column sent one
-- joiner's tasks to 51 people company-wide.
--
-- This table is the stated intent. The derived chain remains as the fallback,
-- so nothing breaks for a branch that has not been configured yet.
--
-- Deliberately NOT another parallel surface. Two earlier attempts at this exist
-- and were never adopted — branch_wfm_spoc_config (0 rows) and
-- notification_event_config.recipient_spec (53 rows, every one disabled). The
-- resolver reads THIS table first and falls back to the derived chain; it does
-- not consult those.
--
-- Keyed on (branch_id, event_code) rather than a role, so adding a new
-- notification type later is data rather than a migration. event_code holds the
-- provisioning task_code today: IT_EMAIL_DOMAIN_ASSET, ADMIN_BIOMETRIC_ID_CARD,
-- WFM_PROCESS_ALIGNMENT, APPOINTMENT_LETTER_ESIGN.

CREATE TABLE IF NOT EXISTS branch_notification_recipient (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  branch_id       CHAR(36)     NOT NULL,
  -- Provisioning task_code today; any notification event later.
  event_code      VARCHAR(80)  NOT NULL,
  recipient_type  ENUM('to','cc') NOT NULL DEFAULT 'to',

  -- Either a linked employee, or a plain address. Shared mailboxes are real
  -- SPOCs here — it.jaipur@teammas.in already is one — and have no employee
  -- record, so an employee-only design would exclude them.
  employee_id     CHAR(36)     NULL,
  email           VARCHAR(255) NULL,

  -- Free-text note, e.g. why a shared mailbox is used.
  remarks         VARCHAR(255) NULL,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_by      CHAR(36)     NULL,
  updated_by      CHAR(36)     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_bnr_lookup (branch_id, event_code, active_status),
  INDEX idx_bnr_employee (employee_id),

  -- A row that names neither an employee nor an address configures nothing.
  CONSTRAINT chk_bnr_target CHECK (employee_id IS NOT NULL OR email IS NOT NULL)
)
-- employees.id is utf8mb4_unicode_ci; without this an FK to it fails with
-- errno 3780 on this server.
ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stops the same person being added twice for one branch+event+type, which
-- would duplicate their email.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch_notification_recipient'
                AND INDEX_NAME = 'uq_bnr_target');
SET @sql := IF(@has = 0,
  'ALTER TABLE branch_notification_recipient
     ADD UNIQUE KEY uq_bnr_target (branch_id, event_code, recipient_type, employee_id, email)',
  'SELECT ''uq_bnr_target present'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
