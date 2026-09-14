-- 342_bgv_provider_config_labels.sql
-- Seed live BGV/DigiLocker provider settings so Super Admin can configure
-- all onboarding verification APIs from the Settings > BGV Config UI.

INSERT INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'bgv_provider', 'befisc_luckpay', 'Active BGV provider'),
  (UUID(), 'digilocker_enabled', 'true', 'Enable DigiLocker document verification in onboarding'),
  (UUID(), 'digilocker_session_url', NULL, 'DigiLocker Session/Create URL'),
  (UUID(), 'digilocker_api_key', NULL, 'DigiLocker API Key'),
  (UUID(), 'digilocker_client_id', NULL, 'DigiLocker Client ID'),
  (UUID(), 'befisc_api_url', NULL, 'Befisc Aadhaar API Base URL'),
  (UUID(), 'befisc_api_key', NULL, 'Befisc Aadhaar API Key'),
  (UUID(), 'luckpay_api_url', NULL, 'Luckpay API Base URL'),
  (UUID(), 'luckpay_basic_token', NULL, 'Luckpay Basic Token'),
  (UUID(), 'luckpay_client_id', NULL, 'Luckpay Client ID'),
  (UUID(), 'crimescan_api_url', NULL, 'Crimescan API Base URL'),
  (UUID(), 'crimescan_api_key', NULL, 'Crimescan API Key'),
  (UUID(), 'infinity_ai_api_url', 'https://api.infinityai.in', 'Infinity AI API Base URL'),
  (UUID(), 'infinity_ai_api_key', NULL, 'Infinity AI API Key'),
  (UUID(), 'infinity_ai_client_id', NULL, 'Infinity AI Client ID'),
  (UUID(), 'infinity_ai_portal_url', 'http://candidates.theinfiniti.ai', 'Infinity AI Candidate Portal URL'),
  (UUID(), 'digio_api_url', 'https://api.digio.in', 'Digio API Base URL'),
  (UUID(), 'digio_client_id', NULL, 'Digio Client ID'),
  (UUID(), 'digio_client_secret', NULL, 'Digio Client Secret')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  setting_value = CASE
    WHEN org_settings.setting_value IS NULL OR org_settings.setting_value = '' THEN VALUES(setting_value)
    ELSE org_settings.setting_value
  END;
