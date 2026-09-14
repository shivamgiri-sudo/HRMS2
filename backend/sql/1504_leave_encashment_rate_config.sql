-- Migration 1504: leave_encashment_day_divisor config key for the F&F Phase 1
-- compute engine (ff-compute.service.ts). Inserted INACTIVE (is_active=0) — this
-- is a placeholder so the key is discoverable in statutory_config, not an approved
-- rate. ff-compute.service.ts's leave-encashment component reads this key with
-- `AND is_active = 1`, exactly like calculateGratuity's own config reads, so
-- leaving it inactive means leave encashment correctly stays pending_configuration
-- until a payroll/HR owner reviews and activates a real divisor — the same
-- discipline gratuity_statutory_cap was left unseeded under until an approved
-- value existed. No hardcoded/guessed rate is shipped here.
INSERT IGNORE INTO statutory_config (config_key, config_value, is_active, description)
VALUES (
  'leave_encashment_day_divisor',
  '26',
  0,
  'Divisor for per-day leave encashment rate (gross monthly / divisor). Placeholder value only — review and set is_active=1 once approved by the payroll owner.'
);
