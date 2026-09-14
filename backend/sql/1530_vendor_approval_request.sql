-- 1530_vendor_approval_request.sql
-- Adds the vendor_approval_request table so Branch Admins (and Finance Heads who want the
-- trail) can raise a vendor create/update request that a Finance Head reviews before the
-- vendor record is written. Finance Heads can also bypass the queue and create directly.
--
-- payload is the full form payload submitted at raise-time; the reviewer may edit any field
-- before approving, and the approved effective payload is written into vendor_master.
--
-- Additive only. No existing table touched.

CREATE TABLE IF NOT EXISTS vendor_approval_request (
  id            CHAR(36)               NOT NULL DEFAULT (UUID()),
  request_type  ENUM('create','update') NOT NULL,
  vendor_id     CHAR(36)               NULL COMMENT 'NULL for create requests; set for update requests',
  payload       JSON                   NOT NULL,
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  raised_by     CHAR(36)               NOT NULL,
  branch_id     CHAR(36)               NOT NULL,
  raised_at     DATETIME               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by   CHAR(36)               NULL,
  reviewed_at   DATETIME               NULL,
  review_notes  TEXT                   NULL,
  created_at    DATETIME               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME               NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_var_status    (status),
  INDEX idx_var_branch    (branch_id),
  INDEX idx_var_raised_by (raised_by),
  INDEX idx_var_vendor    (vendor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1530_vendor_approval_request.sql applied' AS migration_status;

-- Rollback: DROP TABLE IF EXISTS vendor_approval_request;
