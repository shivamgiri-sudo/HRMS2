-- 1513_capex_software_freight_sub_heads.sql
--
-- Adds the missing sub-heads that the 457 unresolved legacy triples in
-- 1092_vendor_expense_mapping_legacy_import.sql map to.  That file could not insert
-- those vendor→head/subhead rows because the target sub-heads did not exist yet.
--
-- WHAT THE 457 TRIPLES CONTAIN (four resolvable categories + two un-resolvable):
--
--   1. COMPUTERS-YYYY-YY COST  /  Computers YY-YY COST  (year-versioned hardware capex)
--      → REPAIRS_MAINTENANCE_CAPEX / CAPEX_COMPUTERS  ← already exists from migration 1060.
--        No new sub-head needed; Finance can map vendors through the Expense Mapping tab.
--
--   2. Computer Software Cost YYYY - YY  (year-versioned software capex under R&M)
--      → REPAIRS_MAINTENANCE_CAPEX / CAPEX_SOFTWARE  ← DOES NOT EXIST yet — created below.
--
--   3. FURNITURE & FIXTURE - COST  [sits under a different head in HRMS2]
--      → REPAIRS_MAINTENANCE_CAPEX / CAPEX_FURNITURE_FIXTURE  ← already exists from 1060.
--
--   4. ELECTRICAL INSTALLATIONS - COST  [sits under a different head in HRMS2]
--      → REPAIRS_MAINTENANCE_CAPEX / CAPEX_ELECTRICAL  ← already exists from 1060.
--
--   5. Freight & Cargo Charges  — head did not exist in HRMS2 at all.
--      → FREIGHT_CARGO head + sub-head  ← created below.
--
--   6. Professional Tax YYYY-YY  (year-versioned)
--      → DUTIES_AND_TAXES / PROFESSIONAL_TAX  ← already exists from 1060.
--
--   7. Business Promotion Expenses  [sits under a different head in legacy]
--      → BUSINESS_PROMOTION / BUSINESS_PROMOTION  ← already exists from migration 412.
--
--   8. Fee & Subscription / Fee & Subscription
--      → FEE_SUBSCRIPTION / FEE_SUBSCRIPTION  ← already exists from migration 412.
--
--   9. Newspaper & Periodicals
--      → PRINTING_STATIONERY / NEWSPAPER_PERIODICALS  ← already exists from 1060.
--
-- VENDOR-LEVEL BACKFILL
-- The 457 unresolved rows are listed as comments in 1092 (no DB_BILL_XX codes — only
-- vendor names). Since db_bill is a separate MySQL 5.5 server not accessible from
-- mas_hrms migrations, the per-vendor INSERT rows cannot be auto-generated here.
-- Finance can assign any remaining vendor that still shows "Unmapped" in the
-- Vendor Management → Expense Mapping tab using the UI added in this same release.
--
-- All INSERTs below are idempotent: IF NOT EXISTS / ON DUPLICATE KEY UPDATE / IGNORE.

-- ─── 1. CAPEX_SOFTWARE under REPAIRS_MAINTENANCE_CAPEX ───────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order,
   default_unit, default_tax_treatment, default_gst_rate,
   default_gst_type, default_recoverable_tax_pct,
   default_allocation_driver, pnl_treatment, capex_opex, active_status)
SELECT
  UUID(), h.id,
  'CAPEX_SOFTWARE', 'Computers - Software Cost',
  45,
  'License', 'exclusive', 18, 'cgst_sgst', 100,
  'device_count', 'non_operating', 'capex', 1
FROM finance_expense_head_master h
WHERE h.head_code = 'REPAIRS_MAINTENANCE_CAPEX'
  AND NOT EXISTS (
    SELECT 1 FROM finance_expense_sub_head_master s2
    WHERE s2.head_id = h.id AND s2.sub_head_code = 'CAPEX_SOFTWARE'
  );

-- ─── 2. FREIGHT_CARGO head (new) ─────────────────────────────────────────────

INSERT IGNORE INTO finance_expense_head_master
  (id, head_code, head_name, display_order, active_status)
VALUES
  (UUID(), 'FREIGHT_CARGO', 'Freight & Cargo Charges', 230, 1);

-- ─── 3. FREIGHT_CARGO sub-head ────────────────────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order,
   default_unit, default_tax_treatment, default_gst_rate,
   default_gst_type, default_recoverable_tax_pct,
   default_allocation_driver, pnl_treatment, active_status)
SELECT
  UUID(), h.id,
  'FREIGHT_CARGO', 'Freight & Cargo Charges',
  10,
  'Shipment', 'exclusive', 18, 'cgst_sgst', 100,
  'revenue_share', 'direct_cost', 1
FROM finance_expense_head_master h
WHERE h.head_code = 'FREIGHT_CARGO'
  AND NOT EXISTS (
    SELECT 1 FROM finance_expense_sub_head_master s2
    WHERE s2.head_id = h.id AND s2.sub_head_code = 'FREIGHT_CARGO'
  );
