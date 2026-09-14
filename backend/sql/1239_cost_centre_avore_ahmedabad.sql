-- 1239 — Add cost centre BSS/BLD/AHMH-JD/1041 "AVORE E-BIKE" for AHMEDABAD-JALDARSHAN.
--
-- Source: db_bill.cost_master id=981, created 2026-08-12.
--   cost_center  : BSS/BLD/AHMH-JD/1041
--   process_name : AVORE E-BIKE
--   client       : SAMARTH E-MOBILITY PRIVATE LIMITED
--   process      : S & M -OTHERS
--   branch       : AHMEDABAD-JALDARSHAN
--   category     : Voice
--
-- Re-runnable: guarded by NOT EXISTS on cost_centre_master and process_master,
-- ON DUPLICATE KEY on salary_cost_centre. No data is deleted or altered.

-- ── cost_centre_master ───────────────────────────────────────────────────────
INSERT INTO cost_centre_master
  (id, cost_centre_code, cost_centre_name, branch_id,
   active_status, created_at, updated_at)
SELECT
  UUID(),
  'BSS/BLD/AHMH-JD/1041',
  'AVORE E-BIKE',
  (SELECT id FROM branch_master WHERE branch_name = 'AHMEDABAD-JALDARSHAN' LIMIT 1),
  1,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM cost_centre_master
  WHERE cost_centre_code = 'BSS/BLD/AHMH-JD/1041'
);

-- ── salary_cost_centre (db_bill sync mirror) ─────────────────────────────────
INSERT INTO salary_cost_centre
  (cost_centre_code, display_name, branch_name, client_name, process_name,
   category, active_status, source_db, source_id)
VALUES
  ('BSS/BLD/AHMH-JD/1041', 'AVORE E-BIKE', 'AHMEDABAD-JALDARSHAN',
   'SAMARTH E-MOBILITY PRIVATE LIMITED', 'S & M -OTHERS',
   'Voice', 1, 'db_bill', '981')
ON DUPLICATE KEY UPDATE
  active_status = 1,
  display_name  = 'AVORE E-BIKE',
  client_name   = 'SAMARTH E-MOBILITY PRIVATE LIMITED',
  process_name  = 'S & M -OTHERS';

-- ── process_master (required for Job Requisition process dropdown) ────────────
INSERT INTO process_master
  (process_code, process_name, workload_type, branch_id, client_name, active_status)
SELECT
  'AVORE_EBIKE',
  'AVORE E-BIKE',
  'outbound_voice',
  (SELECT id FROM branch_master WHERE branch_name = 'AHMEDABAD-JALDARSHAN' LIMIT 1),
  'SAMARTH E-MOBILITY PRIVATE LIMITED',
  1
WHERE NOT EXISTS (
  SELECT 1 FROM process_master WHERE process_code = 'AVORE_EBIKE'
);
