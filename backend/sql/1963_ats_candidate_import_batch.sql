-- Migration 1963: tag the June 2026 bulk import so reports can say "legacy import" instead of
-- showing 32k candidates as an unspecified source / unassigned recruiter.
--
-- 33,592 ats_candidate rows were created on 2026-06-06 and 2026-06-08 by a bulk load that wrote only
-- name, mobile and a few profile fields: no created_by, sourcing_channel, recruiter or branch. They are
-- 83% of the table, so every source, recruiter and branch chart was dominated by "blank".
--
-- The tag lives in its own table rather than a new ats_candidate column on purpose: ats_candidate has
-- 165 columns and is at InnoDB's row-size limit, so ADD COLUMN fails there with ER_TOO_BIG_ROWSIZE when
-- innodb_strict_mode is on (reproduced on a copy of the production column set). A separate table
-- cannot hit that and leaves ats_candidate untouched.
--
-- Only rows matching ALL of: created in the 6-8 June window, no creator, no source, no recruiter in
-- either recruiter column. Live count for those criteria on 2026-10-03: 32,558. Nothing already stored
-- in ats_candidate is changed. Re-running is a no-op (CREATE IF NOT EXISTS; INSERT IGNORE on the PK).

CREATE TABLE IF NOT EXISTS ats_candidate_import_tag (
  candidate_id CHAR(36)    NOT NULL,
  batch        VARCHAR(64) NOT NULL,
  tagged_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (candidate_id),
  INDEX idx_ats_import_tag_batch (batch)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO ats_candidate_import_tag (candidate_id, batch)
SELECT c.id, 'legacy-2026-06'
  FROM ats_candidate c
 WHERE c.created_at >= '2026-06-06' AND c.created_at < '2026-06-09'
   AND c.created_by IS NULL
   AND (c.sourcing_channel IS NULL OR TRIM(c.sourcing_channel) = '')
   AND (c.recruiter_name IS NULL OR TRIM(c.recruiter_name) = '')
   AND (c.recruiter_assigned_name IS NULL OR TRIM(c.recruiter_assigned_name) = '');
