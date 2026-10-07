-- Short, human-readable reference per match for the voice bot (HRMS-001, HRMS-002, ...). One row per match, so a candidate keeps the same reference
-- across sheet downloads and retries, and Superbot's feedback (which only echoes the reference) can be mapped back to the match.
CREATE TABLE IF NOT EXISTS he_call_ref (
  seq        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  match_id   CHAR(36)     NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_he_call_ref_match (match_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
