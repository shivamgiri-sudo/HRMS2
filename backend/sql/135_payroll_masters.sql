-- backend/sql/135_payroll_masters.sql

-- ── 1. salary_slab_master ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_slab_master (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  slab_code     VARCHAR(50)   NOT NULL UNIQUE,
  range_from    DECIMAL(12,2) NOT NULL,
  range_to      DECIMAL(12,2) NOT NULL,
  label         VARCHAR(100)  NOT NULL,
  seq_order     SMALLINT      NOT NULL DEFAULT 0,
  active_status TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_slab_range (range_from, range_to)
);

INSERT INTO salary_slab_master (slab_code, range_from, range_to, label, seq_order) VALUES
  ('S01',      0.00,    4000.00, '0 - 4,000',             1),
  ('S02',   4001.00,    6000.00, '4,001 - 6,000',         2),
  ('S03',   6001.00,    7500.00, '6,001 - 7,500',         3),
  ('S04',   7501.00,    9000.00, '7,501 - 9,000',         4),
  ('S05',   9001.00,   11000.00, '9,001 - 11,000',        5),
  ('S06',  11001.00,   15000.00, '11,001 - 15,000',       6),
  ('S07',  15001.00,   18000.00, '15,001 - 18,000',       7),
  ('S08',  18001.00,   25000.00, '18,001 - 25,000',       8),
  ('S09',  25001.00,   35000.00, '25,001 - 35,000',       9),
  ('S10',  35001.00,   50000.00, '35,001 - 50,000',      10),
  ('S11',  50001.00,   75000.00, '50,001 - 75,000',      11),
  ('S12',  75001.00,  100000.00, '75,001 - 1,00,000',    12),
  ('S13', 100001.00,  125000.00, '1,00,001 - 1,25,000',  13),
  ('S14', 125001.00,  500000.00, '1,25,001 - 5,00,000',  14)
ON DUPLICATE KEY UPDATE label = VALUES(label), seq_order = VALUES(seq_order);

-- ── 2. salary_package_master ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_package_master (
  id                    CHAR(36)            NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  grade_id              CHAR(36)            NOT NULL,
  slab_id               CHAR(36)            NOT NULL,
  location_id           CHAR(36)            NULL,
  cost_centre_id        CHAR(36)            NULL,
  basic_amt             DECIMAL(10,2)       NOT NULL DEFAULT 0,
  conveyance_amt        DECIMAL(10,2)       NOT NULL DEFAULT 0,
  conveyance_type       ENUM('fixed','pct') NOT NULL DEFAULT 'fixed',
  medical_amt           DECIMAL(10,2)       NOT NULL DEFAULT 0,
  medical_type          ENUM('fixed','pct') NOT NULL DEFAULT 'fixed',
  other_allowance_amt   DECIMAL(10,2)       NOT NULL DEFAULT 0,
  other_allowance_type  ENUM('fixed','pct') NOT NULL DEFAULT 'fixed',
  bonus_amt             DECIMAL(10,2)       NOT NULL DEFAULT 0,
  bonus_type            ENUM('fixed','pct') NOT NULL DEFAULT 'fixed',
  portfolio_amt         DECIMAL(10,2)       NOT NULL DEFAULT 0,
  special_allowance_amt DECIMAL(10,2)       NOT NULL DEFAULT 0,
  pli_amt               DECIMAL(10,2)       NOT NULL DEFAULT 0,
  gross_monthly         DECIMAL(10,2)       NOT NULL DEFAULT 0,
  ctc_monthly           DECIMAL(10,2)       NOT NULL DEFAULT 0,
  effective_from        DATE                NOT NULL,
  active_status         TINYINT(1)          NOT NULL DEFAULT 1,
  created_by            CHAR(36)            NULL,
  created_at            DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pkg (grade_id, slab_id, location_id, cost_centre_id, effective_from),
  INDEX idx_pkg_grade (grade_id),
  INDEX idx_pkg_slab  (slab_id)
);

-- ── 3. designation_band_matrix ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS designation_band_matrix (
  id             CHAR(36)   NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  department_id  CHAR(36)   NOT NULL,
  designation_id CHAR(36)   NOT NULL,
  grade_id       CHAR(36)   NOT NULL,
  min_slab_id    CHAR(36)   NULL,
  active_status  TINYINT(1) NOT NULL DEFAULT 1,
  created_by     CHAR(36)   NULL,
  created_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dbm (department_id, designation_id),
  INDEX idx_dbm_grade (grade_id)
);
