-- Sync missing expense heads and sub-heads from db_bill into mas_hrms.
-- All INSERTs use INSERT IGNORE so re-running is safe.
-- Source: db_bill.tbl_bgt_expenseheadingmaster / tbl_bgt_expensesubheadingmaster
-- Only active (close_status=1) items from db_bill are included.

-- ─── MISSING HEADS ────────────────────────────────────────────────────────────

INSERT IGNORE INTO finance_expense_head_master
  (id, head_code, head_name, display_order, active_status)
VALUES
  -- db_bill HeadingId=16: Contract Fees Facilities already exists.
  -- db_bill HeadingId=25: Others
  (UUID(), 'OTHERS',                      'Others',                          210, 1),
  -- db_bill HeadingId=27: Capex category
  (UUID(), 'REPAIRS_MAINTENANCE_CAPEX',   'Repairs & Maintenance - Capex',   220, 1),
  -- db_bill HeadingId=24: Salary & Workman Compensation (new numeric heads)
  (UUID(), 'SALARY_WORKMAN_COMPENSATION', 'Salary & Workman Compensation',   230, 1),
  -- db_bill HeadingId=23: Finance Expenses
  (UUID(), 'FINANCE_EXPENSES',            'Finance Expenses',                240, 1),
  -- db_bill HeadingId=26: Duties and Taxes
  (UUID(), 'DUTIES_AND_TAXES',            'Duties and Taxes',                250, 1);

-- ─── MISSING SUB-HEADS — HIRING_CHARGES ──────────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'AC_HIRE',                  'AC-Hire',                      10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'HIRING_CHARGES';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'HIRING_ADVERTISEMENT_COST', 'Hiring Advertisement Cost',    20, 1
FROM finance_expense_head_master h WHERE h.head_code = 'HIRING_CHARGES';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'UPS_HIRE',                  'UPS Hire',                     30, 1
FROM finance_expense_head_master h WHERE h.head_code = 'HIRING_CHARGES';

-- ─── MISSING SUB-HEADS — PRINTING_STATIONERY ─────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'PHOTOCOPY',                 'Photocopy',                    10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'PRINTING_STATIONERY';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'NEWSPAPER_PERIODICALS',     'Newspaper & Periodicals',      20, 1
FROM finance_expense_head_master h WHERE h.head_code = 'PRINTING_STATIONERY';

-- ─── MISSING SUB-HEADS — COMMUNICATION_CONNECTIVITY ─────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'COMPANY_VOICE_REIMBURSEMENT', 'Company Owned Voice-Reimbursement', 10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'COMMUNICATION_CONNECTIVITY';

-- ─── MISSING SUB-HEADS — REPAIRS_MAINTENANCE ─────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'VEHICLE_REPAIR',             'Vehicle Repair & Maintenance', 10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'REPAIRS_MAINTENANCE';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'FURNITURE_FIXTURES_REPAIR',  'Furniture & Fixtures Repair',  20, 1
FROM finance_expense_head_master h WHERE h.head_code = 'REPAIRS_MAINTENANCE';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'SERVICE_MAINTENANCE',        'Service & Maintenance Expenses', 30, 1
FROM finance_expense_head_master h WHERE h.head_code = 'REPAIRS_MAINTENANCE';

-- ─── MISSING SUB-HEADS — CONTRACT_FEES ───────────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'PROCESS_OUTSOURCING_FIELD',  'Process Outsourcing (Field)',   10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'CONTRACT_FEES';

-- ─── MISSING SUB-HEADS — CONTRACT_FEES_FACILITIES ────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'CHURN_PAYMENT',              'Churn Payment',                10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'CONTRACT_FEES_FACILITIES';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'SIM_LOSS',                   'Sim Loss',                     20, 1
FROM finance_expense_head_master h WHERE h.head_code = 'CONTRACT_FEES_FACILITIES';

-- ─── MISSING SUB-HEADS — OFFICE_MAINTENANCE ──────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'WATER_TANKER',               'Water Tanker',                 10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'OFFICE_MAINTENANCE';

-- ─── MISSING SUB-HEADS — LEGAL_CONSULTANCY ───────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'BROKERAGE_CONSULTANCY',      'Brokerage/Consultancy Charges', 10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'LEGAL_CONSULTANCY';

-- ─── SUB-HEADS FOR NEW HEAD: OTHERS ──────────────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'CAPEX_OTHERS',               'Capex-Others',                 10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'OTHERS';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'DONATION_OTHERS',            'Donation',                     20, 1
FROM finance_expense_head_master h WHERE h.head_code = 'OTHERS';

-- ─── SUB-HEADS FOR NEW HEAD: REPAIRS_MAINTENANCE_CAPEX ───────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, capex_opex, active_status)
SELECT UUID(), h.id, 'CAPEX_FURNITURE_FIXTURE',    'Furniture & Fixture - Cost',   10, 'capex', 1
FROM finance_expense_head_master h WHERE h.head_code = 'REPAIRS_MAINTENANCE_CAPEX';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, capex_opex, active_status)
SELECT UUID(), h.id, 'CAPEX_ELECTRICAL',           'Electrical Installations - Cost', 20, 'capex', 1
FROM finance_expense_head_master h WHERE h.head_code = 'REPAIRS_MAINTENANCE_CAPEX';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, capex_opex, active_status)
SELECT UUID(), h.id, 'CAPEX_AIR_CONDITIONING',     'Air-Conditioning - Cost',      30, 'capex', 1
FROM finance_expense_head_master h WHERE h.head_code = 'REPAIRS_MAINTENANCE_CAPEX';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, capex_opex, active_status)
SELECT UUID(), h.id, 'CAPEX_COMPUTERS',            'Computers - Cost',             40, 'capex', 1
FROM finance_expense_head_master h WHERE h.head_code = 'REPAIRS_MAINTENANCE_CAPEX';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, capex_opex, active_status)
SELECT UUID(), h.id, 'CAPEX_OTHER',                'Other - Cost',                 50, 'capex', 1
FROM finance_expense_head_master h WHERE h.head_code = 'REPAIRS_MAINTENANCE_CAPEX';

-- ─── SUB-HEADS FOR NEW HEAD: SALARY_WORKMAN_COMPENSATION ─────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'SALARY_BMC',                 'BMC',                          10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'SALARY_WORKMAN_COMPENSATION';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'SALARY_DSC',                 'DSC',                          20, 1
FROM finance_expense_head_master h WHERE h.head_code = 'SALARY_WORKMAN_COMPENSATION';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'SALARY_AGENT',               'Agent',                        30, 1
FROM finance_expense_head_master h WHERE h.head_code = 'SALARY_WORKMAN_COMPENSATION';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'SALARY_FOS',                 'FOS',                          40, 1
FROM finance_expense_head_master h WHERE h.head_code = 'SALARY_WORKMAN_COMPENSATION';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'SALARY_PERFORMANCE_INCENTIVES', 'Performance Incentives',    50, 1
FROM finance_expense_head_master h WHERE h.head_code = 'SALARY_WORKMAN_COMPENSATION';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'SALARY_CTC',                 'Salary - CTC',                 60, 1
FROM finance_expense_head_master h WHERE h.head_code = 'SALARY_WORKMAN_COMPENSATION';

-- ─── SUB-HEADS FOR NEW HEAD: FINANCE_EXPENSES ────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'BANK_CHARGES',               'Bank Charges',                 10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'FINANCE_EXPENSES';

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'INTEREST_CHARGES',           'Interest Charges',             20, 1
FROM finance_expense_head_master h WHERE h.head_code = 'FINANCE_EXPENSES';

-- ─── SUB-HEADS FOR NEW HEAD: DUTIES_AND_TAXES ────────────────────────────────

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, display_order, active_status)
SELECT UUID(), h.id, 'PROFESSIONAL_TAX',           'Professional Tax',             10, 1
FROM finance_expense_head_master h WHERE h.head_code = 'DUTIES_AND_TAXES';
