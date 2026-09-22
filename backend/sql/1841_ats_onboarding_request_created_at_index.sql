-- 1841_ats_onboarding_request_created_at_index.sql
--
-- Speeds up listOnboardingRequests() (ats.onboarding.service.ts), which backs the
-- live /ats/onboarding-requests page (GET /api/ats/onboarding/requests) and runs:
--   SELECT ... FROM ats_onboarding_request r
--   JOIN ats_candidate c ON ... (5 more LEFT JOINs, 2 correlated per-row subqueries)
--   WHERE (<scope>) ORDER BY r.created_at DESC LIMIT 500
-- Measured live 2026-09-22: 13.5s. ats_onboarding_request had no index at all on
-- created_at (only branch_id and status, migration 054) — so MySQL could not use
-- an index to satisfy "ORDER BY r.created_at DESC LIMIT 500" and instead had to
-- materialize and sort the full joined result before the LIMIT could drop anything,
-- reading the whole history and every joined row on every page load regardless of the
-- cap. Adding the LIMIT alone (same commit) cut this to 8.8s — an improvement, but the
-- join/subquery cost per un-indexed-order-scanned row was still being paid for the
-- entire table. With this index, MySQL can walk r in already-sorted order and join/
-- subquery only the first 500 rows it needs, instead of sorting everything first.
--
-- Idempotent (checks information_schema, whose column values are UPPERCASE on mysql2)
-- and additive: no column, no data and no other index is touched. Standard InnoDB
-- secondary-index add, ONLINE by default on MySQL 8 (ALGORITHM=INPLACE, LOCK=NONE).
--
-- Owner approved 2026-09-22 (same conversation as the LIMIT 500 cap it supports).

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ats_onboarding_request'
    AND INDEX_NAME = 'idx_onb_req_created_at'
);
SET @sql = IF(
  @idx = 0,
  'CREATE INDEX idx_onb_req_created_at ON ats_onboarding_request (created_at)',
  'SELECT ''idx_onb_req_created_at already exists'' AS migration_note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1841_ats_onboarding_request_created_at_index.sql applied' AS migration_status;
