-- Migration 1238: add 'skipped' to dispatch_log.status, and event_code to the SMS INSERT.
--
-- Part of the SMS-dispatch DLT fix (2026-08-18). dispatch.service.ts's _deliver() was sending
-- every SMS with a human-readable subject line where SmartPing (the live SMS provider) requires
-- a numeric TRAI DLT template id — every SMS through the generic notification pipeline has
-- failed since the guard added on 2026-08-09 (and silently before that). Of the 46 notification
-- catalogue events, only ~4 have a confidently-mapped registered DLT template today; the rest
-- have none. Rather than attempt-and-fail for all 46 (indistinguishable from a genuine delivery
-- failure), the fixed code now SKIPS SMS outright for any event with no mapped template, and
-- distinguishing "chose not to attempt" from "attempted and failed" needs its own status.
--
-- Widening an ENUM is additive/backward-compatible: every existing value is preserved in the
-- same order, only 'skipped' is appended. No existing row's status changes. information_schema
-- guard not needed for MODIFY COLUMN (unlike ADD COLUMN/ADD INDEX elsewhere in this manifest) —
-- MODIFY COLUMN is naturally idempotent, re-running it against an already-widened enum is a
-- no-op.

ALTER TABLE dispatch_log
  MODIFY COLUMN status ENUM('queued','sent','delivered','opened','clicked','bounced','failed','skipped')
  NOT NULL DEFAULT 'queued';
