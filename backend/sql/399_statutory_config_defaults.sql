-- Migration 399: Seed configurable defaults that were previously hardcoded
INSERT IGNORE INTO statutory_config (config_key, config_value, description) VALUES
  ('gratuity_pct', '4.81', 'Employer gratuity provision % of basic salary'),
  ('conv_allowance_default', '1600', 'Default conveyance allowance for special allowance breakup'),
  ('medical_allowance_default', '1250', 'Default medical allowance for special allowance breakup'),
  ('tds_standard_deduction', '75000', 'Standard deduction for TDS calculation under new regime');
