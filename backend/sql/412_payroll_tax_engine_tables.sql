USE mas_hrms;

-- Tax engine config per financial year and regime
CREATE TABLE IF NOT EXISTS payroll_tax_fy_config (
  id               CHAR(36)       NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  financial_year   VARCHAR(7)     NOT NULL COMMENT 'e.g. 2026-27',
  regime           ENUM('new','old') NOT NULL,
  standard_deduction DECIMAL(10,2) NOT NULL DEFAULT 75000,
  rebate_limit     DECIMAL(14,2)  NOT NULL DEFAULT 1200000,
  rebate_max_amount DECIMAL(10,2) NOT NULL DEFAULT 60000 COMMENT 'Max rebate under 87A',
  cess_pct         DECIMAL(5,2)   NOT NULL DEFAULT 4,
  active_status    TINYINT(1)     NOT NULL DEFAULT 1,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fy_regime (financial_year, regime)
);

-- Tax slab master per financial year and regime
CREATE TABLE IF NOT EXISTS payroll_tax_slab_master (
  id             CHAR(36)          NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  financial_year VARCHAR(7)        NOT NULL,
  regime         ENUM('new','old') NOT NULL,
  slab_from      DECIMAL(14,2)     NOT NULL,
  slab_to        DECIMAL(14,2)     NULL COMMENT 'NULL = no upper limit (top slab)',
  rate_pct       DECIMAL(5,2)      NOT NULL,
  active_status  TINYINT(1)        NOT NULL DEFAULT 1,
  INDEX idx_slab_fy_regime (financial_year, regime)
);

-- FY 2026-27 New Regime (Budget 2025 / Finance Act 2025)
INSERT IGNORE INTO payroll_tax_fy_config
  (id, financial_year, regime, standard_deduction, rebate_limit, rebate_max_amount, cess_pct)
VALUES
  (UUID(), '2026-27', 'new', 75000, 1200000, 60000, 4);

INSERT IGNORE INTO payroll_tax_slab_master
  (id, financial_year, regime, slab_from, slab_to, rate_pct)
VALUES
  (UUID(), '2026-27', 'new',       0,  400000,  0),
  (UUID(), '2026-27', 'new',  400000,  800000,  5),
  (UUID(), '2026-27', 'new',  800000, 1200000, 10),
  (UUID(), '2026-27', 'new', 1200000, 1600000, 15),
  (UUID(), '2026-27', 'new', 1600000, 2000000, 20),
  (UUID(), '2026-27', 'new', 2000000, 2400000, 25),
  (UUID(), '2026-27', 'new', 2400000,     NULL, 30);

-- FY 2026-27 Old Regime
INSERT IGNORE INTO payroll_tax_fy_config
  (id, financial_year, regime, standard_deduction, rebate_limit, rebate_max_amount, cess_pct)
VALUES
  (UUID(), '2026-27', 'old', 50000, 500000, 12500, 4);

INSERT IGNORE INTO payroll_tax_slab_master
  (id, financial_year, regime, slab_from, slab_to, rate_pct)
VALUES
  (UUID(), '2026-27', 'old',      0,  250000,  0),
  (UUID(), '2026-27', 'old', 250000,  500000,  5),
  (UUID(), '2026-27', 'old', 500000, 1000000, 20),
  (UUID(), '2026-27', 'old', 1000000,    NULL, 30);

-- FY 2025-26 New Regime
INSERT IGNORE INTO payroll_tax_fy_config
  (id, financial_year, regime, standard_deduction, rebate_limit, rebate_max_amount, cess_pct)
VALUES
  (UUID(), '2025-26', 'new', 75000, 700000, 25000, 4);

INSERT IGNORE INTO payroll_tax_slab_master
  (id, financial_year, regime, slab_from, slab_to, rate_pct)
VALUES
  (UUID(), '2025-26', 'new',       0,  300000,  0),
  (UUID(), '2025-26', 'new',  300000,  700000,  5),
  (UUID(), '2025-26', 'new',  700000, 1000000, 10),
  (UUID(), '2025-26', 'new', 1000000, 1200000, 15),
  (UUID(), '2025-26', 'new', 1200000, 1500000, 20),
  (UUID(), '2025-26', 'new', 1500000,     NULL, 30);

-- FY 2025-26 Old Regime
INSERT IGNORE INTO payroll_tax_fy_config
  (id, financial_year, regime, standard_deduction, rebate_limit, rebate_max_amount, cess_pct)
VALUES
  (UUID(), '2025-26', 'old', 50000, 500000, 12500, 4);

INSERT IGNORE INTO payroll_tax_slab_master
  (id, financial_year, regime, slab_from, slab_to, rate_pct)
VALUES
  (UUID(), '2025-26', 'old',      0,  250000,  0),
  (UUID(), '2025-26', 'old', 250000,  500000,  5),
  (UUID(), '2025-26', 'old', 500000, 1000000, 20),
  (UUID(), '2025-26', 'old', 1000000,    NULL, 30);
