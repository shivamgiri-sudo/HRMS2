-- 1025_report_subscription.sql
--
-- Turns the on-demand report platform into scheduled email reports.
--
-- The pipeline already exists and works: report_request -> report-generation.worker ->
-- XLSX via buildSecureXlsxBuffer -> report_email_delivery -> retry ladder [0,5,30,120]min
-- -> report_audit_event. A subscription therefore does exactly one thing — insert a
-- report_request row on a schedule — and inherits generation, attachment, retry, the
-- official-email domain allowlist and the audit trail for free.
--
-- THE CONSTRAINT THAT MATTERS
-- report-worker-executor.ts implements exactly SIX report codes. Every other code in the
-- 89-entry catalog falls through to `default:` and returns a single row
-- { STATUS: 'PENDING_DEDICATED_BUILDER' }, which the XLSX builder writes and
-- report-email-delivery.worker.ts cheerfully emails. A subscription to any other code
-- would therefore deliver a placeholder spreadsheet on a schedule, forever, to management.
-- The allowlist below is enforced by a CHECK constraint rather than left to the UI,
-- because a UI-only guard is one API call away from being bypassed.
--
-- Additive. NOT EXECUTED against production (CLAUDE.md rule 4).

CREATE TABLE IF NOT EXISTS report_subscription (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  subscription_name   VARCHAR(160)  NOT NULL,
  report_code         VARCHAR(100)  NOT NULL,

  -- Filters passed straight through to report_request.requested_filters_json.
  filters_json        JSON          NULL,

  -- Schedule. Kept as an explicit frequency rather than raw cron: the existing workers
  -- poll on setInterval and there is no cron engine in the codebase (cron-parser is a
  -- dependency but only integration-scheduler.worker.ts uses it). An explicit frequency
  -- is also far easier to render honestly in the admin UI.
  frequency           ENUM('daily','weekly','monthly') NOT NULL,
  -- 0=Monday..6=Sunday for weekly; 1..28 for monthly (28 so every month has the day).
  day_of_week         TINYINT UNSIGNED NULL,
  day_of_month        TINYINT UNSIGNED NULL,
  hour_of_day         TINYINT UNSIGNED NOT NULL DEFAULT 8,
  timezone            VARCHAR(64)   NOT NULL DEFAULT 'Asia/Kolkata',

  -- Who receives it. Resolved by shared/recipient-resolver.ts at send time, NOT stored as
  -- addresses: a stored address survives the employee leaving the company.
  recipient_spec      JSON          NOT NULL,

  requested_format    ENUM('xlsx','csv','pdf') NOT NULL DEFAULT 'xlsx',

  -- Ships inactive. A subscription that starts emailing the moment it is created is how
  -- an admin discovers the feature by accident, at 8am, in the CEO's inbox.
  is_active           TINYINT(1)    NOT NULL DEFAULT 0,
  dispatch_mode       ENUM('shadow','live') NOT NULL DEFAULT 'shadow',

  owner_user_id       CHAR(36)      NOT NULL,
  last_run_at         DATETIME      NULL,
  next_run_at         DATETIME      NULL,
  last_status         VARCHAR(30)   NULL,
  last_error          TEXT          NULL,
  consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,

  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_rs_due (is_active, next_run_at),
  KEY idx_rs_owner (owner_user_id),
  KEY idx_rs_code (report_code),

  -- Only report codes with a real executor. Widen this ONLY when
  -- report-worker-executor.ts gains the corresponding case.
  CONSTRAINT chk_rs_report_code CHECK (report_code IN (
    'employee-master','headcount','attendance-daily',
    'leave-balance','payroll-register','birthday-list'
  ))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Run ledger — one row per subscription per scheduled slot.
--
-- uq_rsr_slot is what stops a restart, a clock skew or two workers racing from
-- generating the same weekly report twice. The slot key is derived, not wall-clock:
-- 'YYYY-MM-DD' for daily, ISO week for weekly, 'YYYY-MM' for monthly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_subscription_run (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()),
  subscription_id   CHAR(36)     NOT NULL,
  slot_key          VARCHAR(32)  NOT NULL,
  mode              ENUM('shadow','live') NOT NULL DEFAULT 'shadow',
  status            ENUM('claimed','requested','skipped','failed') NOT NULL DEFAULT 'claimed',
  recipient_count   INT UNSIGNED NOT NULL DEFAULT 0,
  report_request_ids JSON        NULL,
  error_message     TEXT         NULL,
  claimed_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at      DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rsr_slot (subscription_id, slot_key),
  KEY idx_rsr_time (claimed_at),
  CONSTRAINT fk_rsr_subscription FOREIGN KEY (subscription_id)
    REFERENCES report_subscription (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Seed the eight subscriptions from NOTIFICATION_CATALOGUE.md section 6.6.
--
-- All inactive and in shadow. owner_user_id is resolved to a super_admin so the rows are
-- valid; an operator reassigns ownership when activating. If no super_admin exists
-- (fresh database), nothing is seeded rather than inserting a dangling owner.
-- ---------------------------------------------------------------------------
INSERT INTO report_subscription
  (subscription_name, report_code, frequency, day_of_week, day_of_month, hour_of_day,
   recipient_spec, owner_user_id)
SELECT * FROM (
  SELECT 'Daily attendance — branch HR'  AS n, 'attendance-daily' AS c, 'daily'   AS f, NULL AS dw, NULL AS dm, 9 AS h,
         '{"to":[{"kind":"role_scope","roleKeys":["hr"]}],"cc":[{"kind":"role_scope","roleKeys":["branch_head"]}]}' AS r,
         (SELECT user_id FROM user_roles WHERE role_key='super_admin' AND active_status=1 ORDER BY created_at LIMIT 1) AS o
  UNION ALL SELECT 'Daily attendance — operations', 'attendance-daily', 'daily', NULL, NULL, 9,
         '{"to":[{"kind":"role_scope","roleKeys":["process_manager"]}]}',
         (SELECT user_id FROM user_roles WHERE role_key='super_admin' AND active_status=1 ORDER BY created_at LIMIT 1)
  UNION ALL SELECT 'Weekly headcount', 'headcount', 'weekly', 0, NULL, 8,
         '{"to":[{"kind":"role_scope","roleKeys":["hr"],"scope":{"type":"all"}}],"cc":[{"kind":"role_scope","roleKeys":["ceo"]}]}',
         (SELECT user_id FROM user_roles WHERE role_key='super_admin' AND active_status=1 ORDER BY created_at LIMIT 1)
  UNION ALL SELECT 'Weekly leave balance', 'leave-balance', 'weekly', 0, NULL, 8,
         '{"to":[{"kind":"role_scope","roleKeys":["hr"]}]}',
         (SELECT user_id FROM user_roles WHERE role_key='super_admin' AND active_status=1 ORDER BY created_at LIMIT 1)
  UNION ALL SELECT 'Monthly payroll register', 'payroll-register', 'monthly', NULL, 1, 7,
         '{"to":[{"kind":"role_scope","roleKeys":["finance"]}],"cc":[{"kind":"role_scope","roleKeys":["payroll_head"]}]}',
         (SELECT user_id FROM user_roles WHERE role_key='super_admin' AND active_status=1 ORDER BY created_at LIMIT 1)
  UNION ALL SELECT 'Monthly employee master', 'employee-master', 'monthly', NULL, 1, 7,
         '{"to":[{"kind":"role_scope","roleKeys":["hr"],"scope":{"type":"all"}}]}',
         (SELECT user_id FROM user_roles WHERE role_key='super_admin' AND active_status=1 ORDER BY created_at LIMIT 1)
  UNION ALL SELECT 'Weekly birthdays', 'birthday-list', 'weekly', 0, NULL, 7,
         '{"to":[{"kind":"role_scope","roleKeys":["hr"]}]}',
         (SELECT user_id FROM user_roles WHERE role_key='super_admin' AND active_status=1 ORDER BY created_at LIMIT 1)
) AS seed
WHERE seed.o IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM report_subscription rs WHERE rs.subscription_name = seed.n);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT subscription_name, report_code, frequency, is_active, dispatch_mode
--   FROM report_subscription ORDER BY frequency, subscription_name;
--   -- every row MUST read is_active=0, dispatch_mode='shadow'
--
-- The constraint is real, not advisory — this must be rejected:
-- INSERT INTO report_subscription
--   (subscription_name, report_code, frequency, recipient_spec, owner_user_id)
-- VALUES ('bad','document-expiry-tracker','daily','{"to":[]}',UUID());
--   -- expect: CONSTRAINT `chk_rs_report_code` failed
--   -- document-expiry-tracker is in the catalog but has no executor: it would email
--   -- a PENDING_DEDICATED_BUILDER placeholder every day.
--
-- NOTE: the eighth catalogue subscription (undeliverable-recipients) is deliberately not
-- seeded — it needs a new executor first. See NOTIFICATION_CATALOGUE.md section 6.6.
