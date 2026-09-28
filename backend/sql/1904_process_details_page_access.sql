-- Page codes for the Process Details (Targets) pages, so an admin grants them to individual users in Access Control.
--
-- Housing Owner and Housing Premium "Process Details" let a user change targets and add agents, so access is by explicit grant only:
-- no role is given these pages here (no role_page_access rows), which means nobody -- except a super admin -- can open them until an
-- admin assigns the page to a user (user_page_access): can_view to open it, can_edit to change targets / add or remove agents.
-- The API enforces the same grant (process-targets.routes.ts); hiding the card is only a convenience.
-- INSERT IGNORE on the unique page_code: safe to re-run, never overwrites an existing row.
INSERT IGNORE INTO page_catalog (page_code, page_name, page_path, module, description, active_status) VALUES
  ('PP_HOUSING_OWNER_PROCESS_DETAILS',   'Housing Owner — Process Details (Targets)',   '/performance/process-performance-v2', 'Process Performance',
   'Change monthly targets agent-wise, TL-wise and AM-wise and add agents for Housing Owner. View = open the page; Edit = change targets / add or remove agents.', 1),
  ('PP_HOUSING_PREMIUM_PROCESS_DETAILS', 'Housing Premium — Process Details (Targets)', '/performance/process-performance-v2', 'Process Performance',
   'Change monthly targets agent-wise, TL-wise and Center-wise and add agents for Housing Premium. View = open the page; Edit = change targets / add or remove agents.', 1);
