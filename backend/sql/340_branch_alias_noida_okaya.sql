-- Migration 340: Correct branch aliases for NOIDA (Trapezoid) and NOIDA-2 (Okaya)
-- Replaces the placeholder example entries from 205_branch_alias_examples.sql which used
-- wrong canonical keys ('Mumbai - Trapezoid', 'Delhi - Okaya') that don't exist in branch_master.
-- Actual branch names from branch_master: 'Noida' (Trapezoid) and 'NOIDA-2' (Okaya).
-- Run: apply after 205_branch_alias_examples.sql.

USE mas_hrms;

-- Remove the example placeholders that used incorrect canonical keys
DELETE FROM ats_branch_alias_master WHERE canonical_key IN ('Mumbai - Trapezoid', 'Delhi - Okaya', 'Bangalore - Corporate Office');

-- Noida / Trapezoid — display "Noida (Trapezoid)" to candidates
INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
VALUES (UUID(), 'Noida', 'Noida (Trapezoid)', 'Noida Trapezoid TPZ Sector', 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  alias_text   = VALUES(alias_text),
  active_status = 1;

-- NOIDA-2 / Okaya — display "Noida (Okaya)" to candidates
INSERT INTO ats_branch_alias_master (id, canonical_key, display_name, alias_text, active_status)
VALUES (UUID(), 'NOIDA-2', 'Noida (Okaya)', 'Noida2 Okaya N2', 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  alias_text   = VALUES(alias_text),
  active_status = 1;
