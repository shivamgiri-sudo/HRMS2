-- Migration 340: Update TDS slabs to Budget 2025 / Finance Act 2025
-- New Regime FY 2026-27 (Section 115BAC as amended by Finance Bill 2025)
-- Slabs: 0-4L=0%, 4-8L=5%, 8-12L=10%, 12-16L=15%, 16-20L=20%, 20-24L=25%, 24L+=30%
-- 87A rebate raised to ₹12L; 4% health+education cess.
-- Standard deduction ₹75,000 (unchanged).

-- Widen config_value column to hold values up to ₹24L+
ALTER TABLE statutory_config MODIFY COLUMN config_value DECIMAL(15,4) NOT NULL;

-- Remove old FY2025-26 slab keys
DELETE FROM statutory_config WHERE config_key IN (
  'tds_slab_0_300000',
  'tds_slab_300001_700000',
  'tds_slab_700001_1000000',
  'tds_slab_1000001_1200000',
  'tds_slab_1200001_1500000',
  'tds_slab_1500001_above'
);

-- Insert Budget 2025 / FY 2026-27 slabs
INSERT INTO statutory_config (id, config_key, config_value, description, effective_from) VALUES
  (UUID(), 'tds_slab_0_400000',        0.00,  'New regime: 0-4L = 0%',                   '2025-04-01'),
  (UUID(), 'tds_slab_400001_800000',   5.00,  'New regime: 4L-8L = 5%',                  '2025-04-01'),
  (UUID(), 'tds_slab_800001_1200000',  10.00, 'New regime: 8L-12L = 10%',                '2025-04-01'),
  (UUID(), 'tds_slab_1200001_1600000', 15.00, 'New regime: 12L-16L = 15%',               '2025-04-01'),
  (UUID(), 'tds_slab_1600001_2000000', 20.00, 'New regime: 16L-20L = 20%',               '2025-04-01'),
  (UUID(), 'tds_slab_2000001_2400000', 25.00, 'New regime: 20L-24L = 25%',               '2025-04-01'),
  (UUID(), 'tds_slab_2400001_above',   30.00, 'New regime: 24L+ = 30%',                  '2025-04-01')
ON DUPLICATE KEY UPDATE
  config_value = VALUES(config_value),
  description  = VALUES(description),
  effective_from = VALUES(effective_from);

-- Update 87A rebate limit from ₹7L to ₹12L (Budget 2025)
INSERT INTO statutory_config (id, config_key, config_value, description, effective_from)
  VALUES (UUID(), 'tds_rebate_87a_limit', 1200000.00, '87A rebate: nil tax if total income ≤ ₹12L (Budget 2025)', '2025-04-01')
ON DUPLICATE KEY UPDATE
  config_value   = 1200000.00,
  description    = '87A rebate: nil tax if total income ≤ ₹12L (Budget 2025)',
  effective_from = '2025-04-01';

-- Add cess rate (4% health and education cess — Finance Act, applied above ₹12L)
INSERT INTO statutory_config (id, config_key, config_value, description, effective_from)
  VALUES (UUID(), 'tds_cess_pct', 4.00, '4% health and education cess on income tax (Finance Act)', '2025-04-01')
ON DUPLICATE KEY UPDATE
  config_value   = 4.00,
  description    = '4% health and education cess on income tax (Finance Act)',
  effective_from = '2025-04-01';

-- Standard deduction unchanged at ₹75,000
UPDATE statutory_config
   SET description = '₹75,000 standard deduction — New Regime FY2026-27 (unchanged from FY2025-26)'
 WHERE config_key = 'tds_standard_deduction';
