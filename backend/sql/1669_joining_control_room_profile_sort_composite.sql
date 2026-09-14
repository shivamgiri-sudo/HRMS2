-- 1669_joining_control_room_profile_sort_composite.sql
--
-- Follow-up to 1668, which added candidate_onboarding_profile(updated_at) and
-- ats_candidate(updated_at) for the Joining Control Room queue's sort arms. 1668 is
-- applied (production, 2026-09-03 17:00:39) and it fixed the ats_candidate arm — EXPLAIN
-- now reports "Backward index scan", rows=50 — but the profile arm still reports
-- type=ALL, rows=32282, "Using temporary; Using filesort" and measures ~14 s.
--
-- The single-column index cannot serve that arm, because of what the arm sorts by:
--
--   ORDER BY p.updated_at DESC, <the candidate id> DESC
--
-- An InnoDB secondary index stores (indexed columns ... , PRIMARY KEY). For
-- ats_candidate that suffix IS the candidate id, so (updated_at) + PK gives exactly
-- (updated_at, id) and the arm's ordering is satisfied outright. For
-- candidate_onboarding_profile the primary key is its own surrogate `id`, NOT
-- candidate_id — so (updated_at) + PK gives (updated_at, profile_id), which cannot
-- answer an ordering whose second key is candidate_id, and MySQL falls back to sorting
-- all 32,282 rows.
--
-- The tie-breaker is not removable: updated_at is second-resolution and these rows arrive
-- by bulk import, so the 50-row cut lands inside tie groups (measured: a group of three
-- sharing one timestamp). Every arm must break ties on the SAME key the outer merge uses,
-- or an arm can truncate a tie group differently from the way the merge would, and drop a
-- row that belongs in the top 50. So the index has to carry candidate_id as its second
-- column instead.
--
-- Verified before writing this: with ORDER BY p.updated_at DESC, p.id DESC (the profile's
-- own pk, which the existing index CAN serve) EXPLAIN reports "Backward index scan",
-- rows=50 — confirming the index itself is sound and the ordering is the only obstacle.
--
-- Purely additive: one idempotent information_schema-guarded ADD INDEX. No ALTER of an
-- existing index, no DROP, no DELETE, no data modified.
--
-- Note: this composite makes 1668's idx_cand_onb_profile_updated_at redundant — a
-- leftmost prefix of it — so that index now costs write time on a 32k-row table while
-- serving nothing the composite does not. Dropping it is a safe follow-up, deliberately
-- NOT done here: this migration stays additive, and an index drop should be its own
-- reviewed change rather than a side effect of a performance fix.
--
-- Locking: ADD INDEX is online/in-place for InnoDB, so reads and writes continue. It still
-- takes a brief exclusive metadata lock at start and finish; check for long transactions
-- first and prefer a quiet window:
--   SELECT * FROM information_schema.INNODB_TRX WHERE trx_started < NOW() - INTERVAL 1 MINUTE;

SET @migration = '1669_joining_control_room_profile_sort_composite.sql';

SET @q = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
     WHERE table_schema = DATABASE()
       AND table_name  = 'candidate_onboarding_profile'
       AND index_name  = 'idx_cand_onb_profile_updated_candidate') = 0,
  'ALTER TABLE candidate_onboarding_profile ADD INDEX idx_cand_onb_profile_updated_candidate (updated_at, candidate_id)',
  'SELECT ''idx_cand_onb_profile_updated_candidate already exists'' AS info'
);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT CONCAT(@migration, ' applied') AS migration_status;
