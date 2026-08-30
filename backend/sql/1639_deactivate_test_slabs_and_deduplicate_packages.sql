-- 1639: Deactivate test/demo salary slabs and remove duplicate salary packages
-- Safe, additive data-quality migration — no schema changes, no deletes of real data.

-- Step 1: Deactivate the three test/demo slabs (seq_order=999 indicates demo data)
-- These slabs (TD-SLAB-182710, TD-SLAB-113934, TD-SLAB-182842) are visible in
-- production but have seq_order=999 marking them as test entries.
UPDATE salary_slab
   SET active_status = 0
 WHERE slab_code IN ('TD-SLAB-182710', 'TD-SLAB-113934', 'TD-SLAB-182842')
   AND active_status = 1;

-- Step 2: Remove duplicate salary packages — keep the one with the lower id (older),
-- delete the newer duplicate. A duplicate is defined as same band_id + cost_centre_code
-- with identical ctc_monthly values. Only delete rows where no employee currently
-- references the duplicate via salary_structure.
--
-- This CTE identifies the max-id duplicate in each (band_id, cost_centre_code) group
-- where more than one active package exists with the same ctc_monthly.
DELETE sp2
  FROM salary_package sp2
  JOIN (
    SELECT band_id, cost_centre_code, ctc_monthly, MAX(id) AS dup_id
      FROM salary_package
     WHERE active_status = 1
     GROUP BY band_id, cost_centre_code, ctc_monthly
    HAVING COUNT(*) > 1
  ) dups ON dups.band_id = sp2.band_id
         AND dups.cost_centre_code = sp2.cost_centre_code
         AND dups.ctc_monthly = sp2.ctc_monthly
         AND dups.dup_id = sp2.id
 WHERE NOT EXISTS (
   SELECT 1 FROM salary_structure ss WHERE ss.package_id = sp2.id
 );