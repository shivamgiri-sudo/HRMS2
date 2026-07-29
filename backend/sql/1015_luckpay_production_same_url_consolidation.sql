-- 1015_luckpay_production_same_url_consolidation.sql
--
-- Production Luckpay: DigiLocker and eSign share the same base URL and the same
-- credentials as PAN / UAN / Penny-Drop. The luckpay_digilocker_* override keys
-- remain supported (so a separate staging/production DigiLocker account can still
-- be configured later) but are left empty in production so they fall back to the
-- luckpay_* values below.
--
-- Secrets (luckpay_basic_token, luckpay_client_id, webhook secret) are NEVER
-- stored here. Set them from Super Admin > Settings > BGV Config, or leave them
-- unset to fall back to the server environment.

INSERT INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'bgv_provider', 'befisc_luckpay', 'Active BGV provider'),
  (UUID(), 'luckpay_api_url', 'https://api-banking.luckpay.in/apibanking/api/v1', 'Luckpay API Base URL (PAN / UAN / Penny-Drop / DigiLocker / eSign)'),
  (UUID(), 'digilocker_session_url', 'https://api-banking.luckpay.in/apibanking/api/v1/verifyDigilockerWithURL', 'DigiLocker Session/Create URL')
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  label         = VALUES(label);

-- Clear ONLY stale staging DigiLocker/eSign overrides so they fall back to the
-- production values above. A row holding genuine separate production credentials
-- is left untouched — an unconditional NULL would destroy a deliberate
-- staging/production split.
UPDATE org_settings
   SET setting_value = NULL
 WHERE setting_key = 'luckpay_digilocker_base_url'
   AND (setting_value IS NULL OR setting_value = '' OR setting_value LIKE '%staging%');

-- Credentials are cleared only when the DigiLocker base URL ended up empty, so
-- URL and credentials can never end up mismatched (production URL + staging
-- token would fail every call).
UPDATE org_settings
   SET setting_value = NULL
 WHERE setting_key IN ('luckpay_digilocker_basic_token', 'luckpay_digilocker_client_id')
   AND EXISTS (
     SELECT 1 FROM (
       SELECT setting_value AS v FROM org_settings WHERE setting_key = 'luckpay_digilocker_base_url'
     ) AS dl
      WHERE dl.v IS NULL OR dl.v = ''
   );
