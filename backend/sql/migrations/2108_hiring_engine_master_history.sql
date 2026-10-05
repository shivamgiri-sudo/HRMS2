-- 2108: recruitment MASTER over data HRMS already holds. Nothing is copied.
--  * ats_recruiter_hiring_activity (recruiter call attempts, the Raw_Combined_Data equivalent) gets an indexed,
--    virtual, last-10-digit mobile so joins to he_lead / ats_candidate are index lookups, not RIGHT()/REPLACE scans.
--  * he_lead gets small rollup columns (history + effort tier) refreshed by set-based UPDATE, never row-by-row.
--  * he_attempt_v is a VIEW that unions every connect attempt (recruiter calls, bot calls, outbound messages).
-- Additive and re-runnable; every statement is guarded on INFORMATION_SCHEMA.

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'ats_recruiter_hiring_activity' AND COLUMN_NAME = 'mobile10') = 0,
  'ALTER TABLE ats_recruiter_hiring_activity ADD COLUMN mobile10 CHAR(10) GENERATED ALWAYS AS (RIGHT(REGEXP_REPLACE(mobile, ''[^0-9]'', ''''), 10)) VIRTUAL, ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'ats_recruiter_hiring_activity' AND INDEX_NAME = 'idx_arha_mobile10_date') = 0,
  'ALTER TABLE ats_recruiter_hiring_activity ADD INDEX idx_arha_mobile10_date (mobile10, activity_date), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- he_lead rollup columns (one guarded ALTER per column so a half-applied run can resume)
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'attempt_count') = 0, 'ALTER TABLE he_lead ADD COLUMN attempt_count INT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'first_attempt_date') = 0, 'ALTER TABLE he_lead ADD COLUMN first_attempt_date DATE NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'last_attempt_date') = 0, 'ALTER TABLE he_lead ADD COLUMN last_attempt_date DATE NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'walkin_count') = 0, 'ALTER TABLE he_lead ADD COLUMN walkin_count SMALLINT UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'last_walkin_date') = 0, 'ALTER TABLE he_lead ADD COLUMN last_walkin_date DATE NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'last_outcome') = 0, 'ALTER TABLE he_lead ADD COLUMN last_outcome VARCHAR(40) NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'final_status') = 0, 'ALTER TABLE he_lead ADD COLUMN final_status ENUM(''none'',''rejected'',''selected'',''joined'') NOT NULL DEFAULT ''none''', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'conversion_type') = 0, 'ALTER TABLE he_lead ADD COLUMN conversion_type VARCHAR(40) NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'is_employee') = 0, 'ALTER TABLE he_lead ADD COLUMN is_employee TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'effort_tier') = 0, 'ALTER TABLE he_lead ADD COLUMN effort_tier ENUM(''skip'',''low'',''standard'',''high'') NOT NULL DEFAULT ''standard''', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'effort_reason') = 0, 'ALTER TABLE he_lead ADD COLUMN effort_reason VARCHAR(60) NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND COLUMN_NAME = 'history_refreshed_at') = 0, 'ALTER TABLE he_lead ADD COLUMN history_refreshed_at DATETIME NULL', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND INDEX_NAME = 'idx_he_lead_effort') = 0, 'ALTER TABLE he_lead ADD INDEX idx_he_lead_effort (effort_tier, status, last_attempt_date)', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND INDEX_NAME = 'idx_he_lead_walkin') = 0, 'ALTER TABLE he_lead ADD INDEX idx_he_lead_walkin (last_walkin_date)', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead' AND INDEX_NAME = 'idx_he_lead_source') = 0, 'ALTER TABLE he_lead ADD INDEX idx_he_lead_source (primary_source, created_at)', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Ledger queries by type/time (reporting, "what happened today") and per-call lookups by outcome
SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'he_lead_event' AND INDEX_NAME = 'idx_he_event_type_time') = 0, 'ALTER TABLE he_lead_event ADD INDEX idx_he_event_type_time (event_type, created_at)', 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- One read model for "every connect attempt, any channel". A view: zero duplicated rows, always current.
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
         'ats_recruiter_hiring_activity'        AS source_table,
         a.id COLLATE utf8mb4_unicode_ci        AS source_id
    FROM ats_recruiter_hiring_activity a
   WHERE a.mobile10 IS NOT NULL AND a.mobile10 <> ''
  UNION ALL
  SELECT l.mobile10, COALESCE(c.started_at, c.created_at), 'bot_call', NULL, NULL, NULL, 'voice_bot',
         c.outcome, 0, 0, 0, 'he_call', c.id
    FROM he_call c JOIN he_lead l ON l.id = c.lead_id
  UNION ALL
  SELECT m.mobile10, m.created_at, m.channel, NULL, NULL, NULL, 'engine',
         COALESCE(m.intent, m.delivery_status), 0, 0, 0, 'he_message', m.id
    FROM he_message m WHERE m.direction = 'out';
