-- Migration 450: Fix Onfido employees.lob_id and add process_lob_map entries
--
-- Problem: All 251 active Onfido employees (cost centre BSS/BO/NOIDA-2/576) had
--   employees.lob_id = NULL, so the active-HC query returned 0. The LOB type for
--   each employee was stored as per-employee entries in lob_master (lob_code = MAS code,
--   lob_name = 'POA'/'Doc Check'/'Encord'). This migration:
--   1. Sets employees.lob_id to the canonical LOB id for each Onfido employee.
--   2. Adds process_lob_map entries for Onfido so future employee-lob bulk uploads work.

-- Step 1: employees.lob_id → canonical LOB for Onfido employees

-- Doc Check
UPDATE employees e
  JOIN lob_master per_lob ON per_lob.lob_code = e.employee_code AND per_lob.active_status = 1
    AND per_lob.lob_name = 'Doc Check'
SET e.lob_id = 'ffc8b54e-a884-4759-8aa3-a987d0a9b9bd'
WHERE e.active_status = 1
  AND e.cost_center_code = 'BSS/BO/NOIDA-2/576'
  AND e.lob_id IS NULL;

-- POA
UPDATE employees e
  JOIN lob_master per_lob ON per_lob.lob_code = e.employee_code AND per_lob.active_status = 1
    AND per_lob.lob_name = 'POA'
SET e.lob_id = 'db2099e8-c8f9-4d41-ab00-346f2032fa57'
WHERE e.active_status = 1
  AND e.cost_center_code = 'BSS/BO/NOIDA-2/576'
  AND e.lob_id IS NULL;

-- Encord (per-employee lob_name is 'Encord'; canonical lob_code is 'ENCORD' / lob_name 'ENCORD')
UPDATE employees e
  JOIN lob_master per_lob ON per_lob.lob_code = e.employee_code AND per_lob.active_status = 1
    AND UPPER(per_lob.lob_name) = 'ENCORD'
SET e.lob_id = '9a6174c3-d790-4eed-9998-251c513774e8'
WHERE e.active_status = 1
  AND e.cost_center_code = 'BSS/BO/NOIDA-2/576'
  AND e.lob_id IS NULL;

-- Step 2: process_lob_map entries for Onfido (enables employee-lob bulk uploads)
-- Onfido process id: 04f20ddc-67ba-11f1-adb1-00155d0ab410

INSERT IGNORE INTO process_lob_map (id, process_id, lob_id, active_status)
VALUES
  (UUID(), '04f20ddc-67ba-11f1-adb1-00155d0ab410', 'ffc8b54e-a884-4759-8aa3-a987d0a9b9bd', 1), -- DOC_CHECK
  (UUID(), '04f20ddc-67ba-11f1-adb1-00155d0ab410', 'db2099e8-c8f9-4d41-ab00-346f2032fa57', 1), -- POA
  (UUID(), '04f20ddc-67ba-11f1-adb1-00155d0ab410', '9a6174c3-d790-4eed-9998-251c513774e8', 1); -- ENCORD
