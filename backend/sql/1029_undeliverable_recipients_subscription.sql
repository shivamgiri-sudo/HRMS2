-- 1029_undeliverable_recipients_subscription.sql
--
-- Makes `notification-undeliverable-recipients` subscribable, and seeds the weekly
-- delivery to HR that NOTIFICATION_CATALOGUE.md section 6.6 specified.
--
-- WHY THIS REPORT EXISTS, AND WHAT IT ALREADY FOUND
-- Building it immediately corrected a figure this project had been repeating. The
-- catalogue said 156 active employees could not receive a payslip, counting only those
-- whose official_email was EMPTY. That is not the rule shared/recipient-resolver.ts
-- applies — it also requires a company domain. The real number is 725 of 1,152 (62.9%),
-- because 519 employees have a gmail.com address sitting in the official_email column,
-- plus 31 example.com test rows and a handful of hand-typed typos (gamil.com, gmaik.com).
--
-- So this is not a nice-to-have: no `fin` event can sensibly go live until it has been
-- worked through, and this report is the worklist.
--
-- Additive and idempotent. NOT EXECUTED against production (CLAUDE.md rule 4).
--
-- Depends on: 1025_report_subscription.sql

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- 1. Widen the report-code allowlist by exactly one code.
--
-- chk_rs_report_code exists to stop a subscription being created for any of the ~83
-- catalogued reports that have no builder in report-worker-executor.ts — those return a
-- PENDING_DEDICATED_BUILDER placeholder that the mailer would deliver on a schedule
-- forever. This code now HAS a builder, so it is added deliberately, one at a time.
-- Do not widen this constraint without a matching executor case.
-- ---------------------------------------------------------------------------
SET @db := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=@db AND TABLE_NAME='report_subscription'
      AND CONSTRAINT_NAME='chk_rs_report_code') > 0,
  'ALTER TABLE report_subscription DROP CHECK chk_rs_report_code',
  'SELECT "chk_rs_report_code absent"'));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE report_subscription
  ADD CONSTRAINT chk_rs_report_code CHECK (report_code IN (
    'employee-master','headcount','attendance-daily',
    'leave-balance','payroll-register','birthday-list',
    'notification-undeliverable-recipients'
  ));

-- ---------------------------------------------------------------------------
-- 2. The weekly delivery to HR.
--
-- Friday afternoon deliberately: it lands while there is still a working day to act on it,
-- and before the Monday payroll and roster cycles that depend on the data being right.
-- Ships is_active=0 / shadow like every other subscription.
-- ---------------------------------------------------------------------------
INSERT INTO report_subscription
  (subscription_name, report_code, frequency, day_of_week, hour_of_day, recipient_spec, owner_user_id)
SELECT * FROM (
  SELECT 'Weekly undeliverable recipients' AS n,
         'notification-undeliverable-recipients' AS c,
         'weekly' AS f,
         4 AS dw,          -- 0=Monday .. 4=Friday
         16 AS h,
         '{"to":[{"kind":"role_scope","roleKeys":["hr"],"scope":{"type":"all"}}]}' AS r,
         (SELECT user_id FROM user_roles
           WHERE role_key='super_admin' AND active_status=1
           ORDER BY created_at LIMIT 1) AS o
) AS seed
WHERE seed.o IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM report_subscription rs WHERE rs.subscription_name = seed.n);

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT subscription_name, report_code, frequency, day_of_week, hour_of_day,
--        is_active, dispatch_mode
--   FROM report_subscription WHERE report_code='notification-undeliverable-recipients';
--   -- expect 1 row, is_active=0, dispatch_mode='shadow'
--
-- The constraint must still reject a code with no builder:
-- INSERT INTO report_subscription
--   (subscription_name, report_code, frequency, recipient_spec, owner_user_id)
-- VALUES ('__probe__','document-expiry-tracker','daily','{"to":[]}',UUID());
--   -- expect ER_CHECK_CONSTRAINT_VIOLATED
--
-- Current scale of the problem the report surfaces:
-- SELECT COUNT(*) active,
--        SUM(CASE WHEN NULLIF(TRIM(COALESCE(official_email,office_email)),'') IS NOT NULL
--             AND (SUBSTRING_INDEX(LOWER(COALESCE(official_email,office_email)),'@',-1)
--                    IN ('teammas.in','teammas.co.in','mascallnet.com')
--               OR SUBSTRING_INDEX(LOWER(COALESCE(official_email,office_email)),'@',-1)
--                    LIKE '%.teammas.in')
--            THEN 0 ELSE 1 END) blocked_for_financial_mail
--   FROM employees WHERE active_status = 1;
--   -- 2026-07-31: 1152 active, 725 blocked
