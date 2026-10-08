-- 1991_tds_engine.sql
-- TDS on vendor payments, advisory mode: section table, default section per sub-head, and a record of
-- what should have been deducted on each payment next to what was. Nothing here changes a payment.
-- Rates and limits follow the Income Tax Department's TDS tables; edit the rows when the law changes.

CREATE TABLE IF NOT EXISTS tds_section_master (
  section_code     VARCHAR(20)   NOT NULL PRIMARY KEY,
  nature           VARCHAR(255)  NOT NULL,
  rate_individual  DECIMAL(6,3)  NOT NULL,
  rate_other       DECIMAL(6,3)  NOT NULL,
  rate_no_pan      DECIMAL(6,3)  NOT NULL DEFAULT 20,
  single_limit     DECIMAL(14,2) NULL COMMENT 'Deduct when one payment (before GST) exceeds this',
  annual_limit     DECIMAL(14,2) NULL COMMENT 'Deduct once the financial-year total for the vendor exceeds this',
  active_status    TINYINT(1)    NOT NULL DEFAULT 1,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tds_section_master (section_code, nature, rate_individual, rate_other, rate_no_pan, single_limit, annual_limit)
VALUES
  ('194C',     'Payment to contractor / for work (incl. manpower supply, security, courier, event, advertising agency)', 1,  2,  20, 30000, 100000),
  ('194J_PROF','Professional fees, legal, consultancy',                                                                 10, 10, 20, NULL, 50000),
  ('194J_TECH','Technical services, call centre, bandwidth',                                                            2,  2,  20, NULL, 50000),
  ('194I_PM',  'Rent of plant, machinery or equipment (hire)',                                                          2,  2,  20, NULL, 600000),
  ('194I_LB',  'Rent of land, building or furniture',                                                                   10, 10, 20, NULL, 600000),
  ('194H',     'Commission or brokerage',                                                                               2,  2,  20, NULL, 20000)
ON DUPLICATE KEY UPDATE section_code = section_code;

CREATE TABLE IF NOT EXISTS tds_sub_head_default (
  sub_head_name  VARCHAR(255) NOT NULL PRIMARY KEY,
  section_code   VARCHAR(20)  NOT NULL,
  confidence     ENUM('firm','review') NOT NULL DEFAULT 'firm' COMMENT 'review = depends on what the bill is for (labour vs goods); Accounts decides',
  note           VARCHAR(255) NULL,
  CONSTRAINT fk_tds_sub_head_section FOREIGN KEY (section_code) REFERENCES tds_section_master(section_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tds_sub_head_default (sub_head_name, section_code, confidence, note)
VALUES
  ('Office Rent',                         '194I_LB',   'firm',   'Rent of building'),
  ('Computer Hire',                       '194I_PM',   'firm',   'Equipment hire'),
  ('Generator Hire',                      '194I_PM',   'firm',   'Equipment hire'),
  ('AC-Hire',                             '194I_PM',   'firm',   'Equipment hire'),
  ('UPS Hire',                            '194I_PM',   'firm',   'Equipment hire'),
  ('Contract Fees-Facility Staff',        '194C',      'firm',   'Manpower supply'),
  ('Process Outsourcing',                 '194C',      'firm',   'BPO contract'),
  ('Process Outsourcing (Field)',         '194C',      'firm',   'Field contract'),
  ('Security Service Charges',            '194C',      'firm',   'Guard supply'),
  ('Cafeteria & Other Maintenance',       '194C',      'firm',   'Housekeeping / cafeteria contract'),
  ('Postage & Courier Expenses',          '194C',      'firm',   'Carriage'),
  ('Legal & Professional Charges',        '194J_PROF', 'firm',   'Professional fees'),
  ('Brokerage/Consultancy Charges',       '194H',      'review', 'Brokerage is 194H, a consultancy fee is 194J'),
  ('Computer & Peripherals Maintenance',  '194C',      'review', 'Labour or AMC is liable, spare parts are not'),
  ('Electrical Repairs & Maintenance',    '194C',      'review', 'Labour is liable, materials are not'),
  ('Office Repair & Maintenance',         '194C',      'review', 'Labour is liable, materials are not'),
  ('R&M - Air Conditioner',               '194C',      'review', 'Service is liable, gas or spares are not'),
  ('R&M- Ups Networking Equipment',       '194C',      'review', 'AMC is liable'),
  ('Vehicle Repair & Maintenance',        '194C',      'review', 'Job work is liable, parts are not'),
  ('Furniture & Fixtures Repair',         '194C',      'review', 'Labour is liable'),
  ('Service & Maintenance Expenses',      '194C',      'review', 'Depends on the bill'),
  ('Sweeper & Cleaning Materials',        '194C',      'review', 'Staff or contract is liable, consumables are not'),
  ('Business Promotion Expenses',         '194C',      'review', 'Agency 194C; celebrity or influencer 194J; gifts 194R'),
  ('Recruitment Advertisement Charges',   '194C',      'review', 'Agency 194C; placement fee 194J or 194H'),
  ('Hiring Advertisement Cost',           '194C',      'review', 'Agency 194C'),
  ('Company Owned Data',                  '194J_TECH', 'review', 'Leased line / bandwidth; ordinary telecom bills are not liable'),
  ('SMS Charges',                         '194J_TECH', 'review', 'Bulk SMS gateway'),
  ('Fee & Subscription',                  '194J_TECH', 'review', 'Software or platform subscription; memberships are not liable'),
  ('Tea, Coffee & Refreshment',           '194C',      'review', 'Caterer is liable, groceries are not'),
  ('Festival Exp.',                       '194C',      'review', 'Event manager 194C; artists 194J'),
  ('Photocopy',                           '194C',      'review', 'A copying job is a contract')
ON DUPLICATE KEY UPDATE sub_head_name = sub_head_name;

CREATE TABLE IF NOT EXISTS tds_assessment (
  id                          CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  vendor_payment_tracking_id  CHAR(36)      NOT NULL,
  transaction_row_id          CHAR(36)      NOT NULL,
  vendor_id                   CHAR(36)      NULL,
  sub_head_name               VARCHAR(255)  NULL,
  section_code                VARCHAR(20)   NULL,
  confidence                  VARCHAR(10)   NULL,
  financial_year              VARCHAR(8)    NOT NULL,
  payment_amount              DECIMAL(16,2) NOT NULL,
  base_amount                 DECIMAL(16,2) NOT NULL COMMENT 'Payment amount before GST',
  rate_pct                    DECIMAL(6,3)  NOT NULL DEFAULT 0,
  expected_tds                DECIMAL(16,2) NOT NULL DEFAULT 0,
  deducted_tds                DECIMAL(16,2) NOT NULL DEFAULT 0,
  shortfall                   DECIMAL(16,2) NOT NULL DEFAULT 0,
  pan_valid                   TINYINT(1)    NOT NULL DEFAULT 0,
  reason                      VARCHAR(500)  NULL,
  created_at                  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tds_assessment_txn (transaction_row_id),
  INDEX idx_tds_assessment_vendor_fy (vendor_id, section_code, financial_year),
  INDEX idx_tds_assessment_shortfall (shortfall, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1991_tds_engine.sql applied' AS migration_status;
-- Rollback: DROP TABLE tds_assessment; DROP TABLE tds_sub_head_default; DROP TABLE tds_section_master;
