-- Migration 1614: Bind 2FA challenges to the exact pre-auth login challenge (SEC-07)
-- Purpose: exchangePreAuthToken previously accepted ANY recently-verified 2FA
-- challenge for a user, not one tied to the specific login attempt being
-- exchanged. This adds the FK-style link so the exchange can require an exact
-- match, closing the concurrent-login / wrong-challenge-reuse gap.
-- Author: Claude Code (Security Audit Remediation, 2026-09-11)

DELIMITER $$

DROP PROCEDURE IF EXISTS _m1614_two_factor_challenge_pre_auth_binding $$
CREATE PROCEDURE _m1614_two_factor_challenge_pre_auth_binding()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'auth_two_factor_challenge'
       AND COLUMN_NAME = 'pre_auth_challenge_id'
  ) THEN
    ALTER TABLE auth_two_factor_challenge
      ADD COLUMN pre_auth_challenge_id CHAR(36) NULL AFTER user_id,
      ADD INDEX idx_2fa_pre_auth_challenge (pre_auth_challenge_id);
  END IF;
END $$

CALL _m1614_two_factor_challenge_pre_auth_binding() $$
DROP PROCEDURE IF EXISTS _m1614_two_factor_challenge_pre_auth_binding $$

DELIMITER ;
