-- 1082: repair the APR eligibility rule for Operations Executives.
--
-- WHAT IS WRONG
-- The business rule is: Operations department + Executive designation -> payroll
-- attendance built from APR (dialler net login); every other department and designation
-- -> built from biometric. attendance-engine.service.ts implements that in
-- isOperationsExecutiveByRegex(), but isAprEligible() only consults the regex when
-- apr_eligibility_config has NO active rows. One active row disables it for everyone.
--
-- On 2026-07-11 15:56:49 a single row, 'apr-elig-ops-exec', was auto-seeded from that
-- regex — and it pinned the wrong ids:
--
--   designation_id 7914e082-... = 'EXECUTIVE - MIS'   (not 'EXECUTIVE')
--   department_id  775359c8-... = 'Operations'        (a duplicate of 'OPERATIONS')
--
-- The 828 active Operations Executives hold designation 'EXECUTIVE' (797),
-- 'EXECUTIVE - VOICE' (18), 'EXECUTIVE - FIELD' (7) and 'EXECUTIVE - BACKEND' (6),
-- all under department 7782964a-... 'OPERATIONS'. The seeded row therefore matches
-- 0 of 828, and since 2026-07-11 every Operations Executive has been built from
-- biometric instead of APR.
--
-- ORDERING — READ BEFORE RUNNING
-- Do NOT apply this until the matching attendance-engine change is deployed. That change
-- makes an APR employee with no APR row for the day fall back to their biometric minutes.
-- Without it, this migration routes all 828 to APR while the dialler feed covers only
-- ~216 agent codes company-wide, and the ~582 with no APR row become absent with
-- lwp 1.00 — a full day's pay deducted each.
--
-- Rows are matched by isAprEligible() as:
--   (designation_id = ? OR designation_id IS NULL)
--   AND (department_id = ? OR department_id IS NULL)
--   AND (process_id   = ? OR process_id   IS NULL)
-- so one row per real designation id, scoped to the real department id.

START TRANSACTION;

-- Retire the mis-seeded rule rather than deleting it, so the 2026-07-11 seed stays
-- auditable next to the correction.
UPDATE apr_eligibility_config
   SET active_status = 0,
       notes = CONCAT(COALESCE(notes, ''),
                      ' | DEACTIVATED by 1082: pinned designation EXECUTIVE - MIS and the',
                      ' duplicate department row Operations; matched 0 of 828 Operations',
                      ' Executives, silently moving all of them off APR since 2026-07-11.'),
       updated_at = NOW()
 WHERE id = 'apr-elig-ops-exec';

-- Seed one rule per designation that the regex ^executive( *- *.+)?$ actually matches,
-- scoped to the department those employees really belong to. Resolved by name rather
-- than by hardcoded uuid so this stays correct if ids differ between environments.
INSERT INTO apr_eligibility_config
  (id, rule_name, designation_id, department_id, process_id, active_status, notes, created_by, created_at, updated_at)
SELECT
  CONCAT('apr-elig-ops-', LOWER(REPLACE(REPLACE(dm.designation_name, ' ', '-'), '--', '-'))),
  CONCAT('Operations ', dm.designation_name, ' APR Rule'),
  dm.id,
  dp.id,
  NULL,
  1,
  'Seeded by 1082 to restore the Operations/Executive APR rule broken by apr-elig-ops-exec.',
  'system',
  NOW(),
  NOW()
FROM designation_master dm
JOIN department_master dp
  ON LOWER(TRIM(dp.dept_name)) IN ('operations', 'operation')
WHERE LOWER(TRIM(dm.designation_name)) REGEXP '^executive( *- *.+)?$'
  -- only departments that actually have such employees, so the duplicate
  -- 'Operations' row does not get a second, dead set of rules
  AND EXISTS (
    SELECT 1 FROM employees e
     WHERE e.designation_id = dm.id
       AND e.department_id  = dp.id
       AND e.active_status  = 1
  )
ON DUPLICATE KEY UPDATE
  active_status = 1,
  updated_at    = NOW();

COMMIT;

-- Verification — expect matched_by_config to equal total_ops_executive (828 at time of writing).
-- SELECT COUNT(*) total_ops_executive,
--        SUM(EXISTS (SELECT 1 FROM apr_eligibility_config c
--                     WHERE c.active_status = 1
--                       AND (c.designation_id = e.designation_id OR c.designation_id IS NULL)
--                       AND (c.department_id  = e.department_id  OR c.department_id  IS NULL)
--                       AND (c.process_id     = e.process_id     OR c.process_id     IS NULL))) matched_by_config
--   FROM employees e
--   JOIN designation_master dm ON dm.id = e.designation_id
--   JOIN department_master  dp ON dp.id = e.department_id
--  WHERE e.active_status = 1 AND LOWER(e.employment_status) = 'active'
--    AND LOWER(TRIM(dp.dept_name)) IN ('operations','operation')
--    AND LOWER(TRIM(dm.designation_name)) REGEXP '^executive( *- *.+)?$';
