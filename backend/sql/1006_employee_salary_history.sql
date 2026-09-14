-- =============================================================================
-- Migration 1006: Employee Salary History Table
-- Replaces the single-row employee_salary_snapshot with a full history table.
--
-- ADDITIVE ONLY — does not alter or drop employee_salary_snapshot.
-- The snapshot table remains for backward compatibility during transition.
--
-- Grain:  One row per employee per salary revision (effective_from date)
-- Source: Legacy sync inserts historical rows; HRMS increment governance
--         inserts new rows when an increment is approved and implemented.
-- =============================================================================

USE mas_hrms;

-- ── 1. Salary History ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_salary_history (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  employee_id         CHAR(36)      NOT NULL,

  -- Effective period
  effective_from      DATE          NOT NULL,
  effective_to        DATE          NULL,        -- NULL = current revision

  -- Source tracking
  source              ENUM('legacy_sync','hrms_increment','hrms_manual','data_migration')
                                    NOT NULL DEFAULT 'legacy_sync',
  legacy_row_id       BIGINT        NULL,        -- masjclrentry.id (if from legacy)
  increment_request_id CHAR(36)     NULL,        -- salary_increment_request.id (if from HRMS workflow)

  -- Earnings
  basic               DECIMAL(12,2) NOT NULL DEFAULT 0,
  hra                 DECIMAL(12,2) NOT NULL DEFAULT 0,
  conveyance          DECIMAL(12,2) NOT NULL DEFAULT 0,
  portfolio_allowance DECIMAL(12,2) NOT NULL DEFAULT 0,
  medical_allowance   DECIMAL(12,2) NOT NULL DEFAULT 0,
  special_allowance   DECIMAL(12,2) NOT NULL DEFAULT 0,
  other_allowance     DECIMAL(12,2) NOT NULL DEFAULT 0,
  bonus               DECIMAL(12,2) NOT NULL DEFAULT 0,
  pli                 DECIMAL(12,2) NOT NULL DEFAULT 0,
  lta                 DECIMAL(12,2) NOT NULL DEFAULT 0,

  -- Totals
  gross               DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_in_hand         DECIMAL(12,2) NOT NULL DEFAULT 0,
  ctc                 DECIMAL(12,2) NOT NULL DEFAULT 0,

  -- Statutory deductions (employee share)
  epf_employee        DECIMAL(12,2) NOT NULL DEFAULT 0,
  esic_employee       DECIMAL(12,2) NOT NULL DEFAULT 0,
  professional_tax    DECIMAL(12,2) NOT NULL DEFAULT 0,

  -- Statutory contributions (employer share — for CTC calc)
  epf_employer        DECIMAL(12,2) NOT NULL DEFAULT 0,
  esic_employer       DECIMAL(12,2) NOT NULL DEFAULT 0,
  admin_charges       DECIMAL(12,2) NOT NULL DEFAULT 0,
  gratuity_monthly    DECIMAL(12,2) NOT NULL DEFAULT 0,

  -- Context at time of revision (point-in-time snapshot)
  branch_name         VARCHAR(255)  NULL,
  department_name     VARCHAR(255)  NULL,
  designation_name    VARCHAR(255)  NULL,
  cost_centre_name    VARCHAR(255)  NULL,

  -- Data quality flags
  is_current          TINYINT(1)    NOT NULL DEFAULT 0,   -- 1 = latest revision for employee
  is_zero_gross       TINYINT(1)    GENERATED ALWAYS AS (IF(gross = 0, 1, 0)) STORED,
  has_reconciliation_gap TINYINT(1) GENERATED ALWAYS AS (
    IF(ABS(gross - (basic + hra + conveyance + portfolio_allowance +
                    medical_allowance + special_allowance + other_allowance +
                    bonus + pli + lta)) > 1.00, 1, 0)
  ) STORED,
  legacy_updated_at   DATETIME      NULL,  -- raw lastUpdated from legacy (may be 1970)
  effective_from_is_estimated TINYINT(1) NOT NULL DEFAULT 0, -- 1 = derived, not authoritative

  -- Audit
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          CHAR(36)      NULL,
  notes               TEXT          NULL,

  -- Constraints
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (increment_request_id) REFERENCES salary_increment_request(id) ON DELETE SET NULL,

  -- Indexes
  INDEX idx_sal_hist_emp          (employee_id, effective_from DESC),
  INDEX idx_sal_hist_current      (employee_id, is_current),
  INDEX idx_sal_hist_source       (source),
  INDEX idx_sal_hist_legacy_row   (legacy_row_id),
  INDEX idx_sal_hist_zero_gross   (is_zero_gross),
  INDEX idx_sal_hist_recon_gap    (has_reconciliation_gap),
  INDEX idx_sal_hist_effective    (effective_from),

  -- Prevent exact duplicate revisions from the same source row
  UNIQUE KEY uq_sal_hist_legacy   (employee_id, legacy_row_id),
  UNIQUE KEY uq_sal_hist_increment (employee_id, increment_request_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Full salary revision history per employee. Grain: employee + effective_from.';


-- ── 2. Backfill from employee_salary_snapshot (current snapshot only) ─────────
-- This inserts the current snapshot as the "current" revision with estimated effective_from.
-- effective_from is set to the employee DOJ where snapshot_date is 1970 (null epoch).
-- These rows are flagged as estimated.

INSERT INTO employee_salary_history (
  employee_id,
  effective_from,
  effective_to,
  source,
  basic, hra, conveyance, portfolio_allowance, medical_allowance,
  special_allowance, other_allowance, bonus, pli,
  gross, net_in_hand, ctc,
  epf_employee, esic_employee, professional_tax,
  epf_employer, esic_employer, admin_charges,
  is_current,
  legacy_updated_at,
  effective_from_is_estimated,
  notes
)
SELECT
  ess.employee_id,
  -- Use snapshot_date if valid (not 1970 epoch), else fall back to employee DOJ
  CASE
    WHEN ess.snapshot_date <= '1970-01-02' THEN COALESCE(e.date_of_joining, CURDATE())
    ELSE ess.snapshot_date
  END AS effective_from,
  NULL AS effective_to,
  'data_migration' AS source,
  COALESCE(ess.basic, 0),
  COALESCE(ess.hra, 0),
  COALESCE(ess.conveyance, 0),
  COALESCE(ess.portfolio_allowance, 0),
  COALESCE(ess.medical_allowance, 0),
  COALESCE(ess.special_allowance, 0),
  COALESCE(ess.other_allowance, 0),
  COALESCE(ess.bonus, 0),
  COALESCE(ess.pli, 0),
  COALESCE(ess.gross, 0),
  COALESCE(ess.net_in_hand, 0),
  COALESCE(ess.ctc_offered, 0),
  COALESCE(ess.epf_employee, 0),
  COALESCE(ess.esic_employee, 0),
  COALESCE(ess.professional_tax, 0),
  COALESCE(ess.epf_employer, 0),
  COALESCE(ess.esic_employer, 0),
  COALESCE(ess.admin_charges, 0),
  1 AS is_current,
  -- Store the raw legacy timestamp for auditability
  NULLIF(ess.snapshot_date, '1970-01-01') AS legacy_updated_at,
  -- Flag if effective_from was estimated from DOJ
  CASE WHEN ess.snapshot_date <= '1970-01-02' THEN 1 ELSE 0 END AS effective_from_is_estimated,
  CASE
    WHEN ess.snapshot_date <= '1970-01-02'
      THEN 'effective_from estimated from DOJ; legacy lastUpdated was NULL/epoch'
    ELSE NULL
  END AS notes
FROM employee_salary_snapshot ess
JOIN employees e ON e.id = ess.employee_id
-- Skip if already migrated
ON DUPLICATE KEY UPDATE notes = CONCAT(COALESCE(employee_salary_history.notes,''), ' [skipped_duplicate]');


-- ── 3. Diagnostic view: salary data quality ───────────────────────────────────
CREATE OR REPLACE VIEW v_salary_history_quality AS
SELECT
  esh.id,
  e.employee_code,
  COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
  b.branch_name,
  esh.effective_from,
  esh.effective_to,
  esh.source,
  esh.gross,
  esh.net_in_hand,
  esh.ctc,
  -- Computed expected gross
  (esh.basic + esh.hra + esh.conveyance + esh.portfolio_allowance +
   esh.medical_allowance + esh.special_allowance + esh.other_allowance +
   esh.bonus + esh.pli + esh.lta) AS computed_gross,
  -- Computed expected net
  (esh.gross - esh.epf_employee - esh.esic_employee - esh.professional_tax) AS computed_net,
  -- Computed expected CTC
  (esh.gross + esh.epf_employer + esh.esic_employer + esh.admin_charges + esh.gratuity_monthly) AS computed_ctc,
  -- Gap flags
  esh.has_reconciliation_gap,
  esh.is_zero_gross,
  esh.effective_from_is_estimated,
  ABS(esh.gross - (esh.basic + esh.hra + esh.conveyance + esh.portfolio_allowance +
                   esh.medical_allowance + esh.special_allowance + esh.other_allowance +
                   esh.bonus + esh.pli + esh.lta)) AS gross_gap,
  ABS(esh.net_in_hand - (esh.gross - esh.epf_employee - esh.esic_employee - esh.professional_tax)) AS net_gap,
  esh.is_current,
  esh.legacy_updated_at,
  esh.created_at
FROM employee_salary_history esh
JOIN employees e ON e.id = esh.employee_id
LEFT JOIN branch_master b ON b.id = e.branch_id;


SELECT 'Migration 1006 complete: employee_salary_history table created and backfilled from snapshot' AS status;
SELECT
  COUNT(*) AS total_rows,
  SUM(is_zero_gross) AS zero_gross_count,
  SUM(has_reconciliation_gap) AS reconciliation_gap_count,
  SUM(effective_from_is_estimated) AS estimated_effective_from_count
FROM employee_salary_history;
