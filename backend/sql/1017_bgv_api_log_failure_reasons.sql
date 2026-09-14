-- 1017_bgv_api_log_failure_reasons.sql
--
-- Make candidate_bgv_api_request_log able to record WHY a provider call failed.
--
-- As built, the table could only ever hold successes: every INSERT sits after
-- the provider call, so a thrown error (403 IP-whitelist, timeout, 5xx, bad
-- credentials) skipped the write entirely. response_status_code was also
-- hardcoded to 200 at every call site, and success_flag was set from the
-- business outcome (status === 'verified'), which conflates "the API failed"
-- with "the API worked and the name did not match".
--
-- Additive and idempotent.

DROP PROCEDURE IF EXISTS _1017_add_col;
DROP PROCEDURE IF EXISTS _1017_add_idx;
DELIMITER //
CREATE PROCEDURE _1017_add_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl VARCHAR(255))
BEGIN
  IF (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col) = 0 THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', ddl);
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
CREATE PROCEDURE _1017_add_idx(IN tbl VARCHAR(64), IN idx VARCHAR(64), IN cols VARCHAR(255))
BEGIN
  IF (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx) = 0 THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD INDEX `', idx, '` (', cols, ')');
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- Why it failed, in operator-readable terms.
CALL _1017_add_col('candidate_bgv_api_request_log', 'error_code',    'VARCHAR(80) NULL');
CALL _1017_add_col('candidate_bgv_api_request_log', 'error_message', 'TEXT NULL');

-- Separates transport success from business result:
--   success        -> provider answered and the check passed
--   mismatch       -> provider answered, data did not match
--   manual_review  -> provider answered, needs a human
--   provider_error -> provider returned an error (4xx/5xx, AUTH_023, ...)
--   network_error  -> never reached the provider (DNS/timeout/refused)
--   config_error   -> credentials or provider not configured
CALL _1017_add_col('candidate_bgv_api_request_log', 'outcome',
  "VARCHAR(30) NOT NULL DEFAULT 'success'");

-- Which candidate-facing action triggered it, and who.
CALL _1017_add_col('candidate_bgv_api_request_log', 'actor_type',  'VARCHAR(20) NULL');
CALL _1017_add_col('candidate_bgv_api_request_log', 'actor_id',    'CHAR(36) NULL');
CALL _1017_add_col('candidate_bgv_api_request_log', 'attempt_no',  'INT NOT NULL DEFAULT 1');

CALL _1017_add_idx('candidate_bgv_api_request_log', 'idx_bgv_log_created',  'created_at');
CALL _1017_add_idx('candidate_bgv_api_request_log', 'idx_bgv_log_outcome',  'outcome, created_at');
CALL _1017_add_idx('candidate_bgv_api_request_log', 'idx_bgv_log_endpoint', 'endpoint_key, created_at');

-- Existing rows predate the outcome column. They were only ever written on a
-- completed provider call, so classify by the old success_flag rather than
-- leaving them all as 'success'.
UPDATE candidate_bgv_api_request_log
   SET outcome = IF(success_flag = 1, 'success', 'mismatch')
 WHERE outcome = 'success' AND success_flag = 0;

DROP PROCEDURE IF EXISTS _1017_add_col;
DROP PROCEDURE IF EXISTS _1017_add_idx;
