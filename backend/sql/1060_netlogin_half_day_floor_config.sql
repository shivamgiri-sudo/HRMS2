-- Make the Operations/APR net-login half-day floor configurable.
--
-- WHY
-- ---
-- Two attendance sources are classified against a four-hour half-day floor, and
-- only one of them could be configured:
--
--   biometric presence   classifyCosecMinutes(minutes, halfDayFloor)
--                        floor read from attendance_feature_config
--                        .biometric_half_day_floor_minutes
--
--   dialler net login    classifyOperationsNetLogin(minutes)
--                        floor hardcoded as 240, the setting ignored
--
-- The two agreed only because the constant happened to equal the configured
-- value. Changing biometric_half_day_floor_minutes moved the biometric boundary
-- and silently left net login where it was — the same day could then be a half
-- day or an absence depending only on which source recorded it, with nothing
-- reported.
--
-- WHY A SEPARATE KEY RATHER THAN REUSING THE BIOMETRIC ONE
-- -------------------------------------------------------
-- The existing key is named for biometrics because that is what it governs.
-- Biometric minutes measure presence on site; net-login minutes measure dialler
-- session time. Making one key drive both would assert that those two
-- measurements must always share a threshold — a policy claim that has not been
-- made. Separate keys leave that decision open and visible; setting both to the
-- same number is then a choice rather than an accident of implementation.
--
-- PAYROLL-NEUTRAL ON DEPLOYMENT
-- -----------------------------
-- Seeded with 240, which is what the code has always applied and what
-- biometric_half_day_floor_minutes already holds in production. No day is
-- reclassified by this migration. Existing attendance_daily_record rows are not
-- touched, and no historical reclassification is performed.
--
-- IDEMPOTENT
-- ----------
-- ON DUPLICATE KEY UPDATE refreshes only the description. config_value is never
-- overwritten, so re-running this cannot revert a floor someone has deliberately
-- changed.

INSERT INTO attendance_feature_config (config_key, config_value, description) VALUES
  ('netlogin_half_day_floor_minutes', '240',
   'Minimum net-login minutes for Operations/APR half-day classification (default 240 = 4h). A floor qualifies: exactly this many minutes earns the half day. Separate from biometric_half_day_floor_minutes because the two measure different things.')
ON DUPLICATE KEY UPDATE description = VALUES(description);
