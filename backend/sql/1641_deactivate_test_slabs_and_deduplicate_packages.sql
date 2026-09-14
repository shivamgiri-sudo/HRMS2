-- 1639: Deactivate test/demo salary slabs and remove duplicate salary packages
-- Safe, additive data-quality migration — no schema changes, no deletes of real data.

-- Step 1: Deactivate the three test/demo slabs (seq_order=999 indicates demo data)
-- These slabs (TD-SLAB-182710, TD-SLAB-113934, TD-SLAB-182842) are visible in
-- production but have seq_order=999 marking them as test entries.
UPDATE salary_slab_master
   SET active_status = 0
 WHERE slab_code IN ('TD-SLAB-182710', 'TD-SLAB-113934', 'TD-SLAB-182842')
   AND active_status = 1;

-- Step 2: Deactivate duplicate salary packages — keep the canonical (lowest created_at)
-- entry active, mark the newer duplicate inactive. A duplicate is defined as same
-- branch_name + band_code + cost_centre_code + package_amount combination where more
-- than one active row exists. No deletes — inactive rows remain visible for audit.
UPDATE salary_package_master sp2
  JOIN (
    SELECT branch_name, band_code, cost_centre_code, package_amount,
           MIN(created_at) AS canonical_created_at
      FROM salary_package_master
     WHERE active_status = 1
     GROUP BY branch_name, band_code, cost_centre_code, package_amount
    HAVING COUNT(*) > 1
  ) dups ON dups.branch_name = sp2.branch_name
         AND dups.band_code = sp2.band_code
         AND dups.cost_centre_code = sp2.cost_centre_code
         AND dups.package_amount = sp2.package_amount
         AND sp2.created_at > dups.canonical_created_at
   SET sp2.active_status = 0
 WHERE sp2.active_status = 1;