-- 1048_master_data_missing_columns.sql
--
-- Adds two master-data columns the bulk-upload services have always written but the schema
-- never had. Both INSERTs threw ER_BAD_FIELD_ERROR on every run, so those two importers have
-- never worked.
--
--   branch-master-bulk.service.ts:45  -> branch_master.pincode
--   lob-master-bulk.service.ts:42     -> lob_master.description
--
-- WHY ONLY TWO
-- The column sweep flagged five master-data fields in this family. Three are deliberately
-- NOT added, because adding them would create a second way to express something the schema
-- already models — which is the defect that produced three competing expense designs and two
-- rival LMS mappers elsewhere in this codebase:
--
--   department_master.cost_centre   a cost_centre_master table already exists and other
--                                   tables carry cost_centre_id. A varchar here would be a
--                                   denormalised duplicate of a proper foreign key.
--
--   designation_master.level        the table already has BOTH grade and grade_id. A third
--                                   overlapping notion of seniority is not an improvement.
--
--   process_master.lob_id           business_lob already holds the LOB as text, and
--                                   lob_master exists with real ids. The right change is to
--                                   normalise — add the FK AND backfill it from business_lob
--                                   AND decide which becomes authoritative. That is a data
--                                   migration with a decision attached, not a column.
--
-- Those three need a data-model decision. Their importers stay broken until it is taken,
-- which is the honest state: a column added to silence an error, pointing at a concept that
-- already exists twice, costs more than the error did.
--
-- SAFETY: both columns are NULLable with no default, so every existing row is untouched and
-- nothing needs backfilling. branch_master has 45 rows, lob_master has 5.
--
-- Guarded so re-running is safe; MySQL has no ADD COLUMN before 8.0.

SET NAMES utf8mb4;
SET @db := DATABASE();

-- ---------------------------------------------------------------------------
-- branch_master.pincode
-- The table already carries city, state, address, latitude and longitude. Pincode is the
-- one part of an Indian postal address it was missing.
-- ---------------------------------------------------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='branch_master' AND COLUMN_NAME='pincode') = 0,
  "ALTER TABLE branch_master
     ADD COLUMN pincode VARCHAR(10) NULL COMMENT 'Postal code; completes the address alongside city/state'",
  'SELECT ''branch_master.pincode exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- lob_master.description
-- department_master already has a description column, so this follows the established
-- shape for a master table rather than inventing one.
-- ---------------------------------------------------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lob_master' AND COLUMN_NAME='description') = 0,
  "ALTER TABLE lob_master
     ADD COLUMN description TEXT NULL COMMENT 'Free-text description, matching department_master.description'",
  'SELECT ''lob_master.description exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Both columns present (expect 2):
--   SELECT COUNT(*) FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA=DATABASE()
--      AND ((TABLE_NAME='branch_master' AND COLUMN_NAME='pincode')
--        OR (TABLE_NAME='lob_master'   AND COLUMN_NAME='description'));
--
-- Existing rows untouched (expect 45 and 5, all NULL in the new column):
--   SELECT COUNT(*) total, COUNT(pincode) filled FROM branch_master;
--   SELECT COUNT(*) total, COUNT(description) filled FROM lob_master;
--
-- The importers that were throwing now run — verify by probing their exact INSERT shapes.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- ALTER TABLE branch_master DROP COLUMN pincode;
-- ALTER TABLE lob_master    DROP COLUMN description;
