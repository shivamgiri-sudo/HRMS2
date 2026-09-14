-- Two live pages have no page_catalog row, so they are invisible AND ungrantable.
--
-- /settings/access-control builds its permission grid from page_catalog. A route whose
-- pageCode has no catalog row therefore never appears there, which means no admin can ever
-- create a role_page_access grant for it — there is no row to tick. Measured live 2026-09-07:
-- both codes below have ZERO grants for any role.
--
-- The pages are not dead. Both are routed and gated:
--   FINANCE_CLIENT_PAYMENTS -> /finance/client-payments (finance.routes.tsx)
--   LMS_MODULE_LAUNCH       -> /lms/module-launch       (performance.routes.tsx)
--
-- Today only super_admin can open them, because canViewPage() short-circuits on isSuperAdmin
-- before it consults the page set. Everyone else is locked out permanently, and the lockout is
-- unfixable from the UI. That is why this needs a migration rather than an admin action.
--
-- Grants deliberately MIRROR each page's nearest sibling rather than inventing a new policy:
--   FINANCE_CLIENT_PAYMENTS  = FINANCE_CLIENT_BILLING's live grants, and the same five roles
--                              its route already declares (clientBillingRoles). Client payments
--                              and client billing are the two halves of one workspace.
--   LMS_MODULE_LAUNCH        = LMS_MY_LEARNING's live grants. The page is an SSO handoff that
--                              launches the signed-in user's own LMS session (useLMSSession),
--                              so its audience is the learner population, not an admin one.
--
-- INSERT IGNORE on both tables, so re-running changes nothing and an existing grant is never
-- overwritten. Purely additive: no existing row is modified.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'FINANCE_CLIENT_PAYMENTS', 'Client Payments', '/finance/client-payments', 'finance', 1),
  (UUID(), 'LMS_MODULE_LAUNCH',       'LMS Module Launch', '/lms/module-launch',     'LMS',     1);

-- FINANCE_CLIENT_PAYMENTS — mirrors FINANCE_CLIENT_BILLING.
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',   'FINANCE_CLIENT_PAYMENTS', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',         'FINANCE_CLIENT_PAYMENTS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_CLIENT_PAYMENTS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance',       'FINANCE_CLIENT_PAYMENTS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_CLIENT_PAYMENTS', 1, 1, 1, 0, 1, 1);

-- LMS_MODULE_LAUNCH — view only. Launching your own LMS session is not a create/edit action,
-- and the LMS enforces its own permissions on the far side of the handoff.
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',        'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'admin',              'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'ceo',                'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'hr',                 'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'employee',           'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'manager',            'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'process_manager',    'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'team_leader',        'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'tl',                 'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'trainer',            'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'qa',                 'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'quality_analyst',    'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'recruiter',          'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'wfm',                'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance',            'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll',            'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll_head',       'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll_hr',         'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'operations_manager', 'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'it',                 'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'it_admin',           'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_it',          'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1);
