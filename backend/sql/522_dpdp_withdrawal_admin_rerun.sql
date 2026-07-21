-- Migration 522: Idempotent re-seed for DPDP_WITHDRAWAL_ADMIN page access.
-- Migrations 293/300/301 inserted this entry but may not have run on all
-- environments. This migration is safe to re-run (INSERT IGNORE).

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'DPDP_WITHDRAWAL_ADMIN', 'DPDP Withdrawal Admin',
   '/compliance/dpdp-withdrawal-admin', 'Compliance',
   'Admin console for DPDP Act 2023 consent withdrawal requests', 1, NOW());

-- Grant super_admin full access
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin', 'DPDP_WITHDRAWAL_ADMIN', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',       'DPDP_WITHDRAWAL_ADMIN', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'hr',          'DPDP_WITHDRAWAL_ADMIN', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'dpo',         'DPDP_WITHDRAWAL_ADMIN', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'compliance',  'DPDP_WITHDRAWAL_ADMIN', 1,1,1,0,1, 1, NOW());

INSERT IGNORE INTO schema_migrations (filename, applied_at)
VALUES ('522_dpdp_withdrawal_admin_rerun.sql', NOW());
