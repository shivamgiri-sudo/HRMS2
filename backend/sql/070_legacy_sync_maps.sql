-- =============================================================================
-- Migration 070: Legacy Sync Maps — db_bill → mas_hrms (6 domains)
-- Idempotent: INSERT IGNORE — safe to re-run
-- Conflict resolution: db_bill WINS during transition period
-- =============================================================================

USE mas_hrms;

-- Deactivate the old MSSQL placeholder map (wrong source)
UPDATE legacy_sync_map SET active_status = 0 WHERE source_schema = 'dbo';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EMPLOYEE MASTER — masjclrentry → employees
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO legacy_sync_map (
  id, hrms_domain, source_schema, source_table, source_key_column,
  source_watermark_column, target_table, target_key_column,
  column_mapping_json, transform_rules_json, sync_mode, sync_order, active_status
) VALUES (
  'a1000000-0000-0000-0000-000000000001',
  'employee',
  'db_bill', 'masjclrentry', 'id',
  'lastUpdated',
  'employees', 'legacy_emp_id',
  JSON_OBJECT(
    'EmpCode',       'employee_code',
    'BioCode',       'biometric_code',
    'EmpName',       '__split_name__',
    'Title',         'title',
    'Gendar',        'gender',
    'DOB',           'date_of_birth',
    'DOJ',           'date_of_joining',
    'DOL',           'date_of_leaving',
    'Mobile',        'mobile',
    'EmailId',       'email',
    'OfficeEmailId', 'official_email',
    'PanNo',         'pan_number',
    'AdharId',       '__aadhaar_last4__',
    'PassportNo',    'passport_number',
    'EPFNo',         'epf_number',
    'ESICNo',        'esic_number',
    'UAN',           'uan',
    'Dept',          'department',
    'Desgination',   'designation',
    'BranchName',    'branch',
    'ClientName',    'client_name',
    'Process',       'process',
    'CostCenter',    'cost_center',
    'MaritalStatus', 'marital_status',
    'BloodGruop',    'blood_group',
    'Qualification', 'qualification',
    'Adrress1',      'address_line1',
    'Adrress2',      'address_line2',
    'City',          'city',
    'State',         'state',
    'PinCode',       'pincode',
    'Status',        '__active_status__'
  ),
  JSON_OBJECT(
    'name_split',     true,
    'aadhaar_mask',   true,
    'status_map',     JSON_OBJECT('1', true, '0', false)
  ),
  'upsert', 10, 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. BANK DETAILS — masjclrentry → employee_bank_detail
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO legacy_sync_map (
  id, hrms_domain, source_schema, source_table, source_key_column,
  source_watermark_column, target_table, target_key_column,
  column_mapping_json, transform_rules_json, sync_mode, sync_order, active_status
) VALUES (
  'a1000000-0000-0000-0000-000000000002',
  'bank_detail',
  'db_bill', 'masjclrentry', 'id',
  'lastUpdated',
  'employee_bank_detail', 'employee_id',
  JSON_OBJECT(
    'AcNo',      'account_number',
    'AcBank',    'bank_name',
    'AcBranch',  'bank_branch_name',
    'IFSCCode',  'ifsc_code',
    'AccHolder', 'account_holder_name'
  ),
  JSON_OBJECT(
    'skip_if_blank', JSON_ARRAY('AcNo', 'IFSCCode'),
    'account_encrypt', true
  ),
  'upsert', 20, 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SALARY SNAPSHOT — masjclrentry → employee_salary_snapshot
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO legacy_sync_map (
  id, hrms_domain, source_schema, source_table, source_key_column,
  source_watermark_column, target_table, target_key_column,
  column_mapping_json, transform_rules_json, sync_mode, sync_order, active_status
) VALUES (
  'a1000000-0000-0000-0000-000000000003',
  'salary_snapshot',
  'db_bill', 'masjclrentry', 'id',
  'lastUpdated',
  'employee_salary_snapshot', 'employee_id',
  JSON_OBJECT(
    'CTC',       'ctc',
    'Gross',     'gross',
    'NetInHand', 'net_inhand',
    'Basic',     'basic',
    'HRA',       'hra',
    'DA',        'da',
    'TA',        'ta',
    'Other',     'other_allowance'
  ),
  JSON_OBJECT(
    'skip_if_zero', JSON_ARRAY('CTC', 'Gross'),
    'snapshot_month', 'current'
  ),
  'upsert', 30, 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. STATUTORY INFO — masjclrentry → employee_statutory_info
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO legacy_sync_map (
  id, hrms_domain, source_schema, source_table, source_key_column,
  source_watermark_column, target_table, target_key_column,
  column_mapping_json, transform_rules_json, sync_mode, sync_order, active_status
) VALUES (
  'a1000000-0000-0000-0000-000000000004',
  'statutory',
  'db_bill', 'masjclrentry', 'id',
  'lastUpdated',
  'employee_statutory_info', 'employee_id',
  JSON_OBJECT(
    'EPFNo',  'epf_number',
    'ESICNo', 'esic_number',
    'UAN',    'uan_number',
    'PanNo',  'pan_number'
  ),
  NULL,
  'upsert', 40, 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ATTENDANCE — Attandence → wfm_attendance_session + attendance_daily_record
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO legacy_sync_map (
  id, hrms_domain, source_schema, source_table, source_key_column,
  source_watermark_column, target_table, target_key_column,
  column_mapping_json, transform_rules_json, sync_mode, sync_order, active_status
) VALUES (
  'a1000000-0000-0000-0000-000000000005',
  'attendance',
  'db_bill', 'Attandence', 'id',
  'AttDate',
  'wfm_attendance_session', 'employee_id,session_date',
  JSON_OBJECT(
    'EmpCode',  '__resolve_employee_id__',
    'AttDate',  'session_date',
    'InTime',   '__login_time__',
    'OutTime',  '__logout_time__',
    'Status',   '__attendance_status__'
  ),
  JSON_OBJECT(
    'status_map', JSON_OBJECT(
      'P',  'Present',
      'A',  'Absent',
      'L',  'OnLeave',
      'WO', 'WeekOff',
      'HD', 'HalfDay',
      'LWP','LWP'
    ),
    'punch_source', 'LEGACY_IMPORT'
  ),
  'upsert', 50, 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. LEAVE BALANCES — leave_management → leave_balance_ledger
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO legacy_sync_map (
  id, hrms_domain, source_schema, source_table, source_key_column,
  source_watermark_column, target_table, target_key_column,
  column_mapping_json, transform_rules_json, sync_mode, sync_order, active_status
) VALUES (
  'a1000000-0000-0000-0000-000000000006',
  'leave_balance',
  'db_bill', 'leave_management', 'id',
  'CreateDate',
  'leave_balance_ledger', 'employee_id,leave_type_id,balance_year',
  JSON_OBJECT(
    'EmpCode',    '__resolve_employee_id__',
    'CL',         '__leave_alloc_CL__',
    'ML',         '__leave_alloc_ML__',
    'DL',         '__leave_alloc_DL__',
    'EL',         '__leave_alloc_EL__',
    'PTRL',       '__leave_alloc_PL__',
    'LWP',        '__leave_alloc_LWP__'
  ),
  JSON_OBJECT(
    'balance_year_from', 'CreateDate',
    'carry_forward',     true
  ),
  'upsert', 60, 1
);

-- Seed initial checkpoints for all 6 maps (watermark = FY start)
INSERT IGNORE INTO legacy_sync_checkpoint
  (id, sync_map_id, last_watermark_value, last_run_status)
VALUES
  (UUID(), 'a1000000-0000-0000-0000-000000000001', '2025-04-01 00:00:00', 'never_run'),
  (UUID(), 'a1000000-0000-0000-0000-000000000002', '2025-04-01 00:00:00', 'never_run'),
  (UUID(), 'a1000000-0000-0000-0000-000000000003', '2025-04-01 00:00:00', 'never_run'),
  (UUID(), 'a1000000-0000-0000-0000-000000000004', '2025-04-01 00:00:00', 'never_run'),
  (UUID(), 'a1000000-0000-0000-0000-000000000005', '2025-04-01 00:00:00', 'never_run'),
  (UUID(), 'a1000000-0000-0000-0000-000000000006', '2025-04-01 00:00:00', 'never_run');

SELECT 'Sync maps seeded' AS result, COUNT(*) AS total FROM legacy_sync_map WHERE active_status = 1;
SELECT id, hrms_domain, sync_order, active_status FROM legacy_sync_map WHERE active_status = 1 ORDER BY sync_order;
