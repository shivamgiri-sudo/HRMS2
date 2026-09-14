-- Migration 1003: BGV API cost configuration per check type
-- Allows super_admin to configure cost per API call for billing/monitoring

INSERT INTO org_settings (id, setting_key, setting_value, label)
VALUES
  (UUID(), 'bgv_api_cost_aadhaar', '5', 'Aadhaar Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_pan', '3', 'PAN Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_bank', '4', 'Bank Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_criminal', '15', 'Criminal Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_education', '10', 'Education Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_employment', '10', 'Employment Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_address', '8', 'Address Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_court', '12', 'Court Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_uan', '6', 'UAN Check Cost (₹)'),
  (UUID(), 'bgv_api_cost_digilocker', '2', 'DigiLocker Check Cost (₹)')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
