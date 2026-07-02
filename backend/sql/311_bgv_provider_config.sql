-- BGV provider configuration stored in org_settings
-- Allows Super Admin to switch provider and enter API keys from the UI
-- without touching the .env file or restarting the backend.

INSERT IGNORE INTO org_settings (id, setting_key, setting_value, label) VALUES
  (UUID(), 'bgv_provider',           'mock',   'BGV Provider (mock | infinity_ai | digio)'),
  (UUID(), 'infinity_ai_api_url',    'https://api.infinityai.in', 'Infinity AI API Base URL'),
  (UUID(), 'infinity_ai_api_key',    NULL,     'Infinity AI API Key'),
  (UUID(), 'infinity_ai_client_id',  NULL,     'Infinity AI Client ID'),
  (UUID(), 'infinity_ai_portal_url', 'http://candidates.theinfiniti.ai', 'Infinity AI Candidate Portal URL'),
  (UUID(), 'digio_api_url',          'https://ext.digio.in:444', 'Digio API Base URL'),
  (UUID(), 'digio_client_id',        NULL,     'Digio Client ID'),
  (UUID(), 'digio_client_secret',    NULL,     'Digio Client Secret');
