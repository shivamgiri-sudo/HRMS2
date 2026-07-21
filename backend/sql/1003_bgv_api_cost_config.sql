-- Migration 1003: BGV API cost configuration per check type
-- Allows super_admin to configure cost per API call for billing/monitoring

INSERT INTO org_settings (setting_key, setting_value, category, label, editable_by_role)
VALUES
  ('bgv_api_cost_aadhaar', '5', 'bgv_api_costs', 'Aadhaar Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_pan', '3', 'bgv_api_costs', 'PAN Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_bank', '4', 'bgv_api_costs', 'Bank Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_criminal', '15', 'bgv_api_costs', 'Criminal Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_education', '10', 'bgv_api_costs', 'Education Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_employment', '10', 'bgv_api_costs', 'Employment Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_address', '8', 'bgv_api_costs', 'Address Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_court', '12', 'bgv_api_costs', 'Court Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_uan', '6', 'bgv_api_costs', 'UAN Check Cost (₹)', 'super_admin'),
  ('bgv_api_cost_digilocker', '2', 'bgv_api_costs', 'DigiLocker Check Cost (₹)', 'super_admin')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
