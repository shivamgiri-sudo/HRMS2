-- ============================================================
-- Migration 334: process_master — set branch_id and client_name
--                for known live processes (TPZ / Okaya / AHM)
--
-- Source of truth: Shivamgiri.employee_mapping_master + EmployProcessDetails
-- + Shivamgiri.process_mapping_master (authoritative branch→process mapping)
--
-- ADDITIVE ONLY:
--   • Only UPDATEs rows where branch_id IS NULL (idempotent re-runs)
--   • No INSERTs, no DELETEs, no schema changes
--   • Does NOT touch employee.process_id assignments
--   • Does NOT change process_code or process_name (FK-safe)
--
-- ROLLBACK (safe — only restores NULLs):
--   UPDATE process_master
--     SET branch_id = NULL, client_name = NULL
--   WHERE process_name IN (
--     'Bella-Vita Organic','BirlaNu Limited','Clovia','DU Digital',
--     'Exicom','GNC','Housing.com','Neemans Private Limited','Viega',
--     'VST','SolveEasy','Dalmia Cement','Appriciate Wealth',
--     'Reginald','Finfort'
--   );
-- ============================================================

-- ── NOIDA (Trapezoid) processes ────────────────────────────────────────────────
UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Bella-Vita',
      updated_at  = NOW()
WHERE process_name = 'Bella-Vita Organic'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Birla Nu',
      updated_at  = NOW()
WHERE process_name = 'BirlaNu Limited'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Clovia',
      updated_at  = NOW()
WHERE process_name = 'Clovia'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'DU Digital',
      updated_at  = NOW()
WHERE process_name = 'DU Digital'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Exicom',
      updated_at  = NOW()
WHERE process_name = 'Exicom'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'GNC',
      updated_at  = NOW()
WHERE process_name = 'GNC'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Housing.com',
      updated_at  = NOW()
WHERE process_name = 'Housing.com'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Neemans',
      updated_at  = NOW()
WHERE process_name = 'Neemans Private Limited'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Viega',
      updated_at  = NOW()
WHERE process_name = 'Viega'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'VST',
      updated_at  = NOW()
WHERE process_name = 'VST'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'SolveEasy',
      updated_at  = NOW()
WHERE process_name = 'SolveEasy'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Dalmia Cement',
      updated_at  = NOW()
WHERE process_name = 'Dalmia Cement'
  AND branch_id IS NULL;

UPDATE process_master
  SET branch_id  = '77769026-5e88-11f1-adb1-00155d0ab410',
      client_name = 'Appriciate Wealth',
      updated_at  = NOW()
WHERE process_name = 'Appriciate Wealth'
  AND branch_id IS NULL;

-- ── NOIDA-2 (Okaya) processes ──────────────────────────────────────────────────
UPDATE process_master
  SET branch_id  = 'febd8777-6583-11f1-adb1-00155d0ab410',
      client_name = 'Reginald Men',
      updated_at  = NOW()
WHERE process_name = 'Reginald'
  AND branch_id IS NULL;

-- ── AHMEDABAD-JALDARSHAN processes ─────────────────────────────────────────────
UPDATE process_master
  SET branch_id  = 'fea10538-6583-11f1-adb1-00155d0ab410',
      client_name = 'Finfort',
      updated_at  = NOW()
WHERE process_name = 'Finfort'
  AND branch_id IS NULL;

-- ── Verify results ─────────────────────────────────────────────────────────────
SELECT
  p.process_name,
  p.client_name,
  b.branch_name,
  b.branch_code
FROM process_master p
LEFT JOIN branch_master b ON b.id = p.branch_id
WHERE p.active_status = 1
  AND p.client_name IS NOT NULL
ORDER BY b.branch_name, p.process_name;

SELECT '334_process_master_branch_mapping.sql applied successfully' AS migration_status;
