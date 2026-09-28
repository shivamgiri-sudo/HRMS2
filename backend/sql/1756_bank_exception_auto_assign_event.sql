-- 1756_bank_exception_auto_assign_event.sql
--
-- Seeds ONE notification_event_config row for the bank-payment-readiness auto-assign feature:
-- when an employee's bank record is classified INVALID, MISSING or CONFLICT and nobody has
-- claimed the exception yet, bank-manual-review-assign.service.ts auto-assigns it to the
-- branch's payroll HR and fires this event to the employee, their reporting manager, and the
-- assigned payroll HR -- so a blocked salary is not silently sitting unowned until someone
-- happens to open the Exceptions tab.
--
-- Additive, idempotent: CREATE TABLE IF NOT EXISTS (matches 1022's shape exactly, no new
-- columns needed) + INSERT IGNORE. Re-running changes nothing.
--
-- sensitivity='conf', not 'fin': this event names WHO to fix a bank record, never a salary
-- amount or account number (the account is masked everywhere outside /payment-file already).
-- All three recipients sit in `to` with no cc, so it would satisfy the fin-sensitivity CC rule
-- too, but 'conf' is the correct category regardless.
--
-- Lands enabled=1, dispatch_mode='live' directly (unlike 1022's seed-then-enable-later
-- pattern) because this is a single new event for a single new feature being built and shipped
-- together, not a phase-1 bulk seed awaiting a later go-live decision per event.

CREATE TABLE IF NOT EXISTS notification_event_config (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  event_code        VARCHAR(80)   NOT NULL,
  module            VARCHAR(40)   NOT NULL,
  display_name      VARCHAR(160)  NOT NULL,
  description       VARCHAR(500)  NULL,
  enabled           TINYINT(1)    NOT NULL DEFAULT 0,
  dispatch_mode     ENUM('shadow','live','off') NOT NULL DEFAULT 'shadow',
  channels          VARCHAR(80)   NOT NULL DEFAULT 'email',
  is_critical       TINYINT(1)    NOT NULL DEFAULT 0,
  sensitivity       ENUM('int','conf','fin') NOT NULL DEFAULT 'int',
  recipient_spec    JSON          NOT NULL,
  backfill_floor_at DATETIME      NULL,
  max_per_run       INT UNSIGNED  NOT NULL DEFAULT 50,
  max_per_day       INT UNSIGNED  NOT NULL DEFAULT 500,
  cooldown_minutes  INT UNSIGNED  NOT NULL DEFAULT 1440,
  template_key      VARCHAR(120)  NULL,
  active_status     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_nec_event (event_code),
  KEY idx_nec_enabled (enabled, dispatch_mode),
  KEY idx_nec_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, description, enabled, dispatch_mode, sensitivity, is_critical,
   recipient_spec, cooldown_minutes, template_key)
VALUES
('bank_exception_invalid_assigned', 'payroll',
 'Bank record blocked — assigned for correction',
 'Fired once, the first time an employee''s bank-payment-readiness exception (INVALID malformed IFSC/account, MISSING no record, or CONFLICT disagreeing sources) is auto-assigned to their branch payroll HR because nobody had claimed it yet. Never re-fires for the same employee/reason once a human (or this same auto-assign pass) has set an owner -- see the ON DUPLICATE KEY UPDATE guard in bank-manual-review-assign.service.ts, which only ever sets a null owner and never overwrites one.',
 1, 'live', 'conf', 0,
 '{"to":[{"kind":"employee"},{"kind":"reporting_manager"},{"kind":"payroll_hr"}]}',
 -- Long cooldown: this fires once per employee by construction (the owner-assignment guard),
 -- so the cooldown is a backstop, not the primary de-dupe mechanism.
 43200,
 NULL);

UPDATE notification_event_config
   SET backfill_floor_at = NOW()
 WHERE event_code = 'bank_exception_invalid_assigned' AND backfill_floor_at IS NULL;

-- Verification (run after applying):
--   SELECT event_code, enabled, dispatch_mode, sensitivity, recipient_spec
--     FROM notification_event_config WHERE event_code = 'bank_exception_invalid_assigned';
--   -- expect enabled=1, dispatch_mode='live', sensitivity='conf', to=[employee,reporting_manager,payroll_hr]
