-- Migration 1047: Backfill source_id on salary_package_master + insert 2 missing rows
-- Safe: UPDATE sets source_id only where currently NULL; INSERT uses NOT EXISTS guard.
-- Requires: db_bill accessible as a linked server OR run from a host with both DBs visible.
-- If cross-DB access is unavailable, skip and run the standalone sync script instead.

-- ── Step 1: Match existing rows by (branch_name, band_code, package_amount)
--    and write back the db_bill primary key into source_id.
--    When the same (branch, band, amount) exists multiple times in db_bill with
--    different components, the update joins ON the components too to avoid ambiguity.
-- ──────────────────────────────────────────────────────────────────────────────────

UPDATE salary_package_master h
JOIN db_bill.mas_packagemaster b
  ON  h.branch_name      = b.BranchName
  AND h.band_code        = b.Band
  AND h.package_amount   = CAST(b.PackageAmount AS DECIMAL(12,2))
  AND h.basic            = CAST(IFNULL(NULLIF(b.Basic,''),0)            AS DECIMAL(12,2))
  AND h.hra              = CAST(IFNULL(NULLIF(b.HRA,''),0)              AS DECIMAL(12,2))
  AND h.conveyance       = CAST(IFNULL(NULLIF(b.Conveyance,''),0)       AS DECIMAL(12,2))
  AND h.gross            = CAST(IFNULL(NULLIF(b.Gross,''),0)            AS DECIMAL(12,2))
  AND h.net_in_hand      = CAST(IFNULL(NULLIF(b.NetInHand,''),0)        AS DECIMAL(12,2))
  AND h.ctc              = CAST(IFNULL(NULLIF(b.CTC,''),0)              AS DECIMAL(12,2))
  AND b.PackageAmount    > '0'
SET h.source_id = b.id
WHERE h.source_id IS NULL
  AND h.active_status = 1;

-- ── Step 2: Insert any db_bill rows that have no matching row in mas_hrms.
--    Identified by: non-zero PackageAmount AND no row in salary_package_master
--    with the same 7-column fingerprint.
-- ──────────────────────────────────────────────────────────────────────────────────

INSERT INTO salary_package_master
  (id, branch_name, cost_centre_code, band_code, package_amount,
   basic, hra, conveyance, portfolio, medical, special_allowance, other_allowance,
   bonus, pli, gross, epf_employee, esic_employee, professional_tax,
   net_in_hand, epf_employer, esic_employer, admin_charges, ctc,
   active_status, source_db, source_id, created_by)
SELECT
  UUID(),
  b.BranchName,
  NULLIF(TRIM(b.CostCenter), ''),
  b.Band,
  CAST(b.PackageAmount AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Basic,''),0)       AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.HRA,''),0)         AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Conveyance,''),0)  AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Portfolio,''),0)   AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Medical,''),0)     AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Special,''),0)     AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.OtherAllow,''),0)  AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Bonus,''),0)       AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.PLI,''),0)         AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Gross,''),0)       AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.EPF,''),0)         AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.ESIC,''),0)        AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Professional,''),0)AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.NetInHand,''),0)   AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.EPFCO,''),0)       AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.ESICCO,''),0)      AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.Admin,''),0)       AS DECIMAL(12,2)),
  CAST(IFNULL(NULLIF(b.CTC,''),0)         AS DECIMAL(12,2)),
  1,
  'db_bill',
  b.id,
  NULL
FROM db_bill.mas_packagemaster b
WHERE b.PackageAmount > '0'
  AND NOT EXISTS (
    SELECT 1 FROM salary_package_master h
    WHERE h.branch_name    = b.BranchName
      AND h.band_code      = b.Band
      AND h.package_amount = CAST(b.PackageAmount AS DECIMAL(12,2))
      AND h.basic          = CAST(IFNULL(NULLIF(b.Basic,''),0)      AS DECIMAL(12,2))
      AND h.hra            = CAST(IFNULL(NULLIF(b.HRA,''),0)        AS DECIMAL(12,2))
      AND h.gross          = CAST(IFNULL(NULLIF(b.Gross,''),0)      AS DECIMAL(12,2))
      AND h.ctc            = CAST(IFNULL(NULLIF(b.CTC,''),0)        AS DECIMAL(12,2))
      AND h.active_status  = 1
  );

-- ── Step 3: Diagnostic — show how many rows still have NULL source_id after backfill.
--    Should be 0 for db_bill-sourced rows; HRMS2-native inserts legitimately stay NULL.
-- ──────────────────────────────────────────────────────────────────────────────────

SELECT
  source_db,
  SUM(source_id IS NULL)     AS null_source_id,
  SUM(source_id IS NOT NULL) AS linked_source_id,
  COUNT(*)                   AS total
FROM salary_package_master
WHERE active_status = 1
GROUP BY source_db;