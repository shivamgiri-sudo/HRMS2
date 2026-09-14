-- Migration 220: Grant ATS_DASHBOARD page access to relevant roles
-- Safe to re-run — INSERT IGNORE skips rows that already exist
-- Apply via: mysql mas_hrms < backend/sql/220_ats_dashboard_page_access.sql
-- Requires user approval before running against production

INSERT IGNORE INTO role_page_access (role, page_code, can_view, can_create, can_edit, can_delete, is_active)
VALUES
  ('admin',       'ATS_DASHBOARD', 1, 1, 1, 1, 1),
  ('hr',          'ATS_DASHBOARD', 1, 1, 1, 0, 1),
  ('recruiter',   'ATS_DASHBOARD', 1, 1, 1, 0, 1),
  ('manager',     'ATS_DASHBOARD', 1, 0, 0, 0, 1),
  ('branch_head', 'ATS_DASHBOARD', 1, 1, 1, 0, 1),
  ('ceo',         'ATS_DASHBOARD', 1, 1, 1, 1, 1);
