-- Migration 2073: Utilization is import-driven, values are stored exactly as uploaded.
-- The hand-entered count columns were INT (an uploaded 2143.5 was rounded or rejected) and the
-- uploaded % columns were DECIMAL(9,4); widen every numeric Utilization column to DECIMAL(18,4)
-- so no uploaded value is rounded or overflows. Widening only: every existing value is preserved.

ALTER TABLE onfido_utilization_daily_input
  MODIFY COLUMN forecast_task                       DECIMAL(18,4) NULL,
  MODIFY COLUMN forecast_task_poa                   DECIMAL(18,4) NULL,
  MODIFY COLUMN manual_far_cases                    DECIMAL(18,4) NULL,
  MODIFY COLUMN adhoc_time                          DECIMAL(18,4) NULL,
  MODIFY COLUMN analyst_qc                          DECIMAL(18,4) NULL,
  MODIFY COLUMN facial_checks                       DECIMAL(18,4) NULL,
  MODIFY COLUMN cross_training_task_poa             DECIMAL(18,4) NULL,
  MODIFY COLUMN poa_live_audits_pq                  DECIMAL(18,4) NULL,
  MODIFY COLUMN fixed_utilization_forecast          DECIMAL(18,4) NULL,
  MODIFY COLUMN fixed_utilization_with_adhoc        DECIMAL(18,4) NULL,
  MODIFY COLUMN fixed_utilization_without_adhoc     DECIMAL(18,4) NULL,
  MODIFY COLUMN fixed_utilization_with_adhoc_pct    DECIMAL(18,4) NULL,
  MODIFY COLUMN fixed_utilization_without_adhoc_pct DECIMAL(18,4) NULL,
  MODIFY COLUMN fixed_poa_answering_pct             DECIMAL(18,4) NULL,
  MODIFY COLUMN fixed_escalated_pct                 DECIMAL(18,4) NULL;
