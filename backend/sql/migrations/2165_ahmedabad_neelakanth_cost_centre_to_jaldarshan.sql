-- 2165_ahmedabad_neelakanth_cost_centre_to_jaldarshan.sql
--
-- Owner ruling 2026-10-13: Ahmedabad Neelakanth rent (and everything on its cost centre) falls under AHMEDABAD-JALDARSHAN.
-- Cost centre BSS/BO/Ahmedabad-Neelakanth/681 was mastered under the (inactive) branch AHMEDABAD-NEELAKANTH, so Jaldarshan's P&L
-- missed about Rs 5 lakh a month of rent and property tax (Apr-Jun 2026) and the Branch Review listed Neelakanth as a branch of its own.
-- Read-only prod dry-run 2026-10-13: the cost centre is inactive, has no staff, and is the only cost centre of that branch.
--
-- Only cost_centre_master.branch_id changes (the P&L reads the branch from the cost centre first). Idempotent: it matches only while the
-- cost centre is still on the Neelakanth branch. REVERT:
--   UPDATE cost_centre_master SET branch_id = (SELECT id FROM branch_master WHERE branch_name = 'AHMEDABAD-NEELAKANTH')
--    WHERE cost_centre_code = 'BSS/BO/Ahmedabad-Neelakanth/681';

UPDATE cost_centre_master ccm
  JOIN branch_master nk ON nk.branch_name = 'AHMEDABAD-NEELAKANTH'
  JOIN branch_master jd ON jd.branch_name = 'AHMEDABAD-JALDARSHAN'
   SET ccm.branch_id = jd.id
 WHERE ccm.cost_centre_code = 'BSS/BO/Ahmedabad-Neelakanth/681'
   AND ccm.branch_id = nk.id;
