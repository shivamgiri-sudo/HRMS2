USE mas_hrms;

-- PF/UAN tracking
CREATE TABLE IF NOT EXISTS employee_uan (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id     CHAR(36)     NOT NULL UNIQUE,
  uan             VARCHAR(20)  NOT NULL COMMENT 'Universal Account Number',
  member_id       VARCHAR(32)  COMMENT 'Employer-specific PF member ID',
  epf_join_date   DATE,
  eps_eligible    TINYINT(1)   NOT NULL DEFAULT 1,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_uan_emp (employee_id)
);

-- ESIC contribution summary per run
CREATE TABLE IF NOT EXISTS esic_contribution_summary (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  run_id          CHAR(36)     NOT NULL UNIQUE,
  period          VARCHAR(7)   NOT NULL,
  employee_count  INT          NOT NULL DEFAULT 0,
  total_wages     DECIMAL(14,2) NOT NULL DEFAULT 0,
  employee_contribution DECIMAL(14,2) NOT NULL DEFAULT 0,
  employer_contribution DECIMAL(14,2) NOT NULL DEFAULT 0,
  challan_status  ENUM('pending','generated','filed') NOT NULL DEFAULT 'pending',
  challan_ref     VARCHAR(64),
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- PT state slabs
CREATE TABLE IF NOT EXISTS pt_slab_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  state_code      VARCHAR(10)  NOT NULL,
  state_name      VARCHAR(64)  NOT NULL,
  income_from     DECIMAL(10,2) NOT NULL DEFAULT 0,
  income_to       DECIMAL(10,2) COMMENT 'NULL = no upper limit',
  pt_amount       DECIMAL(8,2)  NOT NULL DEFAULT 0,
  frequency       ENUM('monthly','half_yearly','annually') NOT NULL DEFAULT 'monthly',
  effective_from  DATE         NOT NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  INDEX idx_pt_state (state_code)
);

-- Minimum wage master
CREATE TABLE IF NOT EXISTS minimum_wage_master (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  state_code      VARCHAR(10)  NOT NULL,
  category        ENUM('unskilled','semi_skilled','skilled','highly_skilled') NOT NULL DEFAULT 'unskilled',
  daily_rate      DECIMAL(8,2) NOT NULL,
  monthly_rate    DECIMAL(10,2) NOT NULL,
  effective_from  DATE         NOT NULL,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  INDEX idx_mw_state (state_code)
);

-- Seed PT slabs for common states (FY 2025-26)
INSERT IGNORE INTO pt_slab_master (id, state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from) VALUES
(UUID(), 'MH', 'Maharashtra', 0, 7500, 0, 'monthly', '2025-04-01'),
(UUID(), 'MH', 'Maharashtra', 7501, 10000, 175, 'monthly', '2025-04-01'),
(UUID(), 'MH', 'Maharashtra', 10001, NULL, 200, 'monthly', '2025-04-01'),
(UUID(), 'KA', 'Karnataka', 0, 14999, 0, 'monthly', '2025-04-01'),
(UUID(), 'KA', 'Karnataka', 15000, 29999, 150, 'monthly', '2025-04-01'),
(UUID(), 'KA', 'Karnataka', 30000, NULL, 200, 'monthly', '2025-04-01'),
(UUID(), 'TN', 'Tamil Nadu', 0, 3500, 0, 'monthly', '2025-04-01'),
(UUID(), 'TN', 'Tamil Nadu', 3501, 5000, 16.50, 'monthly', '2025-04-01'),
(UUID(), 'TN', 'Tamil Nadu', 5001, 7500, 33.75, 'monthly', '2025-04-01'),
(UUID(), 'TN', 'Tamil Nadu', 7501, 10000, 49.50, 'monthly', '2025-04-01'),
(UUID(), 'TN', 'Tamil Nadu', 10001, NULL, 208.33, 'monthly', '2025-04-01'),
(UUID(), 'WB', 'West Bengal', 0, 10000, 0, 'monthly', '2025-04-01'),
(UUID(), 'WB', 'West Bengal', 10001, 15000, 110, 'monthly', '2025-04-01'),
(UUID(), 'WB', 'West Bengal', 15001, 25000, 130, 'monthly', '2025-04-01'),
(UUID(), 'WB', 'West Bengal', 25001, 40000, 150, 'monthly', '2025-04-01'),
(UUID(), 'WB', 'West Bengal', 40001, NULL, 200, 'monthly', '2025-04-01'),
(UUID(), 'TS', 'Telangana', 0, 15000, 0, 'monthly', '2025-04-01'),
(UUID(), 'TS', 'Telangana', 15001, 20000, 150, 'monthly', '2025-04-01'),
(UUID(), 'TS', 'Telangana', 20001, NULL, 200, 'monthly', '2025-04-01'),
(UUID(), 'AP', 'Andhra Pradesh', 0, 15000, 0, 'monthly', '2025-04-01'),
(UUID(), 'AP', 'Andhra Pradesh', 15001, NULL, 200, 'monthly', '2025-04-01');

-- Seed TDS slabs FY 2025-26 New Regime (Section 115BAC)
INSERT IGNORE INTO statutory_config (id, config_key, config_value, description) VALUES
(UUID(), 'tds_slab_0_300000', '0', 'New regime: 0% on income up to 3L'),
(UUID(), 'tds_slab_300001_700000', '5', 'New regime: 5% on 3L-7L'),
(UUID(), 'tds_slab_700001_1000000', '10', 'New regime: 10% on 7L-10L'),
(UUID(), 'tds_slab_1000001_1200000', '15', 'New regime: 15% on 10L-12L'),
(UUID(), 'tds_slab_1200001_1500000', '20', 'New regime: 20% on 12L-15L'),
(UUID(), 'tds_slab_1500001_above', '30', 'New regime: 30% above 15L'),
(UUID(), 'tds_rebate_87a_limit', '700000', 'Section 87A rebate: nil tax if total income <= 7L'),
(UUID(), 'tds_standard_deduction', '75000', 'Standard deduction FY 2025-26'),
(UUID(), 'pf_wage_ceiling', '15000', 'PF wage ceiling for EPS contribution'),
(UUID(), 'gratuity_multiplier', '15', 'Gratuity: 15 days per year of service'),
(UUID(), 'gratuity_divisor', '26', 'Gratuity: divide by 26 working days'),
(UUID(), 'gratuity_min_service_months', '60', 'Gratuity eligibility: 60 months (5 years) continuous service');
