-- Pages that are mounted and role-gated but were never listed in page_catalog, so they never appeared under
-- My Modules. Each row lists the page for exactly the roles its route already admits (the route's own roles
-- guard), so nothing is opened up: it only becomes discoverable. Idempotent - inserts only what is missing, and only for roles that exist in workforce_role_catalog (an unknown role is skipped, not an error).

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'DOCUMENT_TEMPLATES', 'Document Templates', '/settings/document-templates', 'Settings', 'Manage the letter and document templates', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'DOCUMENT_TEMPLATES');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'DOCUMENT_TEMPLATES', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'DOCUMENT_TEMPLATES');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'DOCUMENT_TEMPLATES', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'DOCUMENT_TEMPLATES');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'DOCUMENT_TEMPLATES', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'DOCUMENT_TEMPLATES');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'EMPLOYEE_REACTIVATION', 'Employee Reactivation', '/employees/reactivation', 'HR', 'Reactivate a former employee', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'EMPLOYEE_REACTIVATION');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'EMPLOYEE_REACTIVATION', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'EMPLOYEE_REACTIVATION');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'EMPLOYEE_REACTIVATION', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'EMPLOYEE_REACTIVATION');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'EMPLOYEE_REACTIVATION', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'EMPLOYEE_REACTIVATION');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'EMPLOYEE_REACTIVATION', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'branch_head'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'EMPLOYEE_REACTIVATION');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'EMPLOYEE_REACTIVATION', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'payroll_head'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'EMPLOYEE_REACTIVATION');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'STATUTORY_CHANGE_APPROVALS', 'Statutory Change Approvals', '/statutory-change-approvals', 'Compliance', 'Approve changes to statutory details', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'STATUTORY_CHANGE_APPROVALS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'STATUTORY_CHANGE_APPROVALS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'STATUTORY_CHANGE_APPROVALS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'STATUTORY_CHANGE_APPROVALS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'STATUTORY_CHANGE_APPROVALS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'STATUTORY_CHANGE_APPROVALS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'STATUTORY_CHANGE_APPROVALS');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'CLIENT_PORTAL_ACCESS', 'Client Portal Access', '/super-admin/client-portal-access', 'Admin', 'Grant clients access to their process', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'CLIENT_PORTAL_ACCESS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'CLIENT_PORTAL_ACCESS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'CLIENT_PORTAL_ACCESS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'CLIENT_PORTAL_ACCESS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'CLIENT_PORTAL_ACCESS');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'PORTAL_CONTENT_ADMIN', 'Portal Content Admin', '/portal/content-admin', 'Admin', 'Manage content shown on the portal', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'PORTAL_CONTENT_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'PORTAL_CONTENT_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'PORTAL_CONTENT_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'PORTAL_CONTENT_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'PORTAL_CONTENT_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'PORTAL_CONTENT_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'finance_head'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'PORTAL_CONTENT_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'PORTAL_CONTENT_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'operations_manager'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'PORTAL_CONTENT_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'PORTAL_CONTENT_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'ceo'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'PORTAL_CONTENT_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'PORTAL_CONTENT_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'PORTAL_CONTENT_ADMIN');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'COMPANY_FEED_CREATORS', 'Company Feed Creators', '/super-admin/company-feed-creators', 'Engagement', 'Choose who can post to the company feed', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'COMPANY_FEED_CREATORS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'COMPANY_FEED_CREATORS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'COMPANY_FEED_CREATORS');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'LIVE_LOCATION_ADMIN', 'Live Location', '/super-admin/live-location', 'Admin', 'Live location of field staff', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'LIVE_LOCATION_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'LIVE_LOCATION_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'LIVE_LOCATION_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'LIVE_LOCATION_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'branch_head'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'LIVE_LOCATION_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'LIVE_LOCATION_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'LIVE_LOCATION_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'LIVE_LOCATION_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'operations_manager'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'LIVE_LOCATION_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'LIVE_LOCATION_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'process_manager'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'LIVE_LOCATION_ADMIN');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'AI_PROVIDER_SETTINGS', 'AI Providers', '/settings/ai-providers', 'Settings', 'Configure the AI providers', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'AI_PROVIDER_SETTINGS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'AI_PROVIDER_SETTINGS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'AI_PROVIDER_SETTINGS');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'MIRA_COMPLAINTS', 'Mira Complaints', '/admin/mira-complaints', 'Admin', 'Review complaints raised through Mira', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'MIRA_COMPLAINTS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'MIRA_COMPLAINTS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'MIRA_COMPLAINTS');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'COMPANY_FEED_APPROVALS', 'Company Feed Approvals', '/engagement/company-feed/approvals', 'Engagement', 'Approve company feed posts', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'COMPANY_FEED_APPROVALS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'COMPANY_FEED_APPROVALS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr_head'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'COMPANY_FEED_APPROVALS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'COMPANY_FEED_APPROVALS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'COMPANY_FEED_APPROVALS');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'COMPANY_FEED_APPROVALS', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'COMPANY_FEED_APPROVALS');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'COMPANY_FEED_MANAGE', 'Company Feed Manage', '/engagement/company-feed/manage', 'Engagement', 'Manage company feed posts', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'COMPANY_FEED_MANAGE');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'COMPANY_FEED_MANAGE', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr_head'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'COMPANY_FEED_MANAGE');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'COMPANY_FEED_MANAGE', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'COMPANY_FEED_MANAGE');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'COMPANY_FEED_MANAGE', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'COMPANY_FEED_MANAGE');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'SOCIAL_FEED_ADMIN', 'Social Feed Admin', '/social-feed/admin', 'Engagement', 'Moderate the social feed', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'SOCIAL_FEED_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'SOCIAL_FEED_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'SOCIAL_FEED_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'SOCIAL_FEED_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'SOCIAL_FEED_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'SOCIAL_FEED_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'SOCIAL_FEED_ADMIN');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'ATS_BGV_API_MONITOR', 'BGV API Monitor', '/ats/bgv-api-monitor', 'ATS', 'Monitor background verification API calls', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'ATS_BGV_API_MONITOR');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_BGV_API_MONITOR', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_BGV_API_MONITOR');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_BGV_API_MONITOR', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_BGV_API_MONITOR');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_BGV_API_MONITOR', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_BGV_API_MONITOR');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'ATS_RECONCILIATION', 'ATS Reconciliation', '/ats/reconciliation', 'ATS', 'Reconcile ATS records', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'ATS_RECONCILIATION');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_RECONCILIATION', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_RECONCILIATION');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_RECONCILIATION', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_RECONCILIATION');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_RECONCILIATION', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_RECONCILIATION');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'ATS_FORM_CONFIG', 'ATS Form Configuration', '/ats/form-config', 'ATS', 'Configure the candidate registration form', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'ATS_FORM_CONFIG');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_FORM_CONFIG', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_FORM_CONFIG');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_FORM_CONFIG', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_FORM_CONFIG');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'ATS_FORM_CONFIG', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'ATS_FORM_CONFIG');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'IJP_ADMIN', 'IJP Postings (HR)', '/recruitment/ijp', 'ATS', 'Publish and review internal job postings', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'IJP_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'IJP_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'IJP_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'IJP_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'IJP_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'IJP_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'IJP_ADMIN');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'IJP_ADMIN', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'recruitment_hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'IJP_ADMIN');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'WFM_REST_POLICY', 'Rest Policy', '/wfm/rest-policy', 'WFM', 'Minimum rest between shifts', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'WFM_REST_POLICY');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_REST_POLICY', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_REST_POLICY');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_REST_POLICY', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_REST_POLICY');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_REST_POLICY', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'wfm'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_REST_POLICY');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_REST_POLICY', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_REST_POLICY');

INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
SELECT UUID(), 'WFM_WEEK_OFF_DEFAULT', 'Week-off Default', '/wfm/week-off-default', 'WFM', 'Default weekly off pattern', 1
 WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'WFM_WEEK_OFF_DEFAULT');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_WEEK_OFF_DEFAULT', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'super_admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_WEEK_OFF_DEFAULT');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_WEEK_OFF_DEFAULT', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'admin'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_WEEK_OFF_DEFAULT');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_WEEK_OFF_DEFAULT', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'wfm'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_WEEK_OFF_DEFAULT');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_WEEK_OFF_DEFAULT', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'hr'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_WEEK_OFF_DEFAULT');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), k.role_key, 'WFM_WEEK_OFF_DEFAULT', 1, 0, 0, 0, 0, 1
  FROM workforce_role_catalog k
 WHERE k.role_key = 'manager'
   AND NOT EXISTS (SELECT 1 FROM role_page_access x WHERE x.role_key = k.role_key AND x.page_code = 'WFM_WEEK_OFF_DEFAULT');
