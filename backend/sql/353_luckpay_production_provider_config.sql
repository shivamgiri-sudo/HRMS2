-- 353_luckpay_production_provider_config.sql
-- Non-secret Luckpay production provider defaults.
-- Secrets (luckpay_basic_token, luckpay_client_id, webhook secret) must be set
-- from server environment or Super Admin provider config, never committed here.

INSERT INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'bgv_provider', 'befisc_luckpay', 'Active BGV provider'),
  (UUID(), 'luckpay_api_url', 'https://api-banking.luckpay.in/apibanking/api/v1', 'Luckpay API Base URL'),
  (UUID(), 'digilocker_session_url', 'https://api-banking.luckpay.in/apibanking/api/v1/verifyDigilockerWithURL', 'DigiLocker Session/Create URL')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  setting_value = VALUES(setting_value);
