-- 1227 — the real client entity a cost centre bills, which no column currently holds.
--
-- cost_centre_master.client_name does NOT contain a client. Verified against db_bill on
-- 2026-08-17 across 400 cost centres joined on bill_source_id: it equals cost_master.process_name
-- (the campaign) on 400 of 400, and cost_master.client (the legal entity) on 0 of 400. It is also
-- byte-identical to process_name_bill on all 785 populated rows — the migration copied the process
-- name into both columns and dropped the client.
--
-- The visible cost: one client reads as many. "Vodafone" appears as 14 different client_name values
-- (Vodafone CS, Vodafone EKYC, Vodafone Retention, Vodafone CNC …) which are 14 processes for a
-- single client, Vodafone Mobile Services Ltd. Searching the client's real name finds nothing.
--
-- Neither existing id can supply it:
--   * cost_centre_master.client_id is NULL on all 927 rows and its FK points at client_master,
--     which is the Client PORTAL TENANT registry (api_key, webhook_url, subscription_status) —
--     12 mostly-dead rows. A billing counterparty is not a portal tenant.
--   * db_bill cost_master.dialdesk_client_id is populated on 287 rows and resolves cleanly to
--     db_bill.client_master.id on all 287 — but the resolved name disagrees with the row's own
--     client text on 287 of 287 (e.g. "Wheel India SCM Solutions Pvt Ltd" resolves to "Valeo
--     Motherson Thermal Commercial Vehicles India Limited"). That FK is wrong, not merely empty.
--
-- The reliable source is already inside mas_hrms: billing_invoice_snapshot carries bill_client,
-- bill_process_name and cost_centre_code together on 10,987 real invoices — 592 distinct clients,
-- current to 2026-08. 399 of 437 active cost centres (91%) resolve through it.
--
-- ADDITIVE ONLY. A new nullable column; client_name, process_name_bill and client_id are all left
-- exactly as they are, so every existing read, filter and report behaves identically. Nothing is
-- backfilled by this migration — population is a separate, reviewable script, because 10 cost
-- centres have billed more than one distinct client and must not be collapsed silently.
--
-- Guarded with information_schema + PREPARE/EXECUTE rather than ADD COLUMN IF NOT EXISTS: that is
-- MariaDB syntax which this MySQL 8 server rejects while the runner still records the migration as
-- applied — the 2026-08-13 outage pattern. Re-runnable; no DROP, no DELETE, no data change.

SET @c_billing_client := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master'
    AND COLUMN_NAME = 'billing_client_name');

SET @add_billing_client := IF(@c_billing_client = 0,
  'ALTER TABLE cost_centre_master ADD COLUMN billing_client_name VARCHAR(255) NULL COMMENT ''Legal entity invoiced, from billing_invoice_snapshot.bill_client. client_name holds the PROCESS name, not a client.'' AFTER client_name',
  'SELECT "billing_client_name already exists" AS info');

PREPARE stmt FROM @add_billing_client;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Cost centres are filtered and grouped by client once this is populated.
SET @i_billing_client := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cost_centre_master'
    AND INDEX_NAME = 'idx_ccm_billing_client');

SET @add_billing_client_idx := IF(@i_billing_client = 0,
  'CREATE INDEX idx_ccm_billing_client ON cost_centre_master (billing_client_name)',
  'SELECT "idx_ccm_billing_client already exists" AS info');

PREPARE stmt FROM @add_billing_client_idx;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
