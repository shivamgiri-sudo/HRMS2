-- Migration 448: Add indexes for Joining Control Room search and queue performance
--
-- The JCR queue search runs:
--   AND (c.full_name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ? OR c.candidate_code LIKE ?)
-- across all four UNION arms. full_name and email had no indexes at all, forcing a full
-- table scan on every keystroke. mobile has a B-tree index (idx_ats_mobile) but a leading-
-- wildcard LIKE '%x%' can never use it. A FULLTEXT index lets MySQL's full-text engine
-- resolve name/email searches without scanning all 35k rows.
--
-- idx_jcr_cand_fullname: regular B-tree index for prefix matches (full_name LIKE 'xxx%')
--   and for covering the ORDER BY / GROUP BY on full_name in reporting queries.
-- idx_jcr_cand_email:    regular B-tree index for email uniqueness checks and prefix matches.
-- idx_jcr_cand_ft:       FULLTEXT index over full_name + email — enables MATCH...AGAINST
--   for sub-millisecond text search when the code is updated to use it.
--
-- These are additive. No existing rows or constraints are changed.

ALTER TABLE ats_candidate
  ADD INDEX idx_jcr_cand_fullname (full_name(100)),
  ADD INDEX idx_jcr_cand_email    (email(100));

-- FULLTEXT index for future MATCH...AGAINST based search (faster than LIKE '%x%')
ALTER TABLE ats_candidate
  ADD FULLTEXT INDEX idx_jcr_cand_ft (full_name, email);
