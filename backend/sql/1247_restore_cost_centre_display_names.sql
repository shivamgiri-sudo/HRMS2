-- Restore four cost-centre display names that were overwritten with their own codes.
-- Date: 2026-08-19
--
-- WHAT IS WRONG
--   cost_centre_master.cost_centre_name is meant to hold a human label ("F&A", "IT"),
--   distinct from cost_centre_code ("FINANCE/ACCOUNTS", "IT/SYSTEM"). On 2026-08-19 four
--   Head Office cost centres had their name overwritten with their own code, so every screen
--   that renders "code - name" now prints the code twice ("IT/SYSTEM - IT/SYSTEM") and the
--   real label is gone.
--
--   Directly observed within one session: a read of these rows earlier the same day returned
--   BSS-HR / F&A / IT / Management; a later read of the same rows returned the code in the
--   name column, with updated_at stamped 08:25-08:42 that morning -- the same window in which
--   these four were being activated and re-pointed at a branch through the UI.
--
--   db_bill.cost_master.CostCenterName -- the finance system of record -- still holds the
--   original four values, and they match what mas_hrms held before the overwrite. Those are
--   the values restored here.
--
--   CAUSE NOT ESTABLISHED. Every backend writer found (org.service.ts costCentreService.update,
--   finance/cost-centre-management.service.ts, process-pnl/cost-centre-mapping.service.ts)
--   guards the column with COALESCE(?, cost_centre_name) and therefore cannot blank it; every
--   edit form found pre-fills the field from the record's own current name. So the overwrite
--   required a client to actively send name = code, and which client did that is unproven.
--   cost_centre_approval_log exists but holds ZERO rows -- nothing records cost-centre edits --
--   so there is no audit trail to identify the actor or the screen. Until that is closed, this
--   restoration can be undone by the same unidentified path; re-check these four after any
--   further cost-centre editing.
--
-- SCOPE
--   Exactly four rows, matched by code, and only where the name is currently EQUAL to the code
--   (i.e. still clobbered). A row whose name has since been set to anything else is left alone,
--   so this can never overwrite a label Finance enters by hand, and a re-run is a no-op.
--   Only 6 of 439 active cost centres have a real name in db_bill at all; the other 2 already
--   agree with mas_hrms and are not touched. The remaining 433 have a NULL/blank name in
--   db_bill, so name = code is genuinely the only label available for them -- deliberately
--   NOT changed here.
--
-- ROLLBACK
--   UPDATE cost_centre_master SET cost_centre_name = cost_centre_code
--    WHERE cost_centre_code IN ('BSS-OTHERS','FINANCE/ACCOUNTS','IT/SYSTEM','MANAGEMENT-CORPORATE');

UPDATE cost_centre_master SET cost_centre_name = 'BSS-HR',      updated_at = NOW()
 WHERE cost_centre_code = 'BSS-OTHERS'           AND cost_centre_name = cost_centre_code;

UPDATE cost_centre_master SET cost_centre_name = 'F&A',         updated_at = NOW()
 WHERE cost_centre_code = 'FINANCE/ACCOUNTS'     AND cost_centre_name = cost_centre_code;

UPDATE cost_centre_master SET cost_centre_name = 'IT',          updated_at = NOW()
 WHERE cost_centre_code = 'IT/SYSTEM'            AND cost_centre_name = cost_centre_code;

UPDATE cost_centre_master SET cost_centre_name = 'Management',  updated_at = NOW()
 WHERE cost_centre_code = 'MANAGEMENT-CORPORATE' AND cost_centre_name = cost_centre_code;

-- Verification (expects the four names to differ from their codes):
--   SELECT cost_centre_code, cost_centre_name FROM cost_centre_master
--    WHERE cost_centre_code IN ('BSS-OTHERS','FINANCE/ACCOUNTS','IT/SYSTEM','MANAGEMENT-CORPORATE');
