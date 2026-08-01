-- Cost Centre Extended Schema
-- Adds comprehensive fields from db_bill.cost_master to mas_hrms.cost_centre_master
-- Plus approval workflow tables

-- ============================================================================
-- 1. Extend cost_centre_master with new columns (using stored procedure for safety)
-- ============================================================================

DROP PROCEDURE IF EXISTS add_column_if_not_exists;

DELIMITER //
CREATE PROCEDURE add_column_if_not_exists(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_definition VARCHAR(512)
)
BEGIN
  SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = p_table AND column_name = p_column
  );
  IF @col_exists = 0 THEN
    SET @sql = CONCAT('ALTER TABLE ', p_table, ' ADD COLUMN ', p_column, ' ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- Status lifecycle
CALL add_column_if_not_exists('cost_centre_master', 'status', "ENUM('draft','pending_l1','pending_l2','approved','active','closed','rejected','revision_required') NOT NULL DEFAULT 'draft'");

-- Approval tracking
CALL add_column_if_not_exists('cost_centre_master', 'submitted_by', 'CHAR(36) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'submitted_at', 'DATETIME NULL');
CALL add_column_if_not_exists('cost_centre_master', 'l1_approved_by', 'CHAR(36) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'l1_approved_at', 'DATETIME NULL');
CALL add_column_if_not_exists('cost_centre_master', 'l2_approved_by', 'CHAR(36) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'l2_approved_at', 'DATETIME NULL');
CALL add_column_if_not_exists('cost_centre_master', 'rejection_reason', 'TEXT NULL');
CALL add_column_if_not_exists('cost_centre_master', 'revision_no', 'INT NOT NULL DEFAULT 1');
CALL add_column_if_not_exists('cost_centre_master', 'created_by', 'CHAR(36) NULL');

-- Operational parameters
CALL add_column_if_not_exists('cost_centre_master', 'mandated_seats_value', 'INT NULL');
CALL add_column_if_not_exists('cost_centre_master', 'shrinkage_percentage', 'DECIMAL(5,2) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'attrition_percentage', 'DECIMAL(5,2) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'shift_hours', 'VARCHAR(50) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'working_days_per_week', 'INT NULL');
CALL add_column_if_not_exists('cost_centre_master', 'training_days', 'INT NULL');
CALL add_column_if_not_exists('cost_centre_master', 'incentive_allowed', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL add_column_if_not_exists('cost_centre_master', 'deduction_allowed', 'TINYINT(1) NOT NULL DEFAULT 0');

-- Billing configuration
CALL add_column_if_not_exists('cost_centre_master', 'revenue_flag', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL add_column_if_not_exists('cost_centre_master', 'billing_flag', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL add_column_if_not_exists('cost_centre_master', 'revenue_type', 'VARCHAR(50) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'fixed_amount', 'DECIMAL(18,2) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'variable_base', 'VARCHAR(100) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'payment_mode', 'VARCHAR(50) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'payment_terms', 'VARCHAR(100) NULL');

-- GST/Tax information
CALL add_column_if_not_exists('cost_centre_master', 'hsn_code', 'VARCHAR(20) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'service_tax_no', 'VARCHAR(50) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'vendor_state_code', 'VARCHAR(10) NULL');

-- Bill-to address
CALL add_column_if_not_exists('cost_centre_master', 'bill_to_address1', 'VARCHAR(255) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'bill_to_address2', 'VARCHAR(255) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'bill_to_address3', 'VARCHAR(255) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'bill_to_city', 'VARCHAR(100) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'bill_to_pincode', 'VARCHAR(20) NULL');

-- Ship-to address
CALL add_column_if_not_exists('cost_centre_master', 'ship_to_address1', 'VARCHAR(255) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'ship_to_address2', 'VARCHAR(255) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'ship_to_address3', 'VARCHAR(255) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'ship_to_city', 'VARCHAR(100) NULL');
CALL add_column_if_not_exists('cost_centre_master', 'ship_to_pincode', 'VARCHAR(20) NULL');

-- Association date
CALL add_column_if_not_exists('cost_centre_master', 'association_date', 'DATE NULL');

-- Cleanup helper procedure
DROP PROCEDURE IF EXISTS add_column_if_not_exists;

-- ============================================================================
-- 2. Cost Centre Contacts table (3 contact types × 3 contacts each)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cost_centre_contacts (
  id CHAR(36) PRIMARY KEY,
  cost_centre_id CHAR(36) NOT NULL,
  contact_type ENUM('client','scm','finance') NOT NULL,
  contact_sequence INT NOT NULL DEFAULT 1,
  contact_name VARCHAR(200) NULL,
  contact_email VARCHAR(255) NULL,
  contact_phone VARCHAR(50) NULL,
  contact_designation VARCHAR(100) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_cc_contact_centre FOREIGN KEY (cost_centre_id)
    REFERENCES cost_centre_master(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cc_contact (cost_centre_id, contact_type, contact_sequence),
  INDEX idx_cc_contacts_centre (cost_centre_id),
  INDEX idx_cc_contacts_type (contact_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. Cost Centre Approval Log table (audit trail)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cost_centre_approval_log (
  id CHAR(36) PRIMARY KEY,
  cost_centre_id CHAR(36) NOT NULL,
  action VARCHAR(80) NOT NULL,
  from_status VARCHAR(60) NULL,
  to_status VARCHAR(60) NOT NULL,
  actor_user_id CHAR(36) NOT NULL,
  actor_role VARCHAR(80) NOT NULL,
  remarks TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_cc_approval_centre FOREIGN KEY (cost_centre_id)
    REFERENCES cost_centre_master(id) ON DELETE CASCADE,
  INDEX idx_cc_approval_centre (cost_centre_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 4. Set existing records to 'active' status (backward compatibility)
-- ============================================================================

UPDATE cost_centre_master
SET status = 'active'
WHERE status = 'draft' AND active_status = 1 AND created_at < NOW();
