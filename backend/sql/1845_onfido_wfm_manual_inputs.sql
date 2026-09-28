-- 1845_onfido_wfm_manual_inputs.sql
--
-- Onfido process dashboard, 23-Sep-26 "HRMS Correction and new format" (WFM Asst. Manager).
-- The new Overview and Utilization formats need figures that no uploaded Onfido report
-- carries: the approved headcount per queue, and the daily forecast / adhoc / cross-training /
-- QC inputs of the Utilization sheet. They come from the WFM team's own planning, so they
-- are captured here by hand (or by the CSV import on the Utilization tab) instead of being
-- invented by the dashboard. Nothing is derived or defaulted: an absent row means "not entered".
--
-- onfido_manpower_plan            effective-dated approved HC per queue (and, for Encord only,
--                                 a manual Active HC because no upload carries Encord staff).
-- onfido_utilization_daily_input  one row per calendar day, every input nullable.
--
-- Plain CHAR(36) actors (no FK), explicit utf8mb4_unicode_ci (see the 1028/1032 collation
-- incidents). Additive only: two new tables, no existing object altered.

CREATE TABLE IF NOT EXISTS onfido_manpower_plan (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  process_queue  ENUM('EXTRACTION','POA','ENCORD') NOT NULL,
  effective_from DATE         NOT NULL COMMENT 'The approved HC applies from this date until the next row for the same queue.',
  approved_hc    INT          NOT NULL COMMENT 'Approved headcount for the queue. Required HC = approved x 120%, computed at read time.',
  active_hc      INT          NULL     COMMENT 'Manual Active HC snapshot. Used only for ENCORD, which has no uploaded staffing source.',
  remarks        VARCHAR(255) NULL,
  created_by     CHAR(36)     NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by     CHAR(36)     NULL,
  updated_at     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_onfido_manpower_plan_queue_date (process_queue, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS onfido_utilization_daily_input (
  input_date              DATE          NOT NULL PRIMARY KEY,
  forecast_task           DECIMAL(14,2) NULL COMMENT 'Forecasted Task (DOC).',
  forecast_task_poa       DECIMAL(14,2) NULL COMMENT 'Forecasted Task POA.',
  manual_far_cases        INT           NULL COMMENT 'Manual FAR Case.',
  adhoc_time              DECIMAL(14,2) NULL COMMENT 'Adhoc Time, in task-equivalents as in the WFM sheet.',
  analyst_qc              INT           NULL COMMENT 'Analyst QC.',
  facial_checks           INT           NULL COMMENT 'Facial checks.',
  cross_training_task_poa INT           NULL COMMENT 'Cross training task POA.',
  poa_live_audits_pq      INT           NULL COMMENT 'POA Live Audits / POA PQ Audits.',
  remarks                 VARCHAR(255)  NULL,
  created_by              CHAR(36)      NOT NULL,
  created_at              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by              CHAR(36)      NULL,
  updated_at              DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
