-- 1697_noc_notification_events.sql
--
-- Registers the six notification events the NOC Certificate (Exit Clearance) workflow emits.
--
-- WHY THIS MIGRATION IS NOT OPTIONAL
--
-- notificationGateway.notify() is fail-closed on an unregistered event: loadEventConfig()
-- returns null and notify() answers { outcome: 'disabled', reason: "event 'x' is not
-- registered" } (notification.gateway.ts:118). No throw, no log at the call site — the send
-- silently does not happen. Without this file every notification in the NOC workflow would
-- be a no-op that looks like success, which is precisely the failure 1620's header documents
-- for the 68 events 1022 seeded switched off.
--
-- SENSITIVITY: 'conf', NOT 'fin'
--
-- These carry clearance status, not money. That matters mechanically, not just semantically:
-- resolveRecipients() throws FIN_HAS_CC for any 'fin' event that addresses an employee in `to`
-- and copies anyone (recipient-resolver.ts:391), and 'fin' forces official_only, which DROPS
-- recipients without a company address. A leaver is exactly the person whose official mailbox
-- is being closed, so 'fin' would silently drop the people these events exist to reach.
-- noc_invite_sent therefore also asks for official_then_personal explicitly — the same
-- reasoning that makes full_final_ready the one documented event allowed to reach a personal
-- address.
--
-- WHY THE SIGNATORY EVENTS CARRY A PLACEHOLDER RECIPIENT SPEC
--
-- Each of the eight signatories is a different role, resolved against the case's own branch.
-- The `role_scope` selector cannot express that: its scope is a STATIC branchIds list in the
-- stored JSON and it never reads context.branchId (recipient-resolver.ts:210-217). Only
-- branch_hr / branch_head / payroll_hr / wfm_* / approver_chain are context-aware.
--
-- Three ways out were available: register eight events (one per role, doubling to sixteen with
-- reminders and giving eight kill switches nobody asked for), add a new context-aware selector
-- kind to the shared resolver (a change that touches every notification in the system), or
-- pass specOverride from the call site. specOverride is chosen: it is a first-class field on
-- NotifyInput, and it overrides ONLY recipient resolution — the kill switch, daily cap,
-- cooldown, dispatch claim, dedupe and audit trail all still apply. The spec stored below is
-- the safe fallback if a caller ever omits the override: branch HR, who can always route it
-- onward, rather than an empty `to` that would throw EMPTY_TO.
--
-- COOLDOWNS
--
-- noc_invite_sent and noc_signatory_pending are set to 0 (checked only when > 0, gateway:137)
-- because both are legitimately re-sent on demand — HR resending an invite, or a tier opening
-- and notifying a signatory who was previously blocked. Their dedupeKey carries the invite id
-- and the signatory row id respectively, so replay protection comes from the claim's unique
-- key rather than from a time window. The reminder event keeps a 24h cooldown so the SLA
-- worker cannot mail the same signatory twice in a day regardless of how often it runs.
--
-- Additive and idempotent: INSERT IGNORE on a unique event_code, then an explicit enable list.
--
-- Depends on: 1022_notification_event_registry.sql, 1696_noc_certificate_exit_clearance.sql

SET NAMES utf8mb4;

INSERT IGNORE INTO notification_event_config
  (event_code, module, display_name, description, sensitivity, is_critical, recipient_spec, cooldown_minutes) VALUES

-- 1. The form link. Goes to the leaver, who may already have lost their official mailbox —
--    hence official_then_personal rather than the default.
('noc_invite_sent', 'exit', 'NOC form invite sent',
 'Exiting employee has been sent the link to complete their NOC clearance form', 'conf', 1,
 '{"to":[{"kind":"employee","emailPolicy":"official_then_personal"}]}', 0),

-- 2. The employee has filled and submitted the form. HR is the `to` because HR owes the next
--    action (Last Working Day); the reporting manager is copied because they are signatory 1's
--    escalation and should know the chain has started.
('noc_employee_submitted', 'exit', 'NOC form submitted by employee',
 'Exiting employee submitted their NOC form; HR must confirm the Last Working Day', 'conf', 1,
 '{"to":[{"kind":"branch_hr"}],"cc":[{"kind":"reporting_manager"}]}', 0),

-- 3. A signatory''s stage has become actionable. Recipients supplied by specOverride at the
--    call site; the spec below is the fallback described in the header.
('noc_signatory_pending', 'exit', 'NOC clearance awaiting your sign-off',
 'A NOC clearance stage has opened and is awaiting this signatory''s decision', 'conf', 1,
 '{"to":[{"kind":"branch_hr"}]}', 0),

-- 4. SLA reminder. Same override mechanism; 24h cooldown so repeated worker runs cannot
--    re-mail the same signatory within a day.
('noc_signatory_reminder', 'exit', 'NOC clearance overdue',
 'A NOC clearance stage has passed its SLA and is still awaiting a decision', 'conf', 0,
 '{"to":[{"kind":"branch_hr"}],"cc":[{"kind":"branch_head"}]}', 1440),

-- 5. Declined. The employee is the `to` because it is their clearance that has stopped, and
--    HR is copied because HR owns manual resolution — the workflow does not continue by itself.
('noc_declined', 'exit', 'NOC clearance declined',
 'A signatory declined the NOC clearance; the case is locked pending HR resolution', 'conf', 1,
 '{"to":[{"kind":"employee","emailPolicy":"official_then_personal"}],"cc":[{"kind":"branch_hr"},{"kind":"reporting_manager"}]}', 0),

-- 6. All eight signatories have responded and the NOC record is complete. This is also the
--    distribution step: HR and MIS hold the record for audit. A named leadership recipient can
--    be added by an operator appending an explicit_email selector to this row's cc — kept out
--    of the migration because hardcoding an individual''s address into schema is how a
--    distribution list survives the person leaving.
('noc_completed', 'exit', 'NOC clearance completed',
 'All NOC signatories have responded; clearance is complete and salary/FNF release is unblocked', 'conf', 1,
 '{"to":[{"kind":"employee","emailPolicy":"official_then_personal"}],"cc":[{"kind":"branch_hr"},{"kind":"branch_head"}]}', 0);

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------
-- template_key is set to a name defined in src/modules/communication/builtin-templates.ts, NOT
-- to a communication_template row. templateService.getTemplateByName() checks the database first
-- and falls back to that built-in map, so the templates ship with the code and cannot be missing
-- in an environment where a data seed did not run. An operator who wants to reword one inserts a
-- communication_template row with the same name, which then takes precedence.
--
-- This matters more than tidiness here: a missing template does not fail, it silently degrades to
-- notification.deliverer.ts's fallbackBody(), which renders `data` as a plain key/value table. For
-- the invite that would turn the "Open my NOC form" button into a bare URL string in a debug-looking
-- table — deliverable, but not something to send a departing employee.
UPDATE notification_event_config SET template_key = 'noc_invite'              WHERE event_code = 'noc_invite_sent'         AND template_key IS NULL;
UPDATE notification_event_config SET template_key = 'noc_employee_submitted'  WHERE event_code = 'noc_employee_submitted'  AND template_key IS NULL;
UPDATE notification_event_config SET template_key = 'noc_signatory_pending'   WHERE event_code = 'noc_signatory_pending'   AND template_key IS NULL;
UPDATE notification_event_config SET template_key = 'noc_signatory_reminder'  WHERE event_code = 'noc_signatory_reminder'  AND template_key IS NULL;
UPDATE notification_event_config SET template_key = 'noc_declined'            WHERE event_code = 'noc_declined'            AND template_key IS NULL;
UPDATE notification_event_config SET template_key = 'noc_completed'           WHERE event_code = 'noc_completed'           AND template_key IS NULL;

-- Arm the backfill floor so a first worker run cannot replay historical exits. Same guard 1028
-- applies, scoped to only the rows this migration inserted rather than the whole exit module.
UPDATE notification_event_config
   SET backfill_floor_at = NOW()
 WHERE event_code IN (
         'noc_invite_sent',
         'noc_employee_submitted',
         'noc_signatory_pending',
         'noc_signatory_reminder',
         'noc_declined',
         'noc_completed'
       )
   AND backfill_floor_at IS NULL;

-- ---------------------------------------------------------------------------
-- Enable, explicitly and by event_code.
-- ---------------------------------------------------------------------------
-- 1022 seeded 68 events with a column list omitting `enabled`/`dispatch_mode`, so all 68 took
-- the table defaults (0 / 'shadow') and the registry described a system that did not send.
-- These six are enabled here because their producers ship in the same change as this migration
-- (noc.notifications.ts) — an event with no producer is unimplemented, not "off pending
-- rollout", and would make the registry claim a live email no code path can emit.
--
-- The WHERE clause matches only rows still at the accidental default, so a row an operator has
-- deliberately switched to dispatch_mode='off' is preserved. Same guard as 1620.
--
-- None of these replays history: five fire on a state change in a request path, and
-- noc_signatory_reminder is driven by the SLA worker, which is bounded by the backfill floor
-- armed above and by its own worker_config kill switch.
UPDATE notification_event_config
   SET enabled = 1, dispatch_mode = 'live'
 WHERE event_code IN (
         'noc_invite_sent',
         'noc_employee_submitted',
         'noc_signatory_pending',
         'noc_signatory_reminder',
         'noc_declined',
         'noc_completed'
       )
   AND enabled = 0
   AND dispatch_mode = 'shadow';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT event_code, sensitivity, enabled, dispatch_mode, cooldown_minutes,
--        backfill_floor_at IS NOT NULL AS floored
--   FROM notification_event_config
--  WHERE event_code LIKE 'noc\_%' ORDER BY event_code;
--   -- expect 6 rows, enabled=1, dispatch_mode='live', floored=1
--
-- No NOC event is 'fin', so none carries the official-email-only drop. See the header for why
-- that is deliberate rather than an oversight.
