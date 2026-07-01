-- Migration 338: Seed role_page_access rows for TAX_DECLARATION and PAYROLL_PAYSLIPS
-- Both page codes exist in page_catalog but have zero access rows, blocking all
-- non-super-admin users from accessing these pages via WorkforcePageGate.
-- This migration is idempotent (ON DUPLICATE KEY UPDATE).

USE mas_hrms;

INSERT INTO role_page_access
  (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  -- TAX_DECLARATION: privileged roles get full access; employees/frontline get self-service view+create
  ('super_admin',     'TAX_DECLARATION', 1, 1, 1, 1, 1),
  ('admin',           'TAX_DECLARATION', 1, 1, 1, 0, 1),
  ('hr',              'TAX_DECLARATION', 1, 1, 1, 0, 1),
  ('finance',         'TAX_DECLARATION', 1, 1, 1, 0, 1),
  ('payroll',         'TAX_DECLARATION', 1, 1, 1, 0, 1),
  ('branch_head',     'TAX_DECLARATION', 1, 1, 1, 0, 1),
  ('employee',        'TAX_DECLARATION', 1, 1, 0, 0, 0),
  ('manager',         'TAX_DECLARATION', 1, 1, 0, 0, 0),
  ('tl',              'TAX_DECLARATION', 1, 1, 0, 0, 0),
  ('team_leader',     'TAX_DECLARATION', 1, 1, 0, 0, 0),
  ('process_manager', 'TAX_DECLARATION', 1, 1, 0, 0, 0),
  ('ceo',             'TAX_DECLARATION', 1, 0, 0, 0, 1),
  ('operations',      'TAX_DECLARATION', 1, 1, 0, 0, 0),
  ('recruitment_hr',  'TAX_DECLARATION', 1, 1, 0, 0, 0),
  -- PAYROLL_PAYSLIPS: same gap exists — seed access rows
  ('super_admin',     'PAYROLL_PAYSLIPS', 1, 1, 1, 1, 1),
  ('admin',           'PAYROLL_PAYSLIPS', 1, 1, 1, 0, 1),
  ('hr',              'PAYROLL_PAYSLIPS', 1, 1, 1, 0, 1),
  ('finance',         'PAYROLL_PAYSLIPS', 1, 1, 1, 0, 1),
  ('payroll',         'PAYROLL_PAYSLIPS', 1, 1, 1, 0, 1),
  ('branch_head',     'PAYROLL_PAYSLIPS', 1, 0, 0, 0, 1),
  ('employee',        'PAYROLL_PAYSLIPS', 1, 0, 0, 0, 0),
  ('manager',         'PAYROLL_PAYSLIPS', 1, 0, 0, 0, 0),
  ('tl',              'PAYROLL_PAYSLIPS', 1, 0, 0, 0, 0),
  ('team_leader',     'PAYROLL_PAYSLIPS', 1, 0, 0, 0, 0),
  ('process_manager', 'PAYROLL_PAYSLIPS', 1, 0, 0, 0, 0),
  ('ceo',             'PAYROLL_PAYSLIPS', 1, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view   = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit   = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export);
