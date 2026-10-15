-- 2214_cost_centre_process_link.sql
--
-- cost_centre_master.process_id is a 1:1 primary link (filled by cost-centre-process-resolver and the
-- 1786 backfill) and P&L, GRN and budget all read it. It cannot say "this cost centre also bills these
-- processes". Invoice particulars (client_invoice / billing_invoice_particular_snapshot, Apr-Sep 2026,
-- read 2026-10-15) show that happening for MAS Call Net cost centres:
--     BSS/IB/Noida/647     (primary IDAM)       also bills Bella-Vita: "BVO Chat", "Chat BVO/BVL", "Abandon Cart"
--     BSS/OB/NOIDA-2/972   (primary BTM)        also bills Reginald: "Customer Service Charges (Molecular Process)"
--     BSS/OB/Noida/592     (primary HOUSING_COM) also bills Housing Owner and Housing Premium (same client_id)
--     BSS/OB/Noida/968     (primary BSS_OB_NOIDA_968, VST INDUSTRIES) also bills the VST process
-- Without this, those processes look "unbilled" to any page that goes cost centre -> process by process_id.
--
-- Additive only: one new table, five seed rows. No ALTER of cost_centre_master / process_master, no FK, no
-- change to any existing row. share_pct stays NULL: a revenue split is not guessed here, it comes from the
-- invoice lines later. GNC has no evidence in cost centres or invoices and is deliberately not seeded.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS and each seed is guarded by WHERE NOT EXISTS on the pair. A seed
-- whose cost centre or process code is absent (fresh environment) inserts nothing.
-- REVERT: DROP TABLE IF EXISTS cost_centre_process_link;

CREATE TABLE IF NOT EXISTS cost_centre_process_link (
  id              CHAR(36)     NOT NULL PRIMARY KEY,
  cost_centre_id  CHAR(36)     NOT NULL,
  process_id      CHAR(36)     NOT NULL,
  relation        VARCHAR(30)  NOT NULL DEFAULT 'also_billed_under',
  share_pct       DECIMAL(5,2) NULL,
  evidence        VARCHAR(500) NULL,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  created_by      VARCHAR(100) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ccpl_pair (cost_centre_id, process_id),
  KEY idx_ccpl_process (process_id, active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO cost_centre_process_link (id, cost_centre_id, process_id, evidence, created_by)
SELECT UUID(), cc.id, p.id, 'Invoice particulars BVO Chat / Chat BVO-BVL / Abandon Cart, Apr-Sep 2026', 'migration 2214'
  FROM cost_centre_master cc
  JOIN process_master p ON p.process_code = 'BELLA_VITA'
 WHERE cc.cost_centre_code = 'BSS/IB/Noida/647'
   AND NOT EXISTS (SELECT 1 FROM cost_centre_process_link l WHERE l.cost_centre_id = cc.id AND l.process_id = p.id);

INSERT INTO cost_centre_process_link (id, cost_centre_id, process_id, evidence, created_by)
SELECT UUID(), cc.id, p.id, 'Invoice particulars Customer Service Charges (Molecular Process), Apr-Sep 2026', 'migration 2214'
  FROM cost_centre_master cc
  JOIN process_master p ON p.process_code = 'REGINALD'
 WHERE cc.cost_centre_code = 'BSS/OB/NOIDA-2/972'
   AND NOT EXISTS (SELECT 1 FROM cost_centre_process_link l WHERE l.cost_centre_id = cc.id AND l.process_id = p.id);

INSERT INTO cost_centre_process_link (id, cost_centre_id, process_id, evidence, created_by)
SELECT UUID(), cc.id, p.id, 'Same client_id as the cost centre primary process (Housing.com)', 'migration 2214'
  FROM cost_centre_master cc
  JOIN process_master p ON p.process_code = 'HOUSING_OWNER'
 WHERE cc.cost_centre_code = 'BSS/OB/Noida/592'
   AND NOT EXISTS (SELECT 1 FROM cost_centre_process_link l WHERE l.cost_centre_id = cc.id AND l.process_id = p.id);

INSERT INTO cost_centre_process_link (id, cost_centre_id, process_id, evidence, created_by)
SELECT UUID(), cc.id, p.id, 'Same client_id as the cost centre primary process (Housing.com)', 'migration 2214'
  FROM cost_centre_master cc
  JOIN process_master p ON p.process_code = 'HOUSING_PREMIUM'
 WHERE cc.cost_centre_code = 'BSS/OB/Noida/592'
   AND NOT EXISTS (SELECT 1 FROM cost_centre_process_link l WHERE l.cost_centre_id = cc.id AND l.process_id = p.id);

INSERT INTO cost_centre_process_link (id, cost_centre_id, process_id, evidence, created_by)
SELECT UUID(), cc.id, p.id, 'Cost centre client is VST INDUSTRIES LIMITED, VST process holds the metrics', 'migration 2214'
  FROM cost_centre_master cc
  JOIN process_master p ON p.process_code = 'VST'
 WHERE cc.cost_centre_code = 'BSS/OB/Noida/968'
   AND NOT EXISTS (SELECT 1 FROM cost_centre_process_link l WHERE l.cost_centre_id = cc.id AND l.process_id = p.id);
