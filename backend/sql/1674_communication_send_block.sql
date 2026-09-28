-- 1674_communication_send_block.sql
--
-- WHY
-- ---
-- Owner asked (2026-09-06) for a real "Pause SMS" switch. One already exists in the UI
-- (Settings > Communication Config, the channel's Enabled/Disabled Switch, backed by
-- communication_provider_config.is_enabled) -- but it does not do what it looks like it does.
--
-- is_enabled only chooses WHICH CREDENTIALS to use, not whether the channel sends at all:
-- provider.factory.ts's getProviderAsync() falls back to buildFromEnv() whenever
-- loadActiveConfig() returns null (which is exactly what happens when is_enabled = 0). All
-- three channels are is_enabled = 0 in production today, and mail/SMS/WhatsApp all still send
-- because SMS_PROVIDER / SMARTPING_* etc. env vars are populated (verified live 2026-09-05) --
-- provider.interface.ts's own isConfigured() doc comment and
-- unconfigured-channel-skip.contract.test.ts both already document this as deliberate: treating
-- is_enabled as an on/off switch would silence email, the one channel that has ever delivered
-- anything (907 sent / 4 failed all-time, versus 0/901 for SMS and 0/903 for WhatsApp, measured
-- 2026-08-08). This migration must not touch that -- it is protected by that contract test for a
-- reason a mistaken "fix" here has already been described almost causing.
--
-- So a real kill switch needs a genuinely separate flag, checked at a genuinely separate place:
-- providerFactory itself (both getProviderAsync and the synchronous getProvider), which every
-- caller across dispatch.service.ts, ats.otp.service.ts and ats.onboarding.service.ts already
-- goes through to obtain a provider -- verified live 2026-09-06. Guarding there covers all of
-- them at once, never folded into is_enabled's existing (working, tested) meaning.
--
-- WHAT THIS ADDS
-- --------------
-- Four nullable/defaulted columns on communication_provider_config, one row already existing per
-- channel (071 seeds email/sms/whatsapp, all three always present):
--   send_blocked  TINYINT(1) NOT NULL DEFAULT 0  -- the actual kill switch
--   block_reason  VARCHAR(255) NULL              -- shown in the UI and in the skipped-send log line
--   blocked_by    CHAR(36) NULL                  -- who paused it
--   blocked_at    DATETIME NULL                  -- when
--
-- Modelled on notification_dispatch_block (1112)'s reason/blocked_by/updated_at shape for
-- consistency with the one other kill-switch already in this codebase, but deliberately a
-- separate mechanism: 1112 blocks by EVENT CODE on one specific path
-- (notificationEventService.dispatch() -> dispatchService.send()) and is silent about the two
-- other SMS call sites (ats.otp.service.ts, ats.onboarding.service.ts) that never go through it.
-- This one guards the provider itself, so every caller of providerFactory is covered regardless
-- of which of the three dispatch paths it used.
--
-- PURELY ADDITIVE
-- ---------------
-- Existing rows: send_blocked defaults to 0, so all 3 channels keep sending exactly as before —
-- nothing pauses until an admin explicitly flips it through the new UI control. Idempotent,
-- information_schema-guarded ALTER (a bare ADD COLUMN aborts a second run at boot).
--
-- ROLLBACK
-- --------
--   ALTER TABLE communication_provider_config
--     DROP COLUMN send_blocked, DROP COLUMN block_reason,
--     DROP COLUMN blocked_by, DROP COLUMN blocked_at;
-- (Safe only once no row has send_blocked = 1 — an admin relying on the pause would silently
-- lose it.)

USE mas_hrms;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'communication_provider_config'
              AND COLUMN_NAME = 'send_blocked');
SET @s := IF(@c = 0,
  'ALTER TABLE communication_provider_config
     ADD COLUMN send_blocked TINYINT(1) NOT NULL DEFAULT 0 AFTER is_enabled,
     ADD COLUMN block_reason VARCHAR(255) COLLATE utf8mb4_unicode_ci NULL AFTER send_blocked,
     ADD COLUMN blocked_by   CHAR(36) COLLATE utf8mb4_unicode_ci NULL AFTER block_reason,
     ADD COLUMN blocked_at   DATETIME NULL AFTER blocked_by',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Verification (expect send_blocked = 0 on all 3 rows):
-- SELECT channel, is_enabled, send_blocked, block_reason FROM communication_provider_config;
