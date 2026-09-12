-- 1764_noc_signatory_not_mandatory.sql
--
-- Accounts and Finance do not have to sign a NOC before the case can be marked complete.
--
-- WHY
--
-- 1696_noc_certificate_exit_clearance.sql seeded all eight signatory stages (Team Leader,
-- Process Manager, HR, Branch Manager, IT, Admin, Accounts, Finance) as equally required, and
-- noc-case.service.ts's recordSignatoryDecision() only ever flips noc_case.status to
-- 'completed' once every single signatory has responded — there was no way to encode "this
-- stage is real and trackable, but the case shouldn't be held open waiting on it". Per the
-- business owner (2026-09-12): Accounts and Finance are not mandatory for a NOC to be
-- considered cleared. They can still sign if they choose to, and Finance's own
-- requires_asset_clearance gate is untouched, but their being pending must not block
-- completion the way Team Leader/Process Manager/HR/Branch Manager/IT/Admin still do.
--
-- WHAT THIS DOES
--
-- Adds is_mandatory to both the template and the per-case table, defaulting every stage to
-- mandatory (1) so nothing else changes silently, then flips it to 0 for accounts and finance
-- specifically. noc_signatory gets the same backfill as noc_signatory.requires_asset_clearance
-- already has (copied from the template at case-open time in openCase()) — new cases inherit it
-- from the template automatically; this migration also backfills every ALREADY-OPEN case's
-- accounts/finance rows so a NOC opened before this ships is not left waiting on two stages
-- that are no longer supposed to block it.
--
-- Purely additive: new column, default preserves today's all-mandatory behaviour for every
-- other stage, and the one application-code read site (recordSignatoryDecision()'s allCleared
-- check) is updated in the same change that ships this column.

ALTER TABLE noc_signatory_template
  ADD COLUMN is_mandatory TINYINT(1) NOT NULL DEFAULT 1
    AFTER requires_asset_clearance;

UPDATE noc_signatory_template
   SET is_mandatory = 0
 WHERE stage_key IN ('accounts', 'finance');

ALTER TABLE noc_signatory
  ADD COLUMN is_mandatory TINYINT(1) NOT NULL DEFAULT 1
    AFTER requires_asset_clearance;

UPDATE noc_signatory
   SET is_mandatory = 0
 WHERE stage_key IN ('accounts', 'finance');
