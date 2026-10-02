-- Migration 2000: index employees.candidate_id.
--
-- Recruiter and ATS code asks "has this candidate become an employee?" with a correlated
-- EXISTS / NOT EXISTS on employees.candidate_id. With no index each probe scanned all ~59k
-- wide employee rows: the Recruiter dashboard's offers query took ~21s for 90 days of offers
-- and the BGV-pending count scaled the same way. The dashboard query is now set-based, but the
-- other callers (and any future one) still pay for the missing index.
--
-- Additive and idempotent. Index-only, so a lock timeout defers to the next boot.

SET @s = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX idx_emp_candidate_id ON employees (candidate_id)', 'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'employees' AND index_name = 'idx_emp_candidate_id');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
