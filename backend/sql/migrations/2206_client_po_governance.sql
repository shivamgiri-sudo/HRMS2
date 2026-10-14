-- Client PO governance + invoice line order (owner feedback 2026-10-14, client billing items 8-13).
-- ADDITIVE ONLY: one new table per concern, nullable columns; no existing row is changed.
--   * client_po_number gains the PO document (attachment_*: a PDF / Word copy is required on every
--     new PO), remarks, created_by / updated_by / updated_at.
--   * client_po_line: the PO's particulars with qty x rate; the PO amount is their sum. POs created
--     before this migration have no lines and keep their typed amount.
--   * client_po_audit: every PO create / edit with the before -> after values.
--   * client_invoice_line.line_no: the order particulars were entered in (rows were read back in
--     random UUID order). NULL on existing rows; readers order by line_no, then created_at, id.
-- Rollback (manual): DROP TABLE client_po_audit, client_po_line;
--   ALTER TABLE client_po_number DROP COLUMN attachment_path, DROP COLUMN attachment_name,
--     DROP COLUMN attachment_mime, DROP COLUMN remarks, DROP COLUMN created_by, DROP COLUMN updated_by;
--   ALTER TABLE client_invoice_line DROP COLUMN line_no;

CREATE TABLE IF NOT EXISTS client_po_line (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  po_id        CHAR(36)      NOT NULL,
  line_no      INT           NOT NULL,
  particulars  VARCHAR(255)  NOT NULL,
  qty          DECIMAL(14,2) NOT NULL,
  rate         DECIMAL(14,2) NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cpl_po (po_id, line_no),
  CONSTRAINT fk_cpl_po FOREIGN KEY (po_id) REFERENCES client_po_number(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_po_audit (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  po_id       CHAR(36)      NOT NULL,
  action      VARCHAR(30)   NOT NULL,
  actor_id    CHAR(36)      NULL,
  changes     VARCHAR(2000) NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_cpa_po (po_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @add_cpn_governance = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_po_number') = 1,
    "ALTER TABLE client_po_number ADD COLUMN attachment_path VARCHAR(500) NULL, ADD COLUMN attachment_name VARCHAR(255) NULL, ADD COLUMN attachment_mime VARCHAR(100) NULL, ADD COLUMN remarks VARCHAR(500) NULL, ADD COLUMN created_by CHAR(36) NULL, ADD COLUMN updated_by CHAR(36) NULL",
    'SELECT 1 -- client_po_number governance columns already exist (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_po_number' AND COLUMN_NAME = 'attachment_path'
);
PREPARE _stmt FROM @add_cpn_governance;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_cil_line_no = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_line') = 1,
    "ALTER TABLE client_invoice_line ADD COLUMN line_no INT NULL",
    'SELECT 1 -- client_invoice_line.line_no already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_line' AND COLUMN_NAME = 'line_no'
);
PREPARE _stmt FROM @add_cil_line_no;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
