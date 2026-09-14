-- Migration: Add Gujarat PT slabs and normalize branch state names for PT matching
-- Gujarat has PT: Rs 0 for income <= 12000, Rs 200 for income > 12000

-- Add Gujarat PT slabs
INSERT INTO pt_slab_master (id, state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from, is_active)
SELECT UUID(), 'GJ', 'Gujarat', 0.00, 12000.00, 0.00, 'monthly', '2025-04-01', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM pt_slab_master WHERE state_code = 'GJ' AND is_active = 1);

INSERT INTO pt_slab_master (id, state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from, is_active)
SELECT UUID(), 'GJ', 'Gujarat', 12001.00, NULL, 200.00, 'monthly', '2025-04-01', 1
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM pt_slab_master WHERE state_code = 'GJ' AND income_from = 12001 AND is_active = 1);

-- Normalize branch_master state names to match pt_slab_master.state_name
-- This ensures getPtFromSlab case-insensitive match works for all states
UPDATE branch_master SET state = 'Telangana' WHERE LOWER(state) = 'telangana' AND state != 'Telangana';
UPDATE branch_master SET state = 'Gujarat' WHERE LOWER(state) IN ('gujarat', 'gujrat') AND state NOT IN ('Gujarat');
UPDATE branch_master SET state = 'Haryana' WHERE LOWER(state) = 'haryana' AND state != 'Haryana';
UPDATE branch_master SET state = 'Punjab' WHERE LOWER(state) = 'punjab' AND state != 'Punjab';
