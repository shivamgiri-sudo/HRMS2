-- 1539_exit_pass_exit_verification.sql
--
-- Phase 2 of Asset & Material Exit Pass: security guard exit verification.
-- Adds the columns an 'approved' pass needs to record that the item actually
-- left the building — actual exit timestamp, which gate, who verified it,
-- and how (QR scan vs manual pass-number entry).
--
-- Deliberately NOT here: return verification, overdue tracking, live QR
-- token validation. Status only ever moves 'approved' -> 'exit_verified' in
-- this phase's code — nothing past that.
--
-- Purely additive: 4 nullable columns on an existing table this project
-- itself created in 1538 (not yet live), no other table touched.

ALTER TABLE exit_pass_requests
  ADD COLUMN exit_verified_by CHAR(36) COLLATE utf8mb4_unicode_ci NULL AFTER approved_at,
  ADD COLUMN exit_verified_at DATETIME NULL AFTER exit_verified_by,
  ADD COLUMN exit_gate VARCHAR(60) NULL AFTER exit_verified_at,
  ADD COLUMN exit_verification_method ENUM('qr','manual') NULL AFTER exit_gate,
  ADD CONSTRAINT exit_pass_requests_ibfk_exit_verifier FOREIGN KEY (exit_verified_by) REFERENCES employees(id),
  ADD INDEX idx_epr_exit_verified (exit_verified_at);

-- Security → Gate Pass Verification page. No dedicated 'security' role_key
-- exists live (checked user_roles 2026-08-21) — grants reuse the role keys
-- Visitor Management already assigns to physical-security staff.
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'ASSET_EXIT_PASS_VERIFY',
  'Exit Pass Verification',
  '/security/exit-pass-verify',
  'it_admin',
  'Security gate screen: enter/scan a Gate Pass number, see VALID/ALREADY USED/INVALID, and record the actual exit.',
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
  (UUID(), 'super_admin',     'ASSET_EXIT_PASS_VERIFY', 1, 1, 0, 0, 0, 1),
  (UUID(), 'admin',           'ASSET_EXIT_PASS_VERIFY', 1, 1, 0, 0, 0, 1),
  (UUID(), 'it_head',         'ASSET_EXIT_PASS_VERIFY', 1, 1, 0, 0, 0, 1),
  (UUID(), 'branch_admin',    'ASSET_EXIT_PASS_VERIFY', 1, 1, 0, 0, 0, 1),
  (UUID(), 'security_head',   'ASSET_EXIT_PASS_VERIFY', 1, 1, 0, 0, 0, 1),
  (UUID(), 'visitor_security','ASSET_EXIT_PASS_VERIFY', 1, 1, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1539_exit_pass_exit_verification.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'ASSET_EXIT_PASS_VERIFY';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'ASSET_EXIT_PASS_VERIFY';
--   ALTER TABLE exit_pass_requests DROP FOREIGN KEY exit_pass_requests_ibfk_exit_verifier;
--   ALTER TABLE exit_pass_requests DROP INDEX idx_epr_exit_verified;
--   ALTER TABLE exit_pass_requests
--     DROP COLUMN exit_verified_by, DROP COLUMN exit_verified_at,
--     DROP COLUMN exit_gate, DROP COLUMN exit_verification_method;
