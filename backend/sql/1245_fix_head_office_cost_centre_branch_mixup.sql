-- Migration: undo an accidental cost-centre reassignment caused by the "Head Office" branch
--            picker collision, and clear a stale close_date blocking one reactivated cost centre.
-- Date: 2026-08-19
--
-- WHAT IS WRONG
--   branch_master holds two DISTINCT, real, active branches that both display as some case
--   variant of "Head Office" (see sql/1115_reactivate_operational_branches.sql, which explicitly
--   warned "do not merge branches on name"):
--     6a8c14d9-5caf-11f1-adb1-00155d0ab410  branch_code=HQ    "Head Office"  Mumbai
--     fea9fdc3-6583-11f1-adb1-00155d0ab410  branch_code=CORP  "HEAD OFFICE"  Noida (the real
--       corporate/finance branch, verified against db_bill.cost_master)
--
--   The Branch Budget page's branch picker (and the cost-centre admin screen) both list
--   branch_master through org.service.ts listActive(), which dedupes rows sharing the same
--   name (case-insensitively) down to a single survivor. That survivor is not chosen by any
--   business rule -- it is whichever row a case-insensitive ORDER BY branch_name happens to
--   return first, which is Mumbai (HQ).
--
--   On 2026-08-19 an admin tried to activate six cost centres "under Head Office" intending the
--   real Noida/CORP branch (they are all verified active in db_bill.cost_master, branch =
--   "HEAD OFFICE"), but the picker's collision silently resolved to Mumbai/HQ instead, moving
--   live cost centres off the branch that owns them. finance_cost_centre_monthly_driver already
--   held planning rows for five of the six keyed to the correct CORP branch_id from 2026-08-03,
--   which confirms where they actually belong.
--
--   Separately, BSS/BO/CORP/302 carries close_date = 2023-12-30 from when it was genuinely
--   closed. Reactivating a cost centre (org.service.ts setStatus) only ever flipped
--   active_status and never cleared close_date, so branch-budget-allocation.service.ts's
--   listActiveCostCentres (which requires close_date IS NULL OR close_date > CURDATE()) kept
--   excluding it from budget allocation despite it reading "active" everywhere else. The code
--   fix for this going forward is in org.service.ts setStatus(); this migration is the one-off
--   data correction for the row already affected.
--
-- WHAT THIS CHANGES
--   1. Moves exactly the six cost centres back to CORP, guarded on: still sitting on HQ, and
--      cost_centre_code matching the affected set. Idempotent -- a re-run matches nothing once
--      applied.
--   2. Clears close_date on BSS/BO/CORP/302, guarded on it still being active_status = 1 with a
--      close_date in the past (i.e. only touches a cost centre that reads active today but is
--      hidden by a stale historical close date).
--
-- ROLLBACK
--   UPDATE cost_centre_master
--      SET branch_id = '6a8c14d9-5caf-11f1-adb1-00155d0ab410', updated_at = NOW()
--    WHERE cost_centre_code IN ('BSS-OTHERS','FINANCE/ACCOUNTS','IT/SYSTEM',
--                                'MANAGEMENT-CORPORATE','BSS/BO/CORP/318','BSS/BO/CORP/302');
--   UPDATE cost_centre_master
--      SET close_date = '2023-12-30', updated_at = NOW()
--    WHERE cost_centre_code = 'BSS/BO/CORP/302';

UPDATE cost_centre_master
   SET branch_id = 'fea9fdc3-6583-11f1-adb1-00155d0ab410',
       updated_at = NOW()
 WHERE branch_id = '6a8c14d9-5caf-11f1-adb1-00155d0ab410'
   AND cost_centre_code IN (
     'BSS-OTHERS', 'FINANCE/ACCOUNTS', 'IT/SYSTEM',
     'MANAGEMENT-CORPORATE', 'BSS/BO/CORP/318', 'BSS/BO/CORP/302'
   );

UPDATE cost_centre_master
   SET close_date = NULL,
       updated_at = NOW()
 WHERE cost_centre_code = 'BSS/BO/CORP/302'
   AND active_status = 1
   AND close_date IS NOT NULL
   AND close_date < CURDATE();

-- Verification (expects all six rows branch_id = CORP, and BSS/BO/CORP/302 close_date NULL):
--   SELECT cost_centre_code, branch_id, active_status, close_date FROM cost_centre_master
--    WHERE cost_centre_code IN ('BSS-OTHERS','FINANCE/ACCOUNTS','IT/SYSTEM',
--                                'MANAGEMENT-CORPORATE','BSS/BO/CORP/318','BSS/BO/CORP/302');
