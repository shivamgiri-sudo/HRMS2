USE mas_hrms;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'department_master'
      AND column_name = 'description') = 0,
  'ALTER TABLE department_master ADD COLUMN description TEXT NULL AFTER dept_head_employee_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

DROP TEMPORARY TABLE IF EXISTS tmp_leave_type_duplicate;
CREATE TEMPORARY TABLE tmp_leave_type_duplicate (
  duplicate_id CHAR(36) NOT NULL PRIMARY KEY,
  canonical_id CHAR(36) NOT NULL
);

INSERT INTO tmp_leave_type_duplicate (duplicate_id, canonical_id)
SELECT lt.id,
       (
         SELECT lt2.id
           FROM leave_type_master lt2
           LEFT JOIN leave_request lr2 ON lr2.leave_type_id = lt2.id
          WHERE lt2.active_status = 1
            AND LOWER(TRIM(lt2.leave_name)) = LOWER(TRIM(lt.leave_name))
          GROUP BY lt2.id, lt2.created_at
          ORDER BY COUNT(lr2.id) DESC, lt2.created_at ASC, lt2.id ASC
          LIMIT 1
       )
  FROM leave_type_master lt
 WHERE lt.active_status = 1
   AND (
     SELECT COUNT(*)
       FROM leave_type_master ltx
      WHERE ltx.active_status = 1
        AND LOWER(TRIM(ltx.leave_name)) = LOWER(TRIM(lt.leave_name))
   ) > 1;

DELETE FROM tmp_leave_type_duplicate WHERE duplicate_id = canonical_id;

UPDATE leave_request lr
JOIN tmp_leave_type_duplicate d ON d.duplicate_id = lr.leave_type_id
SET lr.leave_type_id = d.canonical_id;

UPDATE leave_balance_ledger lbl
JOIN tmp_leave_type_duplicate d ON d.duplicate_id = lbl.leave_type_id
LEFT JOIN leave_balance_ledger canonical
  ON canonical.employee_id = lbl.employee_id
 AND canonical.leave_type_id = d.canonical_id
 AND canonical.balance_year = lbl.balance_year
SET canonical.allocated_days = COALESCE(canonical.allocated_days, 0) + COALESCE(lbl.allocated_days, 0),
    canonical.used_days = COALESCE(canonical.used_days, 0) + COALESCE(lbl.used_days, 0),
    canonical.adjusted_days = COALESCE(canonical.adjusted_days, 0) + COALESCE(lbl.adjusted_days, 0)
WHERE canonical.id IS NOT NULL;

DELETE lbl
  FROM leave_balance_ledger lbl
  JOIN tmp_leave_type_duplicate d ON d.duplicate_id = lbl.leave_type_id
  JOIN leave_balance_ledger canonical
    ON canonical.employee_id = lbl.employee_id
   AND canonical.leave_type_id = d.canonical_id
   AND canonical.balance_year = lbl.balance_year;

UPDATE leave_balance_ledger lbl
JOIN tmp_leave_type_duplicate d ON d.duplicate_id = lbl.leave_type_id
SET lbl.leave_type_id = d.canonical_id;

UPDATE leave_type_master lt
JOIN tmp_leave_type_duplicate d ON d.duplicate_id = lt.id
SET lt.active_status = 0;

DROP TEMPORARY TABLE tmp_leave_type_duplicate;
