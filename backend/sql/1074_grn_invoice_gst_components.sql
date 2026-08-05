-- 1074_grn_invoice_gst_components.sql
-- Adds the data model for the unified vendor-GRN flow: one declared invoice total,
-- broken into repeatable {amount without tax, GST slab} components (the same real
-- invoice frequently carries 2+ GST rates), each component then fanned out across
-- whichever cost-centre budget lines a GRN's cost-centre split targets.
--
-- grn_invoice_component is the source of truth for what the raiser actually typed
-- (M rows per GRN); grn_cost_allocation.invoice_component_id links each existing
-- per-cost-centre allocation row back to the component that drove its GST rate.
-- Additive only, safe to rerun: guarded CREATE TABLE / ADD COLUMN / ADD INDEX / ADD
-- CONSTRAINT, no data touched, no existing column/table altered or dropped.
-- Existing grn_cost_allocation rows (legacy single-line and today's Smart-GRN split
-- GRNs) get invoice_component_id = NULL — every read path must treat NULL as
-- "not part of this flow", never as an error.

CREATE TABLE IF NOT EXISTS grn_invoice_component (
  id CHAR(36) NOT NULL,
  grn_request_id CHAR(36) NOT NULL,
  sequence_no INT NOT NULL,
  amount_without_tax DECIMAL(18,2) NOT NULL,
  gst_rate DECIMAL(7,4) NOT NULL,
  tax_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  amount_with_tax DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  remarks VARCHAR(255) NULL,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grn_invoice_component_seq (grn_request_id, sequence_no),
  INDEX idx_grn_invoice_component_grn (grn_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_invoice_component'
      AND constraint_name = 'fk_grn_invoice_component_grn') = 0,
  'ALTER TABLE grn_invoice_component
     ADD CONSTRAINT fk_grn_invoice_component_grn
     FOREIGN KEY (grn_request_id) REFERENCES grn_request(id)
     ON DELETE CASCADE ON UPDATE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_cost_allocation'
      AND column_name = 'invoice_component_id') = 0,
  'ALTER TABLE grn_cost_allocation ADD COLUMN invoice_component_id CHAR(36) NULL AFTER budget_line_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_cost_allocation'
      AND index_name = 'idx_grn_allocation_component') = 0,
  'ALTER TABLE grn_cost_allocation ADD INDEX idx_grn_allocation_component (invoice_component_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'grn_cost_allocation'
      AND constraint_name = 'fk_grn_allocation_component') = 0,
  'ALTER TABLE grn_cost_allocation
     ADD CONSTRAINT fk_grn_allocation_component
     FOREIGN KEY (invoice_component_id) REFERENCES grn_invoice_component(id)
     ON DELETE SET NULL ON UPDATE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '1074_grn_invoice_gst_components.sql applied' AS migration_status;
