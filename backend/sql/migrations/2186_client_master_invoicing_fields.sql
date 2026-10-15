-- Migration 2186: client_master invoicing fields + GSTIN backfill from gst_export_row.
--
-- WHY THESE COLUMNS:
--   gstin              — Client's GST registration number (15-char). Required on every B2B tax
--                        invoice under CGST/SGST rules. Needed to determine IGST vs CGST+SGST
--                        (inter-state vs intra-state supply).
--   billing_state_code — First 2 digits of GSTIN encode the state (01=J&K, 27=Maharashtra, etc.).
--                        Stored separately for fast join to `indian_states` and for invoice PDF
--                        logic that picks the right tax head without re-parsing GSTIN every time.
--   pan_number         — Client PAN; required for TDS compliance and for Form 26Q filing. Must
--                        match GSTIN digits 3-12 (digits 3–12 of GSTIN = PAN when the registrant
--                        is a company/LLP/individual).
--   payment_terms_days — Credit period agreed with the client (30 / 45 / 60 days). Used by AR
--                        ageing, overdue alerts and the invoice PDF "Due Date" calculation.
--                        Default 30 matches the most common BPO contract term.
--   hsn_sac_code       — SAC code for the service being invoiced. '998593' is the standard SAC
--                        for "Other support services" / BPO / call-centre services under GST.
--                        Clients whose contracts require a different SAC (e.g. 998212 IT support)
--                        can override at client level.
--   tds_section        — Section under which TDS is deducted on this client's payments (e.g.
--                        194C for contracts, 194J for professional services). Used in Form 26Q
--                        export and remittance challans.
--   tds_rate           — Applicable TDS rate (%). 2.00 for 194C company, 10.00 for 194J. Stored
--                        here so Finance can override per client without code changes.
--   credit_limit       — Accounts-receivable credit ceiling in INR. Invoicing module warns when
--                        outstanding dues exceed this limit. NULL = no configured limit.
--   invoice_prefix     — Optional client-specific prefix for invoice numbers (e.g. "MCN-XYZ-").
--                        When NULL the global configured prefix is used.
--
-- BACKFILL SAFETY:
--   1. GSTIN backfill only touches rows where cm.gstin IS NULL — it never overwrites existing data.
--   2. It sources data from gst_export_row (our own previously-issued B2B invoices) so the values
--      are already validated: they passed GST portal validation when the original invoices were
--      filed.
--   3. Only unambiguous 1-to-1 name→GSTIN mappings are used (HAVING COUNT(DISTINCT gstin) = 1).
--      Any client with two different GSTINs in history (branch registrations etc.) is skipped.
--   4. billing_state_code backfill from LEFT(gstin, 2) is deterministic and stateless — the same
--      result is produced on every run, so the migration is idempotent.
--   5. hsn_sac_code default '998593' is the universal BPO SAC; it is only applied to NULL rows.
--   6. gst_export_row cleanup replaces 'N/A' / 'NA' with the correct SAC — these are legacy import
--      artefacts that break GST return uploads; no real data is lost.

-- ─── 1. ADD COLUMNS (each guarded via INFORMATION_SCHEMA) ────────────────────

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'gstin') = 0,
  'ALTER TABLE client_master ADD COLUMN gstin VARCHAR(15) NULL COMMENT ''Client GSTIN for B2B invoicing''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'billing_state_code') = 0,
  'ALTER TABLE client_master ADD COLUMN billing_state_code VARCHAR(2) NULL COMMENT ''First 2 digits of GSTIN; used for IGST/CGST tax-head determination''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'pan_number') = 0,
  'ALTER TABLE client_master ADD COLUMN pan_number VARCHAR(10) NULL COMMENT ''Client PAN for TDS compliance and Form 26Q filing''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'payment_terms_days') = 0,
  'ALTER TABLE client_master ADD COLUMN payment_terms_days INT NULL DEFAULT 30 COMMENT ''Credit period in days (30/45/60); drives AR ageing and invoice due-date''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'hsn_sac_code') = 0,
  'ALTER TABLE client_master ADD COLUMN hsn_sac_code VARCHAR(10) NULL DEFAULT ''998593'' COMMENT ''SAC code for invoiced services; 998593 = BPO/call-centre''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'tds_section') = 0,
  'ALTER TABLE client_master ADD COLUMN tds_section VARCHAR(20) NULL COMMENT ''TDS section code (194C / 194J / 194N / 194I)''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'tds_rate') = 0,
  'ALTER TABLE client_master ADD COLUMN tds_rate DECIMAL(5,2) NULL COMMENT ''TDS rate percentage (e.g. 2.00 for 194C, 10.00 for 194J)''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'credit_limit') = 0,
  'ALTER TABLE client_master ADD COLUMN credit_limit DECIMAL(14,2) NULL COMMENT ''AR credit ceiling in INR; NULL = no configured limit''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND COLUMN_NAME = 'invoice_prefix') = 0,
  'ALTER TABLE client_master ADD COLUMN invoice_prefix VARCHAR(20) NULL COMMENT ''Client-specific invoice number prefix; NULL = use global prefix''',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─── 2. BACKFILL gstin + billing_state_code from gst_export_row ─────────────
--
-- Uses only unambiguous 1:1 name→GSTIN mappings (HAVING COUNT(DISTINCT) = 1).
-- Skips any client_master row that already has a gstin value.

UPDATE client_master cm
JOIN (
  SELECT client_name, MAX(client_gstin) AS client_gstin, MAX(client_state_code) AS client_state_code
  FROM gst_export_row
  WHERE client_gstin IS NOT NULL
    AND client_gstin != ''
    AND LENGTH(client_gstin) = 15
  GROUP BY client_name
  HAVING COUNT(DISTINCT client_gstin) = 1
) ger ON TRIM(LOWER(ger.client_name)) = TRIM(LOWER(cm.client_name))
SET cm.gstin             = ger.client_gstin,
    cm.billing_state_code = ger.client_state_code
WHERE cm.gstin IS NULL;

-- ─── 3. BACKFILL billing_state_code from GSTIN first 2 chars ────────────────
--
-- Covers rows that got a GSTIN in step 2 but whose client_state_code in
-- gst_export_row was NULL, and any rows where gstin was pre-populated
-- before this migration but billing_state_code was never set.

UPDATE client_master
SET billing_state_code = LEFT(gstin, 2)
WHERE gstin IS NOT NULL
  AND LENGTH(gstin) = 15
  AND (billing_state_code IS NULL OR billing_state_code = '');

-- ─── 4. BACKFILL hsn_sac_code default for existing NULL rows ─────────────────

UPDATE client_master
SET hsn_sac_code = '998593'
WHERE hsn_sac_code IS NULL;

-- ─── 5. FIX legacy 'N/A' and 'NA' hsn_sac_code values in gst_export_row ─────
--
-- These were written during early bulk-import where the source sheet had no SAC
-- column. They break GST return uploads (GSTN portal rejects non-numeric SAC).

UPDATE gst_export_row
SET hsn_sac_code = '998593'
WHERE hsn_sac_code IN ('N/A', 'NA', 'n/a', 'na', '');

-- ─── 6. BACKFILL gstin + pan_number from cost_centre_master ─────────────────
--
-- cost_centre_master.vendor_gst_no holds the client GSTIN at process level.
-- Only take rows where a client has exactly 1 distinct GSTIN across all its
-- cost centres (unambiguous). Multi-state clients (>1 GSTIN) are skipped.
-- PAN is always derivable from a valid 15-char GSTIN (chars 3–12).

UPDATE client_master cm
JOIN (
  SELECT cc.client_id,
         MAX(cc.vendor_gst_no)                    AS gstin,
         LEFT(MAX(cc.vendor_gst_no), 2)            AS billing_state_code,
         UPPER(SUBSTR(MAX(cc.vendor_gst_no), 3, 10)) AS pan_number
  FROM cost_centre_master cc
  JOIN client_master cm2 ON cm2.id = cc.client_id
  WHERE cc.vendor_gst_no IS NOT NULL AND LENGTH(cc.vendor_gst_no) = 15
    AND cm2.gstin IS NULL
  GROUP BY cc.client_id
  HAVING COUNT(DISTINCT cc.vendor_gst_no) = 1
) src ON cm.id = src.client_id
SET cm.gstin             = src.gstin,
    cm.billing_state_code = src.billing_state_code,
    cm.pan_number        = src.pan_number
WHERE cm.gstin IS NULL;

-- Derive PAN for any remaining rows that got GSTIN earlier (gst_export_row backfill)
-- but had pan_number not yet set.
UPDATE client_master
SET pan_number = UPPER(SUBSTR(gstin, 3, 10))
WHERE gstin IS NOT NULL AND LENGTH(gstin) = 15 AND pan_number IS NULL;

-- ─── 7. INDEX on client_master.gstin ────────────────────────────────────────

SET @s = IF((SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_master' AND INDEX_NAME = 'idx_client_master_gstin') = 0,
  'ALTER TABLE client_master ADD INDEX idx_client_master_gstin (gstin)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

