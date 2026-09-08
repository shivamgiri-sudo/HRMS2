-- Process-grain manual/upload values for KPI Studio.
--
-- kpi_studio_manual_value already exists but is keyed on employee_id NOT NULL —
-- it can only carry a per-employee figure, never a client's own number (Revenue,
-- Sales Count, AOV) that belongs to nobody in particular. Every commercial KPI
-- built on the sales/allocation tables in db_masmis needs exactly that: a process-
-- level figure with no employee attached, for whichever period the client's own
-- upload covers.
--
-- This exists specifically because bb_sale, gnc_sale, gnc_allocation,
-- neemans_sale_raw and neemans_allocation stopped being uploaded 58-101 days ago
-- (verified 2026-09-08), leaving 16 commercial KPIs across Bella Vita, GNC and
-- Neemans wired, verified, and permanently blank for any current period. A manual
-- source reading this table fills the gap for whatever period is uploaded, without
-- inventing numbers for periods db_masmis already covers — the two never overlap
-- because db_masmis stops exactly where this table's coverage would begin.
--
-- One row per process + metric field + day, matching the grain the existing
-- db_masmis-backed sources already use (SALES_COUNT sums "sales" per day, and so
-- on) so the same formulas evaluate unchanged.

CREATE TABLE IF NOT EXISTS kpi_studio_process_manual_value (
  id                CHAR(36) NOT NULL PRIMARY KEY,
  process_id        CHAR(36) NOT NULL,
  field_name        VARCHAR(64) NOT NULL,
  value_date        DATE NOT NULL,
  field_value       DECIMAL(18,4) NULL,
  entry_source      VARCHAR(24) NOT NULL DEFAULT 'upload',
  upload_batch_id   CHAR(36) NULL,
  -- Set when a later upload for the same process/field/day replaces this row's
  -- value rather than overwriting it outright, mirroring the audit trail
  -- kpi_studio_manual_value already keeps for the same reason.
  superseded_by_batch_id CHAR(36) NULL,
  note              VARCHAR(500) NULL,
  created_by        CHAR(36) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_kpi_studio_process_manual (process_id, field_name, value_date),
  KEY idx_kpi_studio_process_manual_date (value_date, field_name),
  KEY idx_kpi_studio_process_manual_batch (upload_batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
