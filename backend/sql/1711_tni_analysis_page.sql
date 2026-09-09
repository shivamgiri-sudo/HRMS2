-- TNI (Training Needs Identification) Analysis gets its own page code.
--
-- /wfm/tni-analysis has been gated behind pageCode="WFM_ROSTER" -- a whole
-- roster-planning/building module's page code, reused for an unrelated
-- read-only training-needs view. Two real problems followed from that: (1)
-- WFM_ROSTER carries no grant at all for trainer or qa, the two roles this
-- view actually exists for (verified live 2026-09-09: 11 active accounts),
-- so they could not open it even with the backend endpoint now allowing
-- them (see the companion TNI_ROLES change in quality-dashboard.routes.ts);
-- (2) the only way to fix that from the page_catalog side would have been
-- granting trainer/qa access to WFM_ROSTER itself, which would also open
-- every other roster-planning page sharing that code -- real
-- over-permissioning for a read-only analysis view.
--
-- Read-only: can_view and can_export only, matching PROCESS_OPERATIONS's own
-- precedent (1693_process_operations_page.sql) for a page that defines
-- nothing. Granted to every role the frontend route's own list already names
-- (super_admin, admin, wfm, operations_manager, branch_wfm, manager,
-- process_manager, team_leader, tl) plus trainer and qa, which it should have
-- carried from the start.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'TNI_ANALYSIS', 'TNI Analysis', '/wfm/tni-analysis', 'Performance', 1);

INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
  (UUID(), 'super_admin',       'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',             'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'wfm',               'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'operations_manager','TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_wfm',        'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'manager',           'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager',   'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'team_leader',       'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'tl',                'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'trainer',           'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'qa',                'TNI_ANALYSIS', 1, 0, 0, 0, 1, 1);
