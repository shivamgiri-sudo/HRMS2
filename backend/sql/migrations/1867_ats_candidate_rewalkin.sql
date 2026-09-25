-- Re-walk-in history: one row each time an already-known candidate (matched by mobile)
-- fills the walk-in registration form again. ats_candidate is updated in place, so without
-- this table the earlier registration date and the fact of a repeat visit are lost.
-- Collation matches ats_candidate (utf8mb4_unicode_ci); idempotent.

CREATE TABLE IF NOT EXISTS ats_candidate_rewalkin (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  candidate_id CHAR(36) NOT NULL,
  walked_in_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  walk_in_date DATE NOT NULL,
  branch VARCHAR(150) NULL,
  process VARCHAR(150) NULL,
  source_channel VARCHAR(100) NULL,
  prior_stage VARCHAR(100) NULL,
  prior_status VARCHAR(100) NULL,
  prior_decision VARCHAR(100) NULL,
  recruiter_assigned_name VARCHAR(150) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_rewalkin_candidate (candidate_id),
  KEY idx_rewalkin_date (walk_in_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
