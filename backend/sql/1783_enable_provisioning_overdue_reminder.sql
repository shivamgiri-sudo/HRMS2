-- 1783_enable_provisioning_overdue_reminder.sql
--
-- Owner directive (2026-09-16): every pending/actionable item must generate a reminder if
-- it stays unresolved. `provisioning_overdue` already has a real, tested producer
-- (notifyOverdueProvisioning() in it-provisioning.service.ts, called every hour by
-- it-provisioning.cron.ts) with three deliberate safety guards documented inline: a
-- backfill floor (this row's own backfill_floor_at, so nothing before it is ever visible),
-- a per-request dedupe key (each request notifies at most once, ever), and a per-run cap
-- (max_per_day / the function's own 25-per-call limit) with the remainder logged rather
-- than dropped. Those guards make the exact backlog size irrelevant to safety — only to how
-- many hourly runs it takes to drain — so this migration just flips the switch that was
-- being deliberately withheld pending exactly this kind of owner sign-off.
--
-- Backlog note for the record: 69 open requests were past SLA when the producer was written
-- (2026-08-26 comment in it-provisioning.service.ts); re-measured live on 2026-09-16 it is
-- 422. At the function's 25-per-run cap on an hourly cron, draining the existing backlog
-- takes on the order of 17 hourly runs before every overdue request has been notified once;
-- new breaches after that arrive at whatever rate they actually occur.

UPDATE notification_event_config
   SET enabled = 1,
       dispatch_mode = 'live',
       updated_at = NOW()
 WHERE event_code = 'provisioning_overdue';

-- Verification:
-- SELECT event_code, enabled, dispatch_mode FROM notification_event_config WHERE event_code = 'provisioning_overdue';
--   -- expect enabled=1, dispatch_mode='live'
