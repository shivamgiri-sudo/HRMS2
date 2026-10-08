-- 2102: page access for the Hiring Engine hub (/ats/hiring-engine). Route is guarded by
-- <Gate pageCode="ATS_HIRING_ENGINE">; without a grant every non-super_admin gets a 403.
-- Additive and idempotent: INSERT IGNORE on both tables.
INSERT IGNORE INTO page_catalog
  (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'ATS_HIRING_ENGINE', 'Hiring Engine', '/ats/hiring-engine', 'ATS',
   'Walk-in hiring engine: unified lead pool, outreach, confirmations, signals and next-best-action', 1, NOW());

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin',    'ATS_HIRING_ENGINE', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'admin',          'ATS_HIRING_ENGINE', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'hr',             'ATS_HIRING_ENGINE', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'hr_admin',       'ATS_HIRING_ENGINE', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'recruitment_hr', 'ATS_HIRING_ENGINE', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'ceo',            'ATS_HIRING_ENGINE', 1,0,0,0,0, 1, NOW());
