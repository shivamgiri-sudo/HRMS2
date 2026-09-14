-- Migration 1005: Register ATS_ONBOARDING_REQUESTS as a separate page code
-- Previously /ats/onboarding-requests shared ATS_ONBOARDING_BRIDGE which
-- caused disabling the bridge to also kill the onboarding requests page.

-- 1. Register the page catalog entry
INSERT IGNORE INTO workforce_page_catalog
  (page_code, page_name, module, route_path, description, is_active)
VALUES
  ('ATS_ONBOARDING_REQUESTS', 'ATS Onboarding Requests', 'ATS', '/ats/onboarding-requests', 'HR onboarding requests — BGV review and joining docs', 1);

-- 2. Grant same roles as ATS_ONBOARDING_BRIDGE
INSERT IGNORE INTO workforce_role_page_permissions
  (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  ('admin',       'ATS_ONBOARDING_REQUESTS', 1, 1, 1, 0, 1),
  ('super_admin', 'ATS_ONBOARDING_REQUESTS', 1, 1, 1, 1, 1),
  ('hr',          'ATS_ONBOARDING_REQUESTS', 1, 1, 1, 0, 1),
  ('payroll_hr',  'ATS_ONBOARDING_REQUESTS', 1, 1, 0, 0, 0),
  ('recruiter',   'ATS_ONBOARDING_REQUESTS', 1, 1, 1, 0, 1);

-- 3. Propagate to existing user-level page permissions (carry over from BRIDGE grants)
INSERT IGNORE INTO workforce_user_page_permissions
  (user_id, page_code, can_view, can_create, can_edit, can_delete, can_export)
SELECT user_id, 'ATS_ONBOARDING_REQUESTS', can_view, can_create, can_edit, can_delete, can_export
  FROM workforce_user_page_permissions
 WHERE page_code = 'ATS_ONBOARDING_BRIDGE';
