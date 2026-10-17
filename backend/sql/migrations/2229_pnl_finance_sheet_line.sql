-- Migration: 2229_pnl_finance_sheet_line.sql
-- Purpose: hold Finance's MAS Callnet P&L sheet ("MAS-Projection 2026-27 G-Sheet", tabs
--          "Processwise P&L" and "Indirect Cost") per month, branch and process, so the HRMS P&L
--          for months Finance closed in db_bill (before 2026-10) carries the sheet's salary and its
--          indirect-cost allocations, and every figure can be checked line by line against the sheet.
-- Date: 2026-10-17
-- Owner rule 2026-10-17: salary "as the sheet calculates" (agents from db_bill pay, DSC/BMC from
--          Finance's per-employee lists, which exist only in the sheet); indirect cost = db_bill GRNs
--          plus what Finance adds that db_bill does not hold (computer hire between group companies,
--          shared-building rent/CAM, monthly accruals).
-- Filled by backend/scripts/import-finance-pnl-sheet.mjs. Additive. Revert: DROP TABLE pnl_finance_sheet_line.

CREATE TABLE IF NOT EXISTS pnl_finance_sheet_line (
  id                 BIGINT        NOT NULL AUTO_INCREMENT,
  period_code        CHAR(7)       NOT NULL,
  sheet_branch       VARCHAR(80)   NOT NULL,
  sheet_process      VARCHAR(120)  NOT NULL,
  branch_id          CHAR(36)      NULL,
  process_id         CHAR(36)      NULL,
  revenue            DECIMAL(14,2) NOT NULL DEFAULT 0,
  agent_salary       DECIMAL(14,2) NOT NULL DEFAULT 0,
  dsc_salary         DECIMAL(14,2) NOT NULL DEFAULT 0,
  bmc_salary         DECIMAL(14,2) NOT NULL DEFAULT 0,
  idc_total          DECIMAL(14,2) NOT NULL DEFAULT 0,
  idc_communication  DECIMAL(14,2) NOT NULL DEFAULT 0,
  idc_computer_hire  DECIMAL(14,2) NOT NULL DEFAULT 0,
  idc_office_rent    DECIMAL(14,2) NOT NULL DEFAULT 0,
  idc_cam_misc       DECIMAL(14,2) NOT NULL DEFAULT 0,
  idc_electricity    DECIMAL(14,2) NOT NULL DEFAULT 0,
  idc_staff_welfare  DECIMAL(14,2) NOT NULL DEFAULT 0,
  idc_others         DECIMAL(14,2) NOT NULL DEFAULT 0,
  interest           DECIMAL(14,2) NOT NULL DEFAULT 0,
  operating_profit   DECIMAL(14,2) NOT NULL DEFAULT 0,
  source_ref         VARCHAR(200)  NULL,
  imported_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pfsl_line (period_code, sheet_branch, sheet_process),
  KEY idx_pfsl_period (period_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
