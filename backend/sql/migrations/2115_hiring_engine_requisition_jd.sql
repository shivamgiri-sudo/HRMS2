-- 2115: the JD as the Hiring Engine understands it (uploaded JD document / text, parsed into structured requirements,
-- BMS format), kept beside the requisition so approved requisitions are never edited. Plus free skills text per
-- candidate (portal skills, designation, employer, education) for skill matching. Additive and re-runnable.
CREATE TABLE IF NOT EXISTS he_requisition_jd (
  requisition_id CHAR(36)     NOT NULL PRIMARY KEY,
  source_name    VARCHAR(255) NULL,
  jd_text        MEDIUMTEXT   NOT NULL,
  parsed         JSON         NOT NULL,
  updated_by     CHAR(36)     NULL,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead_profile' AND COLUMN_NAME = 'skills_text') = 0, 'ALTER TABLE he_lead_profile ADD COLUMN skills_text VARCHAR(1000) NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
