-- 2109: identity (number + email), profile, ex-employee facts, and requisition attribution for attempts.
-- Side tables only: employees / exit_request are hot tables and are never altered here.
-- All additive and re-runnable.

-- One row per known identity of a lead. mobile10 stays the person key on he_lead; extra numbers and emails
-- land here so a second contact detail can never create a second person. UNIQUE(kind,value) is the dedupe.
CREATE TABLE IF NOT EXISTS he_lead_identity (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  lead_id    CHAR(36)     NOT NULL,
  kind       ENUM('mobile','email') NOT NULL,
  value      VARCHAR(190) NOT NULL,
  is_primary TINYINT(1)   NOT NULL DEFAULT 0,
  source     VARCHAR(30)  NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_he_identity (kind, value),
  KEY idx_he_identity_lead (lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The same email / secondary number turned up on two different people: HR decides, nothing is auto-merged.
CREATE TABLE IF NOT EXISTS he_identity_clash (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  kind       ENUM('mobile','email') NOT NULL,
  value      VARCHAR(190) NOT NULL,
  lead_id_a  CHAR(36)     NOT NULL,
  lead_id_b  CHAR(36)     NOT NULL,
  status     ENUM('open','same_person','different','ignored') NOT NULL DEFAULT 'open',
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by CHAR(36)    NULL,
  resolved_at DATETIME    NULL,
  UNIQUE KEY uq_he_clash (kind, value, lead_id_a, lead_id_b),
  KEY idx_he_clash_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Skills/profile facts used to score fit when data is partial (unknown stays NULL, never guessed).
CREATE TABLE IF NOT EXISTS he_lead_profile (
  lead_id           CHAR(36)     NOT NULL PRIMARY KEY,
  gender            ENUM('male','female','other') NULL,
  languages         JSON         NULL,
  certifications    JSON         NULL,
  typing_wpm        SMALLINT UNSIGNED NULL,
  english_level     ENUM('basic','intermediate','advanced') NULL,
  salary_expectation INT UNSIGNED NULL,
  last_employer     VARCHAR(150) NULL,
  refreshed_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Former employees keyed by number (materialised from employees + exit_request by a set-based refresh).
CREATE TABLE IF NOT EXISTS he_ex_employee (
  mobile10        CHAR(10)     NOT NULL PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL,
  exit_type       VARCHAR(30)  NULL,
  exit_sub_type   VARCHAR(40)  NULL,
  exit_reason     VARCHAR(60)  NULL,
  exit_date       DATE         NULL,
  last_process_id CHAR(36)     NULL,
  last_branch_id  CHAR(36)     NULL,
  would_rejoin    TINYINT(1)   NULL,
  clean_voluntary TINYINT(1)   NOT NULL DEFAULT 0,
  refreshed_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_he_exemp_clean (clean_voluntary, exit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which requisition / drive each attempt was for ("approached how many times, for what").
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_message' AND COLUMN_NAME = 'requisition_id') = 0, 'ALTER TABLE he_message ADD COLUMN requisition_id CHAR(36) NULL, ADD COLUMN drive_id CHAR(36) NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_call' AND COLUMN_NAME = 'requisition_id') = 0, 'ALTER TABLE he_call ADD COLUMN requisition_id CHAR(36) NULL, ADD COLUMN drive_id CHAR(36) NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_message' AND INDEX_NAME = 'idx_he_msg_req') = 0, 'ALTER TABLE he_message ADD INDEX idx_he_msg_req (requisition_id, created_at)', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_call' AND INDEX_NAME = 'idx_he_call_req') = 0, 'ALTER TABLE he_call ADD INDEX idx_he_call_req (requisition_id, created_at)', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
-- Email lookups on the lead and on Meta raw rows (identity table covers the unique check; these serve joins/imports).
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND INDEX_NAME = 'idx_he_lead_email') = 0, 'ALTER TABLE he_lead ADD INDEX idx_he_lead_email (email)', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Attempt view now carries requisition for engine attempts.
CREATE OR REPLACE VIEW he_attempt_v AS
  SELECT a.mobile10 AS mobile10,
         CAST(a.activity_date AS DATETIME)      AS attempted_at,
         'recruiter_call'                       AS channel,
         a.hiring_source COLLATE utf8mb4_unicode_ci AS source,
         a.branch_name COLLATE utf8mb4_unicode_ci AS branch,
         a.process_name COLLATE utf8mb4_unicode_ci AS process,
         a.recruiter_name_snapshot COLLATE utf8mb4_unicode_ci AS actor,
         COALESCE(a.current_status, a.recruiter_remarks) COLLATE utf8mb4_unicode_ci AS outcome,
         a.walkin_flag, a.final_selection_flag, a.joined_flag,
         CAST(NULL AS CHAR(36)) COLLATE utf8mb4_unicode_ci AS requisition_id,
         'ats_recruiter_hiring_activity'        AS source_table,
         a.id COLLATE utf8mb4_unicode_ci        AS source_id
    FROM ats_recruiter_hiring_activity a
   WHERE a.mobile10 IS NOT NULL AND a.mobile10 <> ''
  UNION ALL
  SELECT l.mobile10, COALESCE(c.started_at, c.created_at), 'bot_call', NULL, NULL, NULL, 'voice_bot',
         c.outcome, 0, 0, 0, c.requisition_id, 'he_call', c.id
    FROM he_call c JOIN he_lead l ON l.id = c.lead_id
  UNION ALL
  SELECT m.mobile10, m.created_at, m.channel, NULL, NULL, NULL, 'engine',
         COALESCE(m.intent, m.delivery_status), 0, 0, 0, m.requisition_id, 'he_message', m.id
    FROM he_message m WHERE m.direction = 'out';
