-- A legacy db_bill GRN must exist ONCE in HRMS. The importer skips a bill it has seen (in code); this makes the
-- database refuse a second copy too, so a re-run, a parallel run or a different script cannot duplicate it.
-- NULL bill_source_id (GRNs raised in HRMS) is unlimited: a UNIQUE key allows many NULLs.
-- Added only when no duplicates exist today; otherwise skipped (the note says so) so a boot is never blocked.
SET @has_idx = (SELECT COUNT(*) FROM information_schema.statistics
                 WHERE table_schema = DATABASE() AND table_name = 'grn_request' AND index_name = 'uq_grn_bill_source');
SET @dups = (SELECT COUNT(*) FROM (SELECT bill_source_id FROM grn_request WHERE bill_source_id IS NOT NULL GROUP BY bill_source_id HAVING COUNT(*) > 1) d);
SET @sql = IF(@has_idx > 0, 'SELECT ''uq_grn_bill_source already present'' AS note',
           IF(@dups > 0, 'SELECT ''uq_grn_bill_source NOT added: duplicate bill_source_id rows exist, clear them first'' AS note',
              'ALTER TABLE grn_request ADD UNIQUE KEY uq_grn_bill_source (bill_source_id)'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1973_grn_bill_source_unique.sql applied' AS migration_status;
-- Rollback: ALTER TABLE grn_request DROP INDEX uq_grn_bill_source;
