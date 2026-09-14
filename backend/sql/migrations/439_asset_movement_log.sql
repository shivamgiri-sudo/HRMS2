-- Migration 439: Create asset_movement_log table
-- Required by the asset-movement-log report (assets.executor.ts)
-- Records custody transfers, location moves, and assignment changes for assets.
--
-- Run ONLY on local/staging first; get explicit approval before production.

CREATE TABLE IF NOT EXISTS asset_movement_log (
  id               CHAR(36)       NOT NULL DEFAULT (UUID()),
  asset_id         CHAR(36)       NOT NULL,
  movement_type    VARCHAR(50)    NOT NULL COMMENT 'issue|return|transfer|maintenance|retirement|loss',
  movement_date    DATE           NOT NULL,
  from_location    VARCHAR(255)   NULL,
  to_location      VARCHAR(255)   NULL,
  employee_id      CHAR(36)       NULL COMMENT 'employee receiving or returning the asset; null for location-only moves',
  moved_by         VARCHAR(255)   NULL COMMENT 'name or employee_code of person who performed the move',
  remarks          TEXT           NULL,
  created_by       CHAR(36)       NULL,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_aml_asset      (asset_id),
  KEY idx_aml_employee   (employee_id),
  KEY idx_aml_date       (movement_date),
  KEY idx_aml_type_date  (movement_type, movement_date),

  CONSTRAINT fk_aml_asset    FOREIGN KEY (asset_id)    REFERENCES asset_master (id) ON DELETE RESTRICT,
  CONSTRAINT fk_aml_employee FOREIGN KEY (employee_id) REFERENCES employees    (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
