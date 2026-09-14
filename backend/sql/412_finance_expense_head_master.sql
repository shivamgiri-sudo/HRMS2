-- 412_finance_expense_head_master.sql
-- Configurable Head/Sub-Head master for branch budgets, GRNs and P&L allocation.

CREATE TABLE IF NOT EXISTS finance_expense_head_master (
  id CHAR(36) PRIMARY KEY,
  head_code VARCHAR(80) NOT NULL UNIQUE,
  head_name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT NULL,
  display_order INT NOT NULL DEFAULT 0,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_finance_expense_head_active (active_status, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finance_expense_sub_head_master (
  id CHAR(36) PRIMARY KEY,
  head_id CHAR(36) NOT NULL,
  sub_head_code VARCHAR(100) NOT NULL,
  sub_head_name VARCHAR(255) NOT NULL,
  default_unit VARCHAR(60) NOT NULL DEFAULT 'Unit',
  default_tax_treatment ENUM('inclusive','exclusive','exempt','reverse_charge','non_gst') NOT NULL DEFAULT 'exclusive',
  default_gst_rate DECIMAL(7,4) NOT NULL DEFAULT 18,
  default_gst_type ENUM('cgst_sgst','igst','none') NOT NULL DEFAULT 'cgst_sgst',
  default_recoverable_tax_pct DECIMAL(7,4) NOT NULL DEFAULT 100,
  default_allocation_driver VARCHAR(60) NULL,
  pnl_treatment ENUM('operating_expense','direct_cost','non_operating','excluded') NOT NULL DEFAULT 'operating_expense',
  display_order INT NOT NULL DEFAULT 0,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_finance_expense_sub_head_head
    FOREIGN KEY (head_id) REFERENCES finance_expense_head_master(id),
  UNIQUE KEY uq_finance_sub_head_code (head_id, sub_head_code),
  UNIQUE KEY uq_finance_sub_head_name (head_id, sub_head_name),
  INDEX idx_finance_sub_head_active (head_id, active_status, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO finance_expense_head_master
  (id, head_code, head_name, display_order)
VALUES
  (UUID(), 'BUSINESS_PROMOTION', 'Business Promotion Expenses', 10),
  (UUID(), 'COMMUNICATION_CONNECTIVITY', 'Communication & Connectivity', 20),
  (UUID(), 'CONTRACT_FEES_FACILITIES', 'Contract Fees Facilities', 30),
  (UUID(), 'CONTRACT_FEES', 'CONTRACT FEES', 40),
  (UUID(), 'DONATION_CHARITABLE', 'Donation-Charitable Trust', 50),
  (UUID(), 'ELECTRICITY', 'Electricity', 60),
  (UUID(), 'FEE_SUBSCRIPTION', 'Fee & Subscription', 70),
  (UUID(), 'HIRING_CHARGES', 'Hiring Charges', 80),
  (UUID(), 'INSURANCE_EXPENSES', 'Insurance Expenses', 90),
  (UUID(), 'LEGAL_CONSULTANCY', 'Legal/Consultancy Charges', 100),
  (UUID(), 'OFFICE_RENT', 'Office Rent', 110),
  (UUID(), 'OFFICE_MAINTENANCE', 'Office Maintenance A/c', 120),
  (UUID(), 'PRINTING_STATIONERY', 'Printing & Stationery Expenses', 130),
  (UUID(), 'REPAIRS_MAINTENANCE', 'Repairs & Maintenance', 140),
  (UUID(), 'SECURITY_SERVICE', 'Security Service Charges', 150),
  (UUID(), 'SPOT_FLOOR_FIELD_INCENTIVE', 'Spot/Floor/Field Incentive', 160),
  (UUID(), 'STAFF_WELFARE', 'Staff Welfare', 170),
  (UUID(), 'STAFF_TRAINING_RECRUITMENT', 'Staff Training & Recruitment', 180),
  (UUID(), 'TOURS_TRAVELLING_CONVEYANCE', 'Tours, Travelling & Conveyance', 190),
  (UUID(), 'TOUR_EXPENSES', 'Tour Expenses', 200);

INSERT IGNORE INTO finance_expense_sub_head_master
  (id, head_id, sub_head_code, sub_head_name, default_unit,
   default_tax_treatment, default_gst_rate, default_gst_type,
   default_recoverable_tax_pct, default_allocation_driver, display_order)
SELECT UUID(), h.id, seed.sub_head_code, seed.sub_head_name, seed.default_unit,
       seed.tax_treatment, seed.gst_rate, seed.gst_type,
       seed.recoverable_pct, seed.allocation_driver, seed.display_order
FROM finance_expense_head_master h
JOIN (
  SELECT 'BUSINESS_PROMOTION' head_code, 'BUSINESS_PROMOTION' sub_head_code, 'Business Promotion Expenses' sub_head_name, 'Unit' default_unit, 'exclusive' tax_treatment, 18 gst_rate, 'cgst_sgst' gst_type, 100 recoverable_pct, 'revenue_share' allocation_driver, 10 display_order
  UNION ALL SELECT 'COMMUNICATION_CONNECTIVITY','COMPANY_DATA','Company Owned Data','Connection','exclusive',18,'cgst_sgst',100,'usage_units',10
  UNION ALL SELECT 'COMMUNICATION_CONNECTIVITY','COMPANY_VOICE','Company Owned Voice','Connection','exclusive',18,'cgst_sgst',100,'usage_units',20
  UNION ALL SELECT 'COMMUNICATION_CONNECTIVITY','MOBILE_INTERNET_REIMBURSEMENT','Mobile & Internet Reimbursement','User','exclusive',18,'cgst_sgst',100,'agent_headcount',30
  UNION ALL SELECT 'COMMUNICATION_CONNECTIVITY','POSTAGE_COURIER','Postage & Courier Expenses','Shipment','exclusive',18,'cgst_sgst',100,'direct_tagging',40
  UNION ALL SELECT 'COMMUNICATION_CONNECTIVITY','SMS_CHARGES','SMS Charges','Unit','exclusive',18,'cgst_sgst',100,'usage_units',50
  UNION ALL SELECT 'CONTRACT_FEES_FACILITIES','FACILITY_STAFF','Contract Fees-Facility Staff','Month','exclusive',18,'cgst_sgst',100,'total_manpower',10
  UNION ALL SELECT 'CONTRACT_FEES','PROCESS_OUTSOURCING','Process Outsourcing','Service','exclusive',18,'cgst_sgst',100,'direct_tagging',10
  UNION ALL SELECT 'DONATION_CHARITABLE','DONATION_CHARITABLE','Donation-Charitable Trust','Unit','non_gst',0,'none',0,'direct_tagging',10
  UNION ALL SELECT 'ELECTRICITY','ELECTRICITY_GOVT','Electricity Govt.','Unit','non_gst',0,'none',0,'usage_units',10
  UNION ALL SELECT 'ELECTRICITY','GENERATOR_DIESEL','Generator-Diesel','Litre','exclusive',18,'cgst_sgst',100,'usage_units',20
  UNION ALL SELECT 'FEE_SUBSCRIPTION','FEE_SUBSCRIPTION','Fee & Subscription','Month','exclusive',18,'cgst_sgst',100,'revenue_share',10
  UNION ALL SELECT 'HIRING_CHARGES','COMPUTER_HIRE','Computer Hire','Device','exclusive',18,'cgst_sgst',100,'device_count',10
  UNION ALL SELECT 'HIRING_CHARGES','GENERATOR_HIRE','Generator Hire','Month','exclusive',18,'cgst_sgst',100,'usage_units',20
  UNION ALL SELECT 'INSURANCE_EXPENSES','CAR_INSURANCE','Car Insurance','Year','exclusive',18,'cgst_sgst',100,'direct_tagging',10
  UNION ALL SELECT 'INSURANCE_EXPENSES','INFRA_INSURANCE','Infra Insurance','Year','exclusive',18,'cgst_sgst',100,'floor_area',20
  UNION ALL SELECT 'LEGAL_CONSULTANCY','LEGAL_PROFESSIONAL','Legal & Professional Charges','Service','exclusive',18,'cgst_sgst',100,'direct_tagging',10
  UNION ALL SELECT 'OFFICE_RENT','OFFICE_RENT','Office Rent','Month','exclusive',18,'cgst_sgst',100,'floor_area',10
  UNION ALL SELECT 'OFFICE_RENT','PROPERTY_TAX','Property Tax','Year','non_gst',0,'none',0,'floor_area',20
  UNION ALL SELECT 'OFFICE_MAINTENANCE','CAFETERIA_MAINTENANCE','Cafeteria & Other Maintenance','Month','exclusive',18,'cgst_sgst',100,'total_manpower',10
  UNION ALL SELECT 'OFFICE_MAINTENANCE','CLEANING_MATERIAL','Sweeper & Cleaning Materials','Month','exclusive',18,'cgst_sgst',100,'total_manpower',20
  UNION ALL SELECT 'PRINTING_STATIONERY','OFFICE_STATIONERY','Office Stationery','Unit','exclusive',18,'cgst_sgst',100,'total_manpower',10
  UNION ALL SELECT 'REPAIRS_MAINTENANCE','COMPUTER_PERIPHERALS','Computer & Peripherals Maintenance','Device','exclusive',18,'cgst_sgst',100,'device_count',10
  UNION ALL SELECT 'REPAIRS_MAINTENANCE','ELECTRICAL_REPAIRS','Electrical Repairs & Maintenance','Service','exclusive',18,'cgst_sgst',100,'floor_area',20
  UNION ALL SELECT 'REPAIRS_MAINTENANCE','OFFICE_REPAIRS','Office Repair & Maintenance','Service','exclusive',18,'cgst_sgst',100,'floor_area',30
  UNION ALL SELECT 'REPAIRS_MAINTENANCE','AC_REPAIRS','R&M - Air Conditioner','Unit','exclusive',18,'cgst_sgst',100,'floor_area',40
  UNION ALL SELECT 'REPAIRS_MAINTENANCE','UPS_NETWORKING','R&M- Ups Networking Equipment','Unit','exclusive',18,'cgst_sgst',100,'device_count',50
  UNION ALL SELECT 'SECURITY_SERVICE','SECURITY_SERVICE','Security Service Charges','Month','exclusive',18,'cgst_sgst',100,'floor_area',10
  UNION ALL SELECT 'SPOT_FLOOR_FIELD_INCENTIVE','SPOT_INCENTIVE','Spot/Floor/Field Incentive','Employee','non_gst',0,'none',0,'direct_tagging',10
  UNION ALL SELECT 'STAFF_WELFARE','DRINKING_WATER','Drinking Water','Month','exclusive',18,'cgst_sgst',100,'total_manpower',10
  UNION ALL SELECT 'STAFF_WELFARE','RNR_EXPENSES','R&R Expenses','Month','exclusive',18,'cgst_sgst',100,'total_manpower',20
  UNION ALL SELECT 'STAFF_WELFARE','REFRESHMENT','Tea, Coffee & Refreshment','Month','exclusive',18,'cgst_sgst',100,'total_manpower',30
  UNION ALL SELECT 'STAFF_WELFARE','FESTIVAL_EXPENSE','Festival Exp.','Event','exclusive',18,'cgst_sgst',100,'total_manpower',40
  UNION ALL SELECT 'STAFF_WELFARE','MEDICAL_EXPENSE','Medical Exp.','Employee','exempt',0,'none',0,'direct_tagging',50
  UNION ALL SELECT 'STAFF_TRAINING_RECRUITMENT','RECRUITMENT_ADVERTISEMENT','Recruitment Advertisement Charges','Campaign','exclusive',18,'cgst_sgst',100,'hiring_volume',10
  UNION ALL SELECT 'TOURS_TRAVELLING_CONVEYANCE','LOCAL_CONVEYANCE','Local Conveyance A/c','Trip','non_gst',0,'none',0,'direct_tagging',10
  UNION ALL SELECT 'TOURS_TRAVELLING_CONVEYANCE','PARKING_CHARGES','Parking Charges','Trip','non_gst',0,'none',0,'direct_tagging',20
  UNION ALL SELECT 'TOUR_EXPENSES','TOUR_EXPENSES','Tour Expenses','Trip','non_gst',0,'none',0,'direct_tagging',10
) seed ON seed.head_code = h.head_code;

SELECT '412_finance_expense_head_master.sql applied' AS migration_status;
