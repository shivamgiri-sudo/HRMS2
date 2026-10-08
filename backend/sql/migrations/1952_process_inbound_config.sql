-- Migration 1952: process_inbound_config -- the dialer source of a support/inbound process, so a NEW support process gets the rich
-- inbound dashboard (/api/inbound-insights) without a code change. One row per process: which dialer cdr_in_* table, which pattern
-- (A = IVR routing with HOLDTIME rows, B = plain), which campaigns, mandate / required headcount and the service-level threshold.
-- Read by the shared loader backend/src/modules/call-master/inbound-projects.ts (DB row wins over the static fallback list there).
-- The dialer table name is NEVER trusted from this column alone: the loader re-checks it against ^cdr_in_[0-9]+(_[0-9]+)*$ and the
-- dialer database's information_schema before any SQL is built.
--
-- ADDITIVE ONLY: one new table, plus INSERT IGNORE seeds for the hard-coded inbound projects, each only when a process_master row with the
-- EXACT matching process_code exists (process_code is UNIQUE, so the match is unambiguous). Processes with no such row keep using the
-- static list in code. Idempotent: re-running changes nothing.

-- No foreign key to process_master, deliberately: creating one takes a metadata lock on that very busy table, and on
-- 2026-09-30 that wait timed out at startup (Lock wait timeout exceeded), blocked the boot and rolled the deploy back.
-- process_id is still indexed; rows of a deleted process are simply never read.
CREATE TABLE IF NOT EXISTS process_inbound_config (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  process_id       CHAR(36)     NOT NULL,
  project_key      VARCHAR(40)  NOT NULL,
  dialer_table     VARCHAR(64)  NOT NULL,
  pattern          ENUM('A','B') NOT NULL DEFAULT 'B',
  campaigns        JSON         NOT NULL,
  mandate          INT          NOT NULL DEFAULT 0,
  required         INT          NOT NULL DEFAULT 0,
  has_fcr          TINYINT(1)   NOT NULL DEFAULT 0,
  fcr_client_id    INT              NULL,
  sl_seconds       INT              NULL,
  enabled          TINYINT(1)   NOT NULL DEFAULT 1,
  configured_by    CHAR(36)         NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pic_process (process_id),
  UNIQUE KEY uq_pic_project_key (project_key),
  KEY idx_pic_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled)
SELECT UUID(), pm.id, 'gnc', 'cdr_in_4', 'A', JSON_ARRAY('GNC_Order_Related', 'GNC_Product_Quality', 'GNC_Other_Queries', 'GNC_Product_Info', 'GNC_Offer_Order', 'GNC_Authentication'), 8, 6, 0, NULL, NULL, 1
  FROM process_master pm
 WHERE pm.process_code = 'GNC'
   AND NOT EXISTS (SELECT 1 FROM process_inbound_config x WHERE x.process_id = pm.id OR x.project_key = 'gnc');

INSERT IGNORE INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled)
SELECT UUID(), pm.id, 'bellavita', 'cdr_in_11_5', 'A', JSON_ARRAY('H_Bellavita_Luxury', 'E_Bellavita_Organic', 'E_Bellavita_Luxury', 'H_Bellavita_Organic', 'H_Bevzilla_Complaint', 'H_Bevzilla_CC_Agent', 'E_Bevzilla_CC_Agent', 'H_Bevzilla_Order', 'E_Bevzilla_Order', 'E_Bevzilla_Complaint', 'E_Emb_Existing_Order', 'H_Bevzilla_Product', 'H_Emb_New_Order', 'H_Emb_Existing_Order', 'E_Bevzilla_Product', 'E_Emb_New_Order'), 14, 12, 0, NULL, NULL, 1
  FROM process_master pm
 WHERE pm.process_code = 'BELLAVITA'
   AND NOT EXISTS (SELECT 1 FROM process_inbound_config x WHERE x.process_id = pm.id OR x.project_key = 'bellavita');

INSERT IGNORE INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled)
SELECT UUID(), pm.id, 'clovia', 'cdr_in_250', 'A', JSON_ARRAY('Clovia_English', 'Clovia_Hindi'), 7, 6, 0, NULL, NULL, 1
  FROM process_master pm
 WHERE pm.process_code = 'CLOVIA'
   AND NOT EXISTS (SELECT 1 FROM process_inbound_config x WHERE x.process_id = pm.id OR x.project_key = 'clovia');

INSERT IGNORE INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled)
SELECT UUID(), pm.id, 'neemans', 'cdr_in_249', 'B', JSON_ARRAY('Neemans_IB'), 10, 10, 1, 475, NULL, 1
  FROM process_master pm
 WHERE pm.process_code = 'NEEMANS'
   AND NOT EXISTS (SELECT 1 FROM process_inbound_config x WHERE x.process_id = pm.id OR x.project_key = 'neemans');

INSERT IGNORE INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled)
SELECT UUID(), pm.id, 'viega', 'cdr_in_249', 'B', JSON_ARRAY('Viega'), 2, 2, 0, NULL, NULL, 1
  FROM process_master pm
 WHERE pm.process_code = 'VIEGA'
   AND NOT EXISTS (SELECT 1 FROM process_inbound_config x WHERE x.process_id = pm.id OR x.project_key = 'viega');

INSERT IGNORE INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled)
SELECT UUID(), pm.id, 'exicom', 'cdr_in_9', 'B', JSON_ARRAY('Exicom_TC_Battery', 'Exicom_EV_Battery', 'EV_Charger833'), 5, 5, 0, NULL, NULL, 1
  FROM process_master pm
 WHERE pm.process_code = 'EXICOM'
   AND NOT EXISTS (SELECT 1 FROM process_inbound_config x WHERE x.process_id = pm.id OR x.project_key = 'exicom');

INSERT IGNORE INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled)
SELECT UUID(), pm.id, 'dubangladesh', 'cdr_in_4', 'B', JSON_ARRAY('DU_Bangladesh_Bangla', 'DU_Bangladesh_Eng', 'DU_Bangladesh_Hindi'), 3, 3, 0, NULL, NULL, 1
  FROM process_master pm
 WHERE pm.process_code = 'DUBANGLADESH'
   AND NOT EXISTS (SELECT 1 FROM process_inbound_config x WHERE x.process_id = pm.id OR x.project_key = 'dubangladesh');

INSERT IGNORE INTO process_inbound_config (id, process_id, project_key, dialer_table, pattern, campaigns, mandate, required, has_fcr, fcr_client_id, sl_seconds, enabled)
SELECT UUID(), pm.id, 'dalmia', 'cdr_in_249', 'B', JSON_ARRAY('Dalmia_Hindi', 'Dalmia_English', 'Dalmia_Kannada', 'Dalmia_Tamil', 'Dalmia_Bengoli', 'Dalmia_Malayalam', 'Dalmia_Odiya', 'Dalmia_Marathi', 'Dalmia_Telugu', 'Dalmia_Assamese'), 9, 9, 0, NULL, NULL, 1
  FROM process_master pm
 WHERE pm.process_code = 'DALMIA'
   AND NOT EXISTS (SELECT 1 FROM process_inbound_config x WHERE x.process_id = pm.id OR x.project_key = 'dalmia');
