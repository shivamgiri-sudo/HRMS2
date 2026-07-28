-- Branch WFM SPOC configuration
-- Maps primary and backup WFM SPOCs to branches for attendance regularization final approval.

CREATE TABLE IF NOT EXISTS branch_wfm_spoc_config (
  id                    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  branch_id             CHAR(36) NOT NULL,
  primary_spoc_user_id  CHAR(36) NOT NULL,
  backup_spoc_user_id   CHAR(36) NULL,
  effective_from        DATE NOT NULL,
  effective_to          DATE NULL,
  is_active             TINYINT(1) NOT NULL DEFAULT 1,
  created_by            CHAR(36) NOT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_bwsc_branch (branch_id),
  INDEX idx_bwsc_primary (primary_spoc_user_id),
  INDEX idx_bwsc_active (branch_id, is_active, effective_from, effective_to),
  CONSTRAINT fk_bwsc_branch   FOREIGN KEY (branch_id)            REFERENCES branch_master (id),
  CONSTRAINT fk_bwsc_primary  FOREIGN KEY (primary_spoc_user_id) REFERENCES employees (id),
  CONSTRAINT fk_bwsc_backup   FOREIGN KEY (backup_spoc_user_id)  REFERENCES employees (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
