-- Migration 2163: Finance is no longer a NOC clearance stage
--
-- Finance sign-off is not required (owner, 2026-10-13). Accounts keeps the dues check; the
-- company-property check stays with IT / Admin. This switches the template stage off so new cases
-- are opened without it, and removes the still-PENDING Finance row from cases that are open, so the
-- board and every case screen stop showing a stage nobody will sign. A Finance row that was actually
-- acted on, and any row on a completed or cancelled case, is history and is left untouched.
--
-- Idempotent: both statements are no-ops once applied.

UPDATE noc_signatory_template SET active_status = 0 WHERE stage_key = 'finance' AND active_status = 1;

DELETE ns FROM noc_signatory ns
  JOIN noc_case c ON c.id = ns.noc_case_id
 WHERE ns.stage_key = 'finance'
   AND ns.status = 'pending'
   AND ns.acted_by_user_id IS NULL
   AND c.status NOT IN ('completed', 'cancelled');
