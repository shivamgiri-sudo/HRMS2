-- Manual per-analyst scores for metrics that have no automated per-employee feed.
--
-- Process Operations' Analyst-wise score panel (built 2026-09-09) recomputes a
-- metric's own formula per employee from the real source table configured on
-- kpi_studio_data_source -- QA_QUALITY_PCT from db_audit.call_quality_assessment,
-- and so on. That is correct and stays the only source of truth wherever it has
-- rows. But a real gap exists underneath it: verified live against mas_hrms,
-- QA_ACCURACY_PCT, QA_CLOSURE_PCT, QA_PROBING_PCT and SELF_ATTENDANCE_BOOLEAN are
-- 'employee'-kind metrics with a real kpi_studio_definition and a real configured
-- source, but zero rows have ever landed in that source for the affected process
-- -- there is no automated feed to recompute from, and there may never be one for
-- some of these (SELF_ATTENDANCE_BOOLEAN in particular reads a source most
-- processes were never wired to).
--
-- This table is the honest fallback: a human-supplied score per employee per day,
-- exactly the same "manual" provenance process_metric_actual already carries for
-- the whole-process case (process-data-source.service.ts), just with an employee
-- attached. It is read ONLY when buildProcessEmployeeBreakdownPlan's automated
-- query returns zero rows for the (process, metric, period) in question -- an
-- automated feed that starts reporting takes over immediately and this table is
-- never consulted again for that combination, so the two can never silently
-- disagree with each other. The application layer (getMetricAnalystBreakdown)
-- enforces that ordering; nothing here does.
--
-- One row per employee + metric + day, matching the grain the automated path
-- already produces (per-employee, per-day-range collapsed to a single score) so
-- the two are interchangeable to every reader of the analyst breakdown.

CREATE TABLE IF NOT EXISTS process_metric_employee_actual (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  process_id    CHAR(36)      NOT NULL,
  employee_id   CHAR(36)      NOT NULL,
  metric_key    VARCHAR(64)   NOT NULL,
  score_date    DATE          NOT NULL,
  actual_value  DECIMAL(18,4) NULL,
  -- Always 'manual' today -- this table exists specifically because no
  -- automated per-employee feed exists for these (process, metric) pairs.
  -- Kept as a real column, not a hardcoded assumption in application code, on
  -- the same reasoning process_metric_actual.source already follows: if an
  -- automated per-employee connector for one of these metrics is ever built,
  -- it should write here as 'connector' rather than need a new table.
  source        VARCHAR(16)   NOT NULL DEFAULT 'manual',
  note          VARCHAR(500)  NULL,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_process_metric_employee (process_id, employee_id, metric_key, score_date),
  KEY idx_process_metric_employee_lookup (process_id, metric_key, score_date),
  KEY idx_process_metric_employee_emp (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
