-- 1838: page access for /ops/control-tower.
--
-- Ops Control Tower rolls up 8 branch-wise deliverables (attendance mismatch, roster upload,
-- joining count, F&F pending, NOC pending, DigiLocker pending, eSign pending, appointment
-- letter). It is read-only: no create/edit/delete action lives on the page itself, only
-- drill-down into each block's real records. Route guards it with <Gate pageCode
-- ="OPS_CONTROL_TOWER">; without this grant every role Gate would otherwise admit gets a 403
-- the moment the summary query fires — the same class of gap 1763 fixed for /payroll/noc-cases.
--
-- Additive and idempotent: INSERT IGNORE on both tables, no row updated or deleted.

INSERT IGNORE INTO page_catalog
  (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'OPS_CONTROL_TOWER', 'Ops Control Tower', '/ops/control-tower', 'Operations',
   'Branch-wise rollup of attendance mismatch, roster upload, joining, F&F, NOC, DigiLocker, eSign and appointment-letter pendency', 1, NOW());

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin',        'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'admin',              'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'ceo',                'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'hr',                 'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'hr_admin',           'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'branch_head',        'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'operations_manager', 'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'wfm',                'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'payroll_head',       'OPS_CONTROL_TOWER', 1,0,0,0,0, 1, NOW());

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT page_code, page_path FROM page_catalog WHERE page_code = 'OPS_CONTROL_TOWER';
-- SELECT role_key, can_view FROM role_page_access
--  WHERE page_code = 'OPS_CONTROL_TOWER' ORDER BY role_key;   -- expect 9 rows
