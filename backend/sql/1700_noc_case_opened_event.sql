-- 1699_noc_case_opened_event.sql
--
-- Adds the seventh NOC event, noc_case_opened, to databases where 1697 had ALREADY been applied
-- before that event was written into it.
--
-- WHY THIS IS A SEPARATE FILE RATHER THAN AN EDIT TO 1697
--
-- 1697 is recorded in schema_migrations with success=1 on this estate, so the runner will never
-- execute it again — editing it would fix a fresh install and silently leave every existing
-- database with six of seven events. Verified live 2026-09-09 against mas_hrms: 6 registered,
-- noc_case_opened absent, so notifyCaseOpened() would have answered
-- { outcome: 'disabled', reason: "event 'noc_case_opened' is not registered" } and the initiator
-- escalation would have gone nowhere with no error at the call site.
--
-- 1697 still carries the event too, deliberately. A fresh database gets all seven from it, and this
-- file's INSERT IGNORE is then a no-op. The two paths converge rather than one superseding the other.
--
-- WHAT THIS EVENT IS FOR
--
-- The spec's initiator matrix: when a case is opened, notify the levels ABOVE whoever opened it,
-- never below, so approvals move upward and an exit is not leaked to the leaver's own reports. The
-- recipient list depends on the recorded initiator_role and so is only knowable at the call site;
-- specOverride carries it, which is why the stored spec below is only the branch-HR fallback that
-- keeps resolveRecipients from throwing EMPTY_TO if a caller ever omits the override.
--
-- Data-only and idempotent. No schema, no column, no row deleted.
--
-- Depends on: 1022_notification_event_registry.sql, 1697_noc_notification_events.sql

SET NAMES utf8mb4;

INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, description, sensitivity, is_critical, recipient_spec, cooldown_minutes)
VALUES
  ('noc_case_opened', 'exit', 'NOC clearance started',
   'A NOC exit clearance has been raised; the levels above the initiator are notified', 'conf', 0,
   '{"to":[{"kind":"branch_hr"}]}', 0);

-- template_key points at a name in src/modules/communication/builtin-templates.ts, not a
-- communication_template row — templateService.getTemplateByName falls back to that map, so the
-- template ships with the code and cannot be missing where a data seed did not run.
UPDATE notification_event_config
   SET template_key = 'noc_case_opened'
 WHERE event_code = 'noc_case_opened' AND template_key IS NULL;

-- Arm the floor so the first run cannot replay historical exits.
UPDATE notification_event_config
   SET backfill_floor_at = NOW()
 WHERE event_code = 'noc_case_opened' AND backfill_floor_at IS NULL;

-- Enable, matching only a row still at 1022's accidental enabled=0/dispatch_mode='shadow' default,
-- so an operator who deliberately switched it off keeps that decision. Its producer
-- (notifyCaseOpened in noc.notifications.ts) ships in the same change.
UPDATE notification_event_config
   SET enabled = 1, dispatch_mode = 'live'
 WHERE event_code = 'noc_case_opened'
   AND enabled = 0
   AND dispatch_mode = 'shadow';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT event_code, enabled, dispatch_mode, template_key FROM notification_event_config
--  WHERE event_code LIKE 'noc\_%' ORDER BY event_code;   -- expect 7 rows, all enabled=1/live
