-- 1124_salary_prep_line_covering_index.sql
--
-- Adds a covering index for the payroll summary's two payroll-line aggregates.
--
-- /api/payroll/summary takes 3.5s warm over the public database link, and profiling the query
-- statement by statement showed where it goes:
--
--   SELECT 1 (pure round trip)          530ms
--   COUNT(*) active employees           475ms
--   SUM(ctc) active employees           311ms
--   SUM(gross_salary) over the join   3,659ms   <- this
--   the whole /summary query          3,653ms
--
-- So the endpoint is not chatty and it is not middleware; one subquery shape is the whole cost,
-- and it appears twice - once for gross_salary and once for net_salary.
--
-- salary_prep_line already indexes employee_id (idx_spl_employee_run, idx_overtime), so the join
-- key is covered and adding another plain index on it would change nothing. What is missing is
-- the two summed columns: the server resolves employee_id through an index and then reads the row
-- to get gross_salary and net_salary, 14,277 times. Carrying both in the index lets it answer
-- from the index alone.
--
-- Additive and reversible: no existing index is dropped, so if this turns out not to help, the
-- fix is DROP INDEX and nothing else has moved. The table is 80,338 rows, so the build is quick
-- and the extra space is small.
--
-- Guarded on INFORMATION_SCHEMA.STATISTICS rather than written ADD INDEX IF NOT EXISTS, which is
-- MariaDB syntax MySQL 8.0.42 rejects with ER_PARSE_ERROR - the mistake that got 1064 dropped and
-- left 1110 unlisted.

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE salary_prep_line ADD INDEX idx_spl_emp_amounts (employee_id, gross_salary, net_salary)',
  'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'salary_prep_line'
    AND INDEX_NAME = 'idx_spl_emp_amounts');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;
