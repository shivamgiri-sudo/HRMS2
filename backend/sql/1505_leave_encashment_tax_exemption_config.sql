-- Migration 1505: leave_encashment_tax_exemption_limit config key for the F&F Phase 2
-- TDS true-up (ff-compute.service.ts's resolveTdsTrueUp). Inserted INACTIVE (is_active=0)
-- — a placeholder so the key is discoverable in statutory_config, not an approved figure.
-- There is no income-tax exemption-limit concept for leave encashment (s.10(10AA)) anywhere
-- else in this codebase; until a real value is reviewed and activated by the payroll/tax
-- owner, the true-up treats leave encashment as fully taxable (the conservative default —
-- see resolveTdsTrueUp's own comments). No guessed exemption amount is shipped here.
INSERT IGNORE INTO statutory_config (config_key, config_value, is_active, description)
VALUES (
  'leave_encashment_tax_exemption_limit',
  '0',
  0,
  'Income-tax exemption limit (s.10(10AA)) applied before leave encashment is added to the F&F TDS true-up''s taxable income. Placeholder value only — review and set is_active=1 once approved by the payroll/tax owner.'
);
