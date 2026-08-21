-- 1538_asset_material_exit_pass.sql
--
-- Phase 1 of the Asset & Material Exit Pass module (IT & Admin):
--   Raise request -> Branch Head approval -> Admin approval -> printable pass.
-- Explicitly OUT of scope for this migration (later phases): security guard
-- exit/return verification, QR live validation, overdue tracking, exports,
-- notifications, loss/damage recovery. See exit_pass_requests.status comment
-- for the full state list this phase actually drives.
--
-- Purely additive: 4 new tables, no existing table touched. FKs to
-- employees(id) / branch_master(id) use CHAR(36) COLLATE utf8mb4_unicode_ci
-- to match those columns' live collation (verified 2026-08-21, same trap
-- called out in 1500_wfm_roster_import_engine.sql / 1536).

CREATE TABLE IF NOT EXISTS exit_pass_requests (
  id                        CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  -- NULL until admin approval assigns it (format GP-{branch_code}-{year}-{seq}).
  pass_number               VARCHAR(40) NULL UNIQUE,

  requestor_employee_id     CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  request_department        ENUM('IT','ADMIN') NOT NULL,
  branch_id                 CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,

  movement_type              ENUM('returnable','non_returnable') NOT NULL,
  priority                    ENUM('normal','urgent','emergency') NOT NULL DEFAULT 'normal',
  purpose_code                 VARCHAR(60) NOT NULL,
  purpose_details               TEXT NOT NULL,

  destination_type                VARCHAR(40) NOT NULL,
  destination_name                 VARCHAR(200) NULL,
  destination_address              TEXT NULL,
  destination_branch_id            CHAR(36) COLLATE utf8mb4_unicode_ci NULL,

  carrier_type                ENUM('employee','vendor','courier','driver','other') NOT NULL DEFAULT 'employee',
  carrier_employee_id         CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
  carrier_name                 VARCHAR(150) NULL,
  carrier_mobile                VARCHAR(20) NULL,
  carrier_company                VARCHAR(150) NULL,
  vehicle_number                  VARCHAR(30) NULL,

  planned_exit_at              DATETIME NOT NULL,
  expected_return_at           DATETIME NULL,
  return_responsible_employee_id CHAR(36) COLLATE utf8mb4_unicode_ci NULL,

  -- Phase-1 state machine. Later phases add: ready_for_exit, exit_verified,
  -- outside_premises, return_due, overdue, return_verification_pending,
  -- returned, closed, void — none of those are set by this migration's code.
  status                    VARCHAR(40) NOT NULL DEFAULT 'draft',

  branch_head_employee_id   CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
  admin_employee_id         CHAR(36) COLLATE utf8mb4_unicode_ci NULL,

  submitted_at              DATETIME NULL,
  branch_head_decided_at    DATETIME NULL,
  admin_decided_at          DATETIME NULL,
  approved_at               DATETIME NULL,

  created_by                CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT exit_pass_requests_ibfk_requestor FOREIGN KEY (requestor_employee_id) REFERENCES employees(id),
  CONSTRAINT exit_pass_requests_ibfk_branch FOREIGN KEY (branch_id) REFERENCES branch_master(id),
  CONSTRAINT exit_pass_requests_ibfk_dest_branch FOREIGN KEY (destination_branch_id) REFERENCES branch_master(id),
  CONSTRAINT exit_pass_requests_ibfk_carrier_emp FOREIGN KEY (carrier_employee_id) REFERENCES employees(id),
  CONSTRAINT exit_pass_requests_ibfk_return_resp FOREIGN KEY (return_responsible_employee_id) REFERENCES employees(id),
  CONSTRAINT exit_pass_requests_ibfk_bh FOREIGN KEY (branch_head_employee_id) REFERENCES employees(id),
  CONSTRAINT exit_pass_requests_ibfk_admin FOREIGN KEY (admin_employee_id) REFERENCES employees(id),
  CONSTRAINT exit_pass_requests_ibfk_creator FOREIGN KEY (created_by) REFERENCES employees(id),

  INDEX idx_epr_branch_status (branch_id, status),
  INDEX idx_epr_requestor (requestor_employee_id),
  INDEX idx_epr_branch_head (branch_head_employee_id, status),
  INDEX idx_epr_admin (admin_employee_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS exit_pass_items (
  id             CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  exit_pass_id   CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,

  -- Free-text tag for phase 1 — Asset Master lookup/validation (spec §12) is a
  -- later phase; is_tagged just records whether the requestor claimed one.
  asset_id       VARCHAR(60) NULL,
  is_tagged      TINYINT(1) NOT NULL DEFAULT 0,

  category       VARCHAR(60) NOT NULL,
  item_name      VARCHAR(150) NOT NULL,
  serial_number  VARCHAR(100) NULL,
  make_model     VARCHAR(150) NULL,
  quantity       INT NOT NULL DEFAULT 1,
  unit           VARCHAR(20) NOT NULL DEFAULT 'Nos',
  condition_out  VARCHAR(40) NULL,
  -- Set by the return-verification phase, not phase 1.
  condition_in   VARCHAR(40) NULL,
  remarks        VARCHAR(255) NULL,

  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT exit_pass_items_ibfk_pass FOREIGN KEY (exit_pass_id) REFERENCES exit_pass_requests(id) ON DELETE CASCADE,
  INDEX idx_epi_pass (exit_pass_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per decision. A request can cycle through this more than once if
-- Branch Head "returns for correction" and the requestor resubmits.
CREATE TABLE IF NOT EXISTS exit_pass_approvals (
  id                    CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  exit_pass_id          CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  stage                 ENUM('branch_head','admin') NOT NULL,
  approver_employee_id  CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  decision               ENUM('approved','rejected','returned') NOT NULL,
  remarks                TEXT NULL,
  decided_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT exit_pass_approvals_ibfk_pass FOREIGN KEY (exit_pass_id) REFERENCES exit_pass_requests(id) ON DELETE CASCADE,
  CONSTRAINT exit_pass_approvals_ibfk_approver FOREIGN KEY (approver_employee_id) REFERENCES employees(id),
  INDEX idx_epa_pass (exit_pass_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Immutable timeline. No UPDATE/DELETE path is exposed anywhere in the
-- service layer — append-only by construction, matching the project's
-- "no audit entry should be editable" rule (spec §29).
CREATE TABLE IF NOT EXISTS exit_pass_audit_logs (
  id                  CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL PRIMARY KEY,
  exit_pass_id        CHAR(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  actor_employee_id   CHAR(36) COLLATE utf8mb4_unicode_ci NULL,
  action              VARCHAR(60) NOT NULL,
  old_status          VARCHAR(40) NULL,
  new_status          VARCHAR(40) NULL,
  remarks             TEXT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT exit_pass_audit_logs_ibfk_pass FOREIGN KEY (exit_pass_id) REFERENCES exit_pass_requests(id) ON DELETE CASCADE,
  INDEX idx_epal_pass (exit_pass_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Page registration + RBAC, same pattern as 1532_finance_masters_page_access.sql.
-- Roles taken from live user_roles.role_key values (verified 2026-08-21): 'it'
-- and 'it_head' exist alongside 'admin'/'branch_admin'/'branch_head', so the
-- gate is not stretched onto a role that doesn't exist in production.
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'ASSET_EXIT_PASS',
  'Asset & Material Exit Pass',
  '/it-admin/exit-pass',
  'it_admin',
  'Raise, approve and print Asset/Material Exit Gate Passes. Phase 1: create through admin approval and print; guard verification and return tracking are later phases.',
  1
)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',  'ASSET_EXIT_PASS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'admin',        'ASSET_EXIT_PASS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'it_head',      'ASSET_EXIT_PASS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'it',           'ASSET_EXIT_PASS', 1, 1, 0, 0, 0, 1),
  (UUID(), 'branch_admin', 'ASSET_EXIT_PASS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'branch_head',  'ASSET_EXIT_PASS', 1, 1, 0, 0, 0, 1),
  (UUID(), 'wfm',          'ASSET_EXIT_PASS', 1, 1, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1538_asset_material_exit_pass.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'ASSET_EXIT_PASS';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'ASSET_EXIT_PASS';
--   DROP TABLE IF EXISTS exit_pass_audit_logs;
--   DROP TABLE IF EXISTS exit_pass_approvals;
--   DROP TABLE IF EXISTS exit_pass_items;
--   DROP TABLE IF EXISTS exit_pass_requests;
