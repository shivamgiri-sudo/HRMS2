-- Dedup script — must be run before migration 1126
-- Removes duplicate salary_prep_line_component rows, keeping the latest id
-- per (run_id, line_id, component_code, component_type) group.
--
-- Run EXPLAIN on the DELETE first to confirm index usage.
-- This script is idempotent: safe to re-run.

DELETE splc
  FROM salary_prep_line_component splc
  JOIN (
    SELECT MIN(id) AS keep_id,
           run_id, line_id, component_code, component_type
      FROM salary_prep_line_component
     GROUP BY run_id, line_id, component_code, component_type
    HAVING COUNT(*) > 1
  ) dups
    ON dups.run_id         = splc.run_id
   AND dups.line_id        = splc.line_id
   AND dups.component_code = splc.component_code
   AND dups.component_type = splc.component_type
   AND splc.id            <> dups.keep_id;
