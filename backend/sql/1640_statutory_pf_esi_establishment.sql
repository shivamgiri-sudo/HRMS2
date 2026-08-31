-- Migration 1640: Lock in PF/ESI wage ceilings and seed PF establishment
-- Applied manually on 2026-08-31 (statutory values confirmed by finance).
--
-- PF_WAGE_LIMIT changed from 999999 → 15000:
--   PF contributions now capped at ₹15,000/month statutory ceiling.
--   Affects employees whose basic > ₹15,000 — lower PF deduction from next run.
--
-- ESIC_WAGE_LIMIT was already 21000 — no change required.
--
-- Establishment DSNHP0032026000 added to pf_establishment_master.

UPDATE statutory_config
SET    config_value = '15000',
       description  = 'EPF monthly wage ceiling — PF capped on wages up to this amount',
       updated_at   = NOW()
WHERE  config_key   = 'PF_WAGE_LIMIT';

-- ESIC already correct — idempotent upsert for completeness
INSERT INTO statutory_config (config_key, config_value, description, is_active)
VALUES ('ESIC_WAGE_LIMIT', '21000', 'ESIC gross wage ceiling — ESI not deducted above this amount', 1)
ON DUPLICATE KEY UPDATE
  config_value = VALUES(config_value),
  description  = VALUES(description),
  updated_at   = NOW();

-- PF Establishment — replace <ESTABLISHMENT_NAME> with registered name before re-running
INSERT IGNORE INTO pf_establishment_master
  (id, establishment_code, establishment_name, active_status)
VALUES
  (UUID(), 'DSNHP0032026000', '<ESTABLISHMENT_NAME>', 1);